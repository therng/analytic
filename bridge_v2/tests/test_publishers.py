"""Cursor invariants + live payload field preservation."""

import json
from collections import namedtuple

import pytest

from bridge_v2 import config
from bridge_v2.history_publisher import read_cursor, sync_history_once, write_cursor
from bridge_v2.live_publisher import live_position_payload, publish_live
from bridge_v2.mt5_client import CallResult, CallStatus

JAN_1_2026 = 1_767_225_600
Deal = namedtuple("Deal", "ticket order position_id symbol type entry volume price commission fee swap profit time comment")
Order = namedtuple("Order", "ticket position_id symbol type volume_initial price_open sl tp time_setup time_done comment")
Position = namedtuple("Position", "ticket identifier symbol type magic reason volume price_open price_current sl tp profit swap comment time time_msc")


class FakeRedis:
    """Minimal Redis double: strings, hashes, streams, pipeline."""

    def __init__(self):
        self.kv = {}
        self.hashes = {}
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

    def hset(self, key, mapping=None, **kw):
        self.hashes.setdefault(key, {}).update(mapping or {})

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def expire(self, key, ttl):
        pass

    def time(self):
        import time as _time
        return (int(_time.time()), 0)

    def xadd(self, stream, fields):
        self.streams.setdefault(stream, []).append(fields)

    def pipeline(self, transaction=False):
        return self  # commands apply immediately; execute() is a no-op

    def execute(self):
        return []


class FakeClient:
    """Mt5Client double returning canned CallResults."""

    def __init__(self, deals=None, orders=None, deals_result=None, orders_result=None):
        self._deals = CallResult(CallStatus.OK, value=deals or ()) if deals_result is None else deals_result
        self._orders = CallResult(CallStatus.OK, value=orders or ()) if orders_result is None else orders_result
        self.windows = []

    def history_deals_get(self, date_from, date_to):
        self.windows.append((date_from, date_to))
        return self._deals

    def history_orders_get(self, date_from, date_to):
        return self._orders


def make_deal(ticket=1):
    return Deal(ticket, 10, 101, "EURUSD", 0, 0, 0.1, 1.1, -0.7, 0.0, 0.0, 5.0, JAN_1_2026, "")


def make_order(ticket=10):
    return Order(ticket, 101, "EURUSD", 0, 0.1, 1.1, 0.0, 0.0, JAN_1_2026, JAN_1_2026, "")


# ── Cursor ───────────────────────────────────────────────────────────────────
def test_missing_cursor_uses_configured_start_never_now_minus_30_days():
    r = FakeRedis()
    assert read_cursor(r, 7948784, JAN_1_2026) == JAN_1_2026


def test_default_history_start_is_full_coverage_boundary():
    assert config.DEFAULT_HISTORY_START_ISO == "2025-01-01T00:00:00"
    assert config.history_start_epoch() == 1735689600


def test_cursor_roundtrips():
    r = FakeRedis()
    write_cursor(r, 7948784, JAN_1_2026 + 500)
    assert read_cursor(r, 7948784, JAN_1_2026) == JAN_1_2026 + 500


def test_publishes_raw_records_one_message_each_and_advances_cursor():
    r, c = FakeRedis(), FakeClient(deals=(make_deal(1), make_deal(2)), orders=(make_order(),))
    now = JAN_1_2026 + 10 * 86400
    status = sync_history_once(c, r, 7948784, now, JAN_1_2026)

    assert status["deals_published"] == 2
    assert status["orders_published"] == 1
    # N records + 1 trailing barrier per stream.
    assert len(r.streams[config.STREAM_DEALS]) == 3
    assert len(r.streams[config.STREAM_ORDERS]) == 2
    # One Redis message == one raw MT5 record, fields intact.
    msg = json.loads(r.streams[config.STREAM_DEALS][0]["data"])
    assert msg["type"] == "record"
    assert msg["login"] == 7948784
    assert msg["eventKey"] == "1"  # contract: eventKey == str(ticket) == Deal.dealNo
    assert msg["payload"]["ticket"] == 1
    assert msg["payload"]["position_id"] == 101
    assert msg["payload"]["time"] == JAN_1_2026
    assert msg["ordinal"] == 0
    assert msg["expectedCount"] == 2
    # Barrier is the last message and carries the chunk-level digest.
    barrier = json.loads(r.streams[config.STREAM_DEALS][2]["data"])
    assert barrier["type"] == "barrier"
    assert barrier["recordCount"] == 2
    # Window reached present -> cursor advanced to now.
    assert read_cursor(r, 7948784, JAN_1_2026) == now
    assert status["reached_present"] is True


def test_window_is_bounded_to_30_days():
    r, c = FakeRedis(), FakeClient()
    now = JAN_1_2026 + 365 * 86400
    status = sync_history_once(c, r, 7948784, now, JAN_1_2026)
    assert status["cursor_to"] == JAN_1_2026 + 30 * 86400
    assert status["reached_present"] is False


def test_empty_window_still_advances_cursor():
    r, c = FakeRedis(), FakeClient(deals=(), orders=())
    now = JAN_1_2026 + 86400
    status = sync_history_once(c, r, 7948784, now, JAN_1_2026)
    assert status["deals_published"] == 0
    assert read_cursor(r, 7948784, JAN_1_2026) == now
    # Empty window still emits its barrier (recordCount 0) so coverage can be
    # proven gap-free without any records.
    assert len(r.streams[config.STREAM_DEALS]) == 1
    barrier = json.loads(r.streams[config.STREAM_DEALS][0]["data"])
    assert barrier["type"] == "barrier"
    assert barrier["recordCount"] == 0


def test_mt5_failure_never_advances_cursor_and_is_not_an_empty_window():
    r = FakeRedis()
    failed = CallResult(CallStatus.FAILED, last_error=(-2, "no ipc"))
    c = FakeClient(deals_result=failed)
    with pytest.raises(RuntimeError, match="history_deals_get failed"):
        sync_history_once(c, r, 7948784, JAN_1_2026 + 86400, JAN_1_2026)
    assert r.get(config.key_history_cursor(7948784)) is None
    assert config.STREAM_DEALS not in r.streams


def test_orders_failure_after_deals_ok_does_not_advance_cursor():
    r = FakeRedis()
    c = FakeClient(deals=(make_deal(),), orders_result=CallResult(CallStatus.ERROR, exception=OSError("down")))
    with pytest.raises(RuntimeError, match="history_orders_get failed"):
        sync_history_once(c, r, 7948784, JAN_1_2026 + 86400, JAN_1_2026)
    assert r.get(config.key_history_cursor(7948784)) is None


def test_republishing_same_window_is_safe_records_keep_stable_ticket_ids():
    r = FakeRedis()
    now = JAN_1_2026 + 86400
    for _ in range(2):
        write_cursor(r, 7948784, JAN_1_2026)  # simulate a replay of the same window
        sync_history_once(FakeClient(deals=(make_deal(7),)), r, 7948784, now, JAN_1_2026)
    records = [json.loads(m["data"]) for m in r.streams[config.STREAM_DEALS] if json.loads(m["data"])["type"] == "record"]
    tickets = [m["payload"]["ticket"] for m in records]
    assert tickets == [7, 7]  # duplicates carry the same MT5 ticket -> downstream upsert dedupes
    # Same window republished -> identical chunkId and payloadSha256 both times.
    assert records[0]["chunkId"] == records[1]["chunkId"]
    assert records[0]["payloadSha256"] == records[1]["payloadSha256"]


def test_idle_when_cursor_is_at_present():
    r = FakeRedis()
    write_cursor(r, 7948784, JAN_1_2026)
    status = sync_history_once(FakeClient(), r, 7948784, JAN_1_2026, JAN_1_2026)
    assert status == {"idle": True, "cursor": JAN_1_2026}


# ── Live ─────────────────────────────────────────────────────────────────────
def test_live_position_preserves_every_required_field():
    p = Position(555, 555, "XAUUSD", 1, 12345, 3, 0.5, 2000.0, 1990.0,
                 2010.0, 1980.0, 47.5, -1.2, "bot", JAN_1_2026, JAN_1_2026 * 1000)
    payload = live_position_payload(p)
    for field in ("ticket", "identifier", "symbol", "type", "magic", "reason", "volume",
                  "price_open", "price_current", "sl", "tp", "profit", "swap",
                  "comment", "time", "time_msc"):
        assert field in payload
    assert payload["identifier"] == 555
    assert payload["reason"] == 3
    assert payload["time_msc"] == JAN_1_2026 * 1000


def test_publish_live_uses_v2_keys_only():
    r = FakeRedis()
    acct = {"login": 7948784, "balance": 1000.0, "equity": 1047.5}
    publish_live(r, 7948784, acct, [])
    assert "mt5:v2:account:7948784:live" in r.hashes
    assert "mt5:v2:account:7948784:positions" in r.kv
    assert "mt5:v2:bridge:7948784:heartbeat" in r.hashes
    # Old-bridge namespace must remain untouched.
    assert not any(k.startswith("mt5:account:") for k in list(r.kv) + list(r.hashes))


def test_live_loop_publishes_no_close_events_when_a_ticket_disappears():
    r = FakeRedis()
    p = Position(1, 1, "EURUSD", 0, 0, 0, 0.1, 1.1, 1.2, 0, 0, 5.0, 0, "", JAN_1_2026, 0)
    publish_live(r, 7948784, {"login": 7948784}, [p])
    publish_live(r, 7948784, {"login": 7948784}, [])  # position vanished
    assert json.loads(r.kv["mt5:v2:account:7948784:positions"]) == []
    # No close/dedupe/stream side effects from the live path at all.
    assert r.streams == {}
