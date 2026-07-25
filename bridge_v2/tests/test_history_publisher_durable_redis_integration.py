"""Cross-language integration: sync_history_once's durable-mode window
resolution against a REAL Redis server (not FakeRedis), reading an ack
payload in the exact shape worker-v2's mirrorHistoryCheckpoint writes.

Closes the loop test_history_publisher_durable.py can't: those tests prove
Python's own logic is correct against an in-memory double; this proves the
same logic works against a real redis-py client and — via the hardcoded
field names below, cross-checked against the TS integration test's own
assertions on those same field names — that the two languages agree on the
wire format without needing to run both processes against each other live.

Opt-in: requires the isolated test stack (npm run test:env:up, redis-test on
localhost:6380) and `redis` installed (not in bridge_v2/requirements.txt's
Windows-only MetaTrader5 dependency chain — install separately for this
test, e.g. into a throwaway venv).
"""

import json
import os
from collections import namedtuple

import pytest

redis = pytest.importorskip("redis", reason="redis-py not installed")

from bridge_v2.history_publisher import (  # noqa: E402
    sync_history_once,
    _key_ack,
    _key_pending_window,
)
from bridge_v2.mt5_client import CallResult, CallStatus  # noqa: E402

REDIS_URL = os.environ.get("REDIS_URL", "redis://:analytic_test@localhost:6380")
JAN_1_2026 = 1_767_225_600
Deal = namedtuple("Deal", "ticket order position_id symbol type entry volume price commission fee swap profit time comment")


def _require_real_redis():
    if "localhost:6380" not in REDIS_URL:
        pytest.skip("requires the disposable Redis stack on localhost:6380 (npm run test:env:up)")


class FakeClient:
    def __init__(self, deals=None):
        self._deals = CallResult(CallStatus.OK, value=deals or ())
        self._orders = CallResult(CallStatus.OK, value=())

    def history_deals_get(self, date_from, date_to):
        return self._deals

    def history_orders_get(self, date_from, date_to):
        return self._orders


@pytest.fixture
def real_redis():
    _require_real_redis()
    client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    client.ping()
    login = 99887766
    client.delete(_key_ack(login), _key_pending_window(login))
    yield client, login
    client.delete(_key_ack(login), _key_pending_window(login))
    client.close()


def test_durable_mode_reads_a_real_ack_written_in_worker_v2s_exact_shape(real_redis):
    client, login = real_redis
    # Exact shape mirrorHistoryCheckpoint (history-checkpoint.ts) writes —
    # cross-checked field-for-field against
    # history-checkpoint.integration.test.ts's own assertions on the same
    # real-Redis-written value (completedThroughServerTime, lastCompletedChunkId).
    client.set(
        _key_ack(login),
        json.dumps(
            {
                "version": 1,
                "ready": True,
                "accountId": "some-cuid",
                "phase": "incremental",
                "completedThroughServerTime": str(JAN_1_2026 + 10 * 86400),
                "dealsCursor": {"time": str(JAN_1_2026 + 10 * 86400), "ticket": "0"},
                "ordersCursor": {"time": str(JAN_1_2026 + 10 * 86400), "ticket": "0"},
                "lastCompletedChunkId": f"{JAN_1_2026}:{JAN_1_2026 + 10 * 86400}",
                "backfillCompletedAt": "2026-07-26T00:00:00.000Z",
            }
        ),
    )
    now = JAN_1_2026 + 40 * 86400
    status = sync_history_once(FakeClient(), client, login, now, JAN_1_2026, durable_mode=True)
    assert status["cursor_from"] == JAN_1_2026 + 10 * 86400


def test_durable_mode_pending_window_persists_and_reads_back_from_real_redis(real_redis):
    client, login = real_redis
    now = JAN_1_2026 + 5 * 86400  # tail window, clamped by now
    sync_history_once(FakeClient(), client, login, now, JAN_1_2026, durable_mode=True)
    pending_raw = client.get(_key_pending_window(login))
    assert pending_raw is not None
    pending = json.loads(pending_raw)
    assert pending["start"] == JAN_1_2026

    # Retry with a further-advanced `now` — must reuse the same pending window
    # (the tail-window churn fix), verified against a real Redis round-trip.
    later_now = now + 3600
    sync_history_once(FakeClient(), client, login, later_now, JAN_1_2026, durable_mode=True)
    still_pending = json.loads(client.get(_key_pending_window(login)))
    assert still_pending == pending
