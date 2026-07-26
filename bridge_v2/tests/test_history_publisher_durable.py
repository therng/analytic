"""Package 4 — durable-mode cursor/window resolution.

Durable mode's whole point is to stop trusting the bridge's own
publish-progress cursor (mt5:v2:history:{login}:cursor) and instead read the
ack mirror worker-v2 writes after a confirmed PostgreSQL checkpoint advance.
These tests prove: (1) the ack, not the local cursor, drives the window
start; (2) an unconfirmed window is retried byte-identically rather than
floating window_end with live `now` (the tail-window churn problem); (3) the
pending window clears and a fresh one is computed once the ack catches up.
"""

import json
from collections import namedtuple

from bridge_v2 import config
from bridge_v2.history_publisher import (
    sync_history_once,
    write_cursor,
    _key_ack,
    _key_pending_window,
    _key_watermark,
)
from bridge_v2.mt5_client import CallResult, CallStatus

JAN_1_2026 = 1_767_225_600
Deal = namedtuple("Deal", "ticket order position_id symbol type entry volume price commission fee swap profit time comment")
Order = namedtuple("Order", "ticket position_id symbol type volume_initial price_open sl tp time_setup time_done comment")


class FakeRedis:
    def __init__(self):
        self.kv = {}
        self.streams = {}

    def get(self, key):
        return self.kv.get(key)

    def set(self, key, value, nx=False, **kw):
        if nx and key in self.kv:
            return False
        self.kv[key] = value
        return True

    def delete(self, key):
        self.kv.pop(key, None)

    def xadd(self, stream, fields):
        self.streams.setdefault(stream, []).append(fields)

    def pipeline(self, transaction=False):
        return self

    def execute(self):
        return []


class FakeClient:
    def __init__(self, deals=None, orders=None):
        self._deals = CallResult(CallStatus.OK, value=deals or ())
        self._orders = CallResult(CallStatus.OK, value=orders or ())

    def history_deals_get(self, date_from, date_to):
        return self._deals

    def history_orders_get(self, date_from, date_to):
        return self._orders


def make_deal(ticket=1):
    return Deal(ticket, 10, 101, "EURUSD", 0, 0, 0.1, 1.1, -0.7, 0.0, 0.0, 5.0, JAN_1_2026, "")


def write_ack(r, login, completed_through, last_completed_chunk_id=None):
    r.set(
        _key_ack(login),
        json.dumps(
            {
                "version": 1,
                "ready": True,
                "phase": "backfill",
                "completedThroughServerTime": str(completed_through),
                "lastCompletedChunkId": last_completed_chunk_id,
            }
        ),
    )


def test_durable_mode_defaults_to_all_accounts_and_uses_ack():
    r = FakeRedis()
    write_ack(r, 7948784, JAN_1_2026 + 500)
    now = JAN_1_2026 + 86400
    status = sync_history_once(FakeClient(), r, 7948784, now, JAN_1_2026)
    assert status["cursor_from"] == JAN_1_2026 + 500


def test_durable_mode_with_no_ack_starts_from_configured_start():
    r = FakeRedis()
    now = JAN_1_2026 + 86400
    status = sync_history_once(FakeClient(), r, 7948784, now, JAN_1_2026, durable_mode=True)
    assert status["cursor_from"] == JAN_1_2026


def test_durable_mode_derives_cursor_from_ack_not_from_stale_local_cursor_key():
    r = FakeRedis()
    # Bridge's own cursor key claims a much earlier position than the ack —
    # simulates a Redis flush/restart where local state regressed. Durable
    # mode must trust the ack, never this key.
    write_cursor(r, 7948784, JAN_1_2026)
    write_ack(r, 7948784, JAN_1_2026 + 10 * 86400)
    now = JAN_1_2026 + 40 * 86400
    status = sync_history_once(FakeClient(), r, 7948784, now, JAN_1_2026, durable_mode=True)
    assert status["cursor_from"] == JAN_1_2026 + 10 * 86400


def test_durable_mode_parent_chunk_id_comes_from_ack_lastCompletedChunkId():
    r = FakeRedis()
    write_ack(r, 7948784, JAN_1_2026 + 10 * 86400, last_completed_chunk_id="946684800:1234567890")
    now = JAN_1_2026 + 40 * 86400
    sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now, JAN_1_2026, durable_mode=True)
    msg = json.loads(r.streams[config.STREAM_DEALS][0]["data"])
    assert msg["parentChunkId"] == "946684800:1234567890"


def test_durable_mode_retries_unconfirmed_window_byte_identically_across_now_advancing():
    """The tail-window churn problem: without a pinned pending window,
    window_end = min(cursor + window_days, now) would produce a different
    chunkId on every retry as `now` ticks forward. Durable mode must not."""
    r = FakeRedis()
    # No ack yet -> cursor = start. now is already past cursor+window_days,
    # so this is NOT a tail window on the first call, but a later retry with
    # a further-advanced `now` must still reuse the exact same window.
    now_1 = JAN_1_2026 + 5 * 86400  # tail window: clamped by now
    sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now_1, JAN_1_2026, durable_mode=True)
    first_msg = json.loads(r.streams[config.STREAM_DEALS][0]["data"])
    first_chunk_id = first_msg["chunkId"]

    r.streams[config.STREAM_DEALS] = []  # simulate the retry redelivering fresh
    now_2 = now_1 + 3600  # now advanced further, ack still hasn't caught up
    sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now_2, JAN_1_2026, durable_mode=True)
    second_msg = json.loads(r.streams[config.STREAM_DEALS][0]["data"])
    assert second_msg["chunkId"] == first_chunk_id, "unconfirmed window must not mint a new chunkId as `now` advances"
    assert second_msg["windowEndServerTime"] == first_msg["windowEndServerTime"]


def test_durable_mode_advances_to_a_fresh_window_once_ack_catches_up():
    r = FakeRedis()
    now = JAN_1_2026 + 5 * 86400
    sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now, JAN_1_2026, durable_mode=True)
    pending_before = r.get(_key_pending_window(7948784))
    assert pending_before is not None

    # Ack catches up to exactly the pending window's end.
    published_end = json.loads(pending_before)["end"]
    write_ack(r, 7948784, published_end)

    later_now = now + 86400
    status = sync_history_once(FakeClient(deals=()), r, 7948784, later_now, JAN_1_2026, durable_mode=True)
    assert status["cursor_from"] == published_end, "must compute a fresh window starting where the ack confirmed"
    assert r.get(_key_pending_window(7948784)) is None or json.loads(r.get(_key_pending_window(7948784)))["start"] != JAN_1_2026


def test_durable_mode_idle_when_pending_window_cleared_and_ack_caught_up_to_now():
    r = FakeRedis()
    write_ack(r, 7948784, JAN_1_2026)
    status = sync_history_once(FakeClient(), r, 7948784, JAN_1_2026, JAN_1_2026, durable_mode=True)
    assert status["idle"] is True


# --- Watermark (§2d) -------------------------------------------------------

def test_watermark_stops_publishing_once_window_start_reaches_it():
    r = FakeRedis()
    r.set(_key_watermark(7948784), str(JAN_1_2026))
    now = JAN_1_2026 + 86400
    status = sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now, JAN_1_2026)
    assert status["idle"] is True
    assert status.get("watermark_reached") is True
    assert config.STREAM_DEALS not in r.streams, "must not query/publish once the watermark is reached"


def test_watermark_does_not_block_publishing_before_it_is_reached():
    r = FakeRedis()
    r.set(_key_watermark(7948784), str(JAN_1_2026 + 100 * 86400))
    now = JAN_1_2026 + 86400
    status = sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now, JAN_1_2026)
    assert status["idle"] is False
    assert status["deals_published"] == 1


def test_watermark_applies_in_durable_mode_using_the_ack_derived_cursor():
    r = FakeRedis()
    write_ack(r, 7948784, JAN_1_2026 + 10 * 86400)
    r.set(_key_watermark(7948784), str(JAN_1_2026 + 10 * 86400))
    now = JAN_1_2026 + 40 * 86400
    status = sync_history_once(FakeClient(deals=(make_deal(1),)), r, 7948784, now, JAN_1_2026, durable_mode=True)
    assert status["idle"] is True
    assert status.get("watermark_reached") is True


# --- Per-account durable-mode allowlist (Package 5 gating) ------------------

def test_durable_mode_allowlist_empty_is_a_noop_for_every_login(monkeypatch):
    monkeypatch.setattr(config, "V2_HISTORY_DURABLE_ACCOUNTS", "")
    assert config.durable_mode_enabled(7948784) is False
    assert config.durable_mode_enabled(99887766) is False


def test_durable_mode_allowlist_gates_by_login(monkeypatch):
    monkeypatch.setattr(config, "V2_HISTORY_DURABLE_ACCOUNTS", "7948784, 111")
    assert config.durable_mode_enabled(7948784) is True
    assert config.durable_mode_enabled(111) is True
    assert config.durable_mode_enabled(99887766) is False


def test_durable_mode_allowlist_star_enables_every_login(monkeypatch):
    monkeypatch.setattr(config, "V2_HISTORY_DURABLE_ACCOUNTS", "*")
    assert config.durable_mode_enabled(7948784) is True
    assert config.durable_mode_enabled(99887766) is True


def test_sync_history_once_uses_the_per_login_allowlist_when_durable_mode_omitted(monkeypatch):
    monkeypatch.setattr(config, "V2_HISTORY_DURABLE_ACCOUNTS", "7948784")
    r = FakeRedis()
    write_ack(r, 7948784, JAN_1_2026 + 10 * 86400)
    now = JAN_1_2026 + 40 * 86400

    # allowlisted login -> durable path (ack-derived cursor)
    status = sync_history_once(FakeClient(), r, 7948784, now, JAN_1_2026)
    assert status["cursor_from"] == JAN_1_2026 + 10 * 86400

    # non-allowlisted login -> legacy path (local cursor, ack ignored)
    write_ack(r, 99887766, JAN_1_2026 + 10 * 86400)
    status = sync_history_once(FakeClient(), r, 99887766, now, JAN_1_2026)
    assert status["cursor_from"] == JAN_1_2026
