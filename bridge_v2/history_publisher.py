"""Phase 2 history path — raw Deals/Orders -> Redis streams, chunk-and-barrier
protocol for Package 3b durable checkpointing (worker-v2 consumer side:
src/worker-v2/history-checkpoint.ts).

Envelope contract (binding — see docs/superpowers/plans/2026-07-25-worker-v2-
package-3b-durable-history-checkpoint-plan.md §1a):
  * Every "record" message carries {chunkId, parentChunkId, windowStart/End,
    reachedPresent, dealCursor, orderCursor, ordinal, expectedCount, eventKey,
    payload, payloadSha256}. For stream "deals", eventKey MUST equal the raw
    MT5 ticket as a string (== Deal.dealNo on the consumer side) — this is
    what lets the consumer derive touched positions from durable state alone.
  * One "barrier" message per stream follows all of that stream's records for
    a chunk, carrying {recordCount, recordsSha256} for consumer-side
    integrity verification before the checkpoint advances.

Determinism (load-bearing for replay-safety):
  * Records are sorted by (time, ticket) before ordinals are assigned — MT5
    row order across calls is not guaranteed, and replay/idempotency requires
    ordinal N to always mean the same record.
  * Payload hashing is canonical JSON (sorted keys, no whitespace) so retries
    of the same record hash identically.
  * The digest chain (next_records_sha256) must match the consumer's
    TypeScript implementation (nextRecordsSha256 in history-checkpoint.ts)
    byte-for-byte — both fold sha256(prev_hex + payload_hex), seeded from
    sha256("").hexdigest(). Pinned by
    bridge_v2/tests/test_history_publisher_envelope.py.

Cursor invariants (unchanged from the pre-chunk design):
  * advance ONLY after every record in the window is published successfully
  * never advance on an MT5 failure
  * never convert an MT5 failure into an empty window
  * start is configurable; default 2026-01-01, never now-30d, never 2000

Known, accepted gaps (see plan doc "log, not solve"):
  * A tail window's `window_end` is `min(cursor + window_days, now)` and is
    recomputed on every call, so a retried tail window can get a *different*
    chunkId than a prior attempt if `now` advanced meaningfully between
    tries, orphaning the earlier partially-applied chunk. The new chunk
    still completes correctly (its own windowStart equals the checkpoint's
    completedThroughServerTime), so this produces harmless orphaned rows, not
    a correctness break.
  * The cursor advances on publish success independent of consumer progress
    (Package 4 territory). If the consumer's checkpoint stalls on a blocking
    reconstruction outcome for chunk N, the producer keeps publishing N+1,
    N+2, ... which the consumer correctly rejects with "history coverage
    gap" until chunk N is resolved. Expected and unbounded within this
    package's scope.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from . import config
from .mt5_client import Mt5Client
from .serializers import serialize_record

EMPTY_RECORDS_SHA256 = hashlib.sha256(b"").hexdigest()


def canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def payload_sha256(payload: dict) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def next_records_sha256(previous_hex: str, payload_hex: str) -> str:
    """Must match history-checkpoint.ts's nextRecordsSha256 exactly: sha256 of
    the concatenated hex STRINGS (not raw digest bytes), UTF-8 encoded."""
    return hashlib.sha256((previous_hex + payload_hex).encode("utf-8")).hexdigest()


def read_cursor(redis_client, login: int, default_epoch: int) -> int:
    raw = redis_client.get(config.key_history_cursor(login))
    if not raw:
        return default_epoch
    try:
        return int(json.loads(raw)["epoch"])
    except (ValueError, KeyError, TypeError):
        return default_epoch


def _read_prev_epoch(redis_client, login: int) -> int | None:
    raw = redis_client.get(config.key_history_cursor(login))
    if not raw:
        return None
    try:
        value = json.loads(raw).get("prev_epoch")
        return int(value) if value is not None else None
    except (ValueError, TypeError):
        return None


def write_cursor(redis_client, login: int, epoch: int, prev_epoch: int | None = None) -> None:
    payload = {"epoch": int(epoch)}
    if prev_epoch is not None:
        payload["prev_epoch"] = int(prev_epoch)
    redis_client.set(config.key_history_cursor(login), json.dumps(payload))


def _chunk_id(window_start: int, window_end: int) -> str:
    return f"{window_start}:{window_end}"


def _record_envelope(
    login: int,
    stream: str,
    chunk_id: str,
    parent_chunk_id: str | None,
    window_start: int,
    window_end: int,
    reached_present: bool,
    ordinal: int,
    expected_count: int,
    event_key: str,
    payload: dict,
) -> dict:
    cursor = {"time": str(window_end), "ticket": "0"}
    return {
        "version": 1,
        "type": "record",
        "login": login,
        "stream": stream,
        "chunkId": chunk_id,
        "parentChunkId": parent_chunk_id,
        "windowStartServerTime": str(window_start),
        "windowEndServerTime": str(window_end),
        "reachedPresent": reached_present,
        "dealCursor": cursor,
        "orderCursor": cursor,
        "ordinal": ordinal,
        "expectedCount": expected_count,
        "eventKey": event_key,
        "payload": payload,
        "payloadSha256": payload_sha256(payload),
    }


def _barrier_envelope(
    login: int,
    stream: str,
    chunk_id: str,
    parent_chunk_id: str | None,
    window_start: int,
    window_end: int,
    reached_present: bool,
    record_count: int,
    records_sha256: str,
) -> dict:
    cursor = {"time": str(window_end), "ticket": "0"}
    return {
        "version": 1,
        "type": "barrier",
        "login": login,
        "stream": stream,
        "chunkId": chunk_id,
        "parentChunkId": parent_chunk_id,
        "windowStartServerTime": str(window_start),
        "windowEndServerTime": str(window_end),
        "reachedPresent": reached_present,
        "dealCursor": cursor,
        "orderCursor": cursor,
        "recordCount": record_count,
        "recordsSha256": records_sha256,
    }


def _stream_message(envelope: dict) -> dict:
    return {"data": json.dumps(envelope, default=str)}


def _sorted_rows(rows: tuple, time_field: str = "time") -> list:
    """Sort by (time, ticket) — the same key position-reconstructor.ts uses —
    so ordinal assignment is stable across retries regardless of MT5 row
    order."""
    return sorted(rows, key=lambda r: (getattr(r, time_field, 0) or 0, getattr(r, "ticket", 0)))


def _queue_stream(
    pipe,
    stream_key: str,
    login: int,
    stream_name: str,
    rows: list,
    chunk_id: str,
    parent_chunk_id: str | None,
    window_start: int,
    window_end: int,
    reached_present: bool,
    time_field: str,
) -> tuple[int, str]:
    """Queue one stream's records + trailing barrier. Returns (count, records_sha256)."""
    digest = EMPTY_RECORDS_SHA256
    expected_count = len(rows)
    for ordinal, raw in enumerate(rows):
        payload = serialize_record(raw)
        envelope = _record_envelope(
            login, stream_name, chunk_id, parent_chunk_id, window_start, window_end,
            reached_present, ordinal, expected_count, str(raw.ticket), payload,
        )
        digest = next_records_sha256(digest, envelope["payloadSha256"])
        pipe.xadd(stream_key, _stream_message(envelope))
    barrier = _barrier_envelope(
        login, stream_name, chunk_id, parent_chunk_id, window_start, window_end,
        reached_present, expected_count, digest,
    )
    pipe.xadd(stream_key, _stream_message(barrier))
    return expected_count, digest


def sync_history_once(client: Mt5Client, redis_client, login: int, now_epoch: int,
                      start_epoch: int, window_days: int = config.HISTORY_WINDOW_DAYS) -> dict:
    """Publish one bounded window of raw deals+orders as a chunk-and-barrier
    protocol, then advance the cursor.

    Returns a small status dict. Raises on MT5 failure so the caller does NOT
    advance the cursor (the raise happens before any Redis write).
    """
    cursor = read_cursor(redis_client, login, start_epoch)
    if cursor >= now_epoch:
        return {"idle": True, "cursor": cursor}

    prev_epoch = _read_prev_epoch(redis_client, login)
    window_end = min(cursor + window_days * 86400, now_epoch)
    date_from = datetime.fromtimestamp(cursor, tz=timezone.utc)
    date_to = datetime.fromtimestamp(window_end, tz=timezone.utc)

    deals = client.history_deals_get(date_from, date_to)
    if not deals.ok:
        raise RuntimeError(f"history_deals_get failed [{date_from}..{date_to}]: {deals.describe()}")
    orders = client.history_orders_get(date_from, date_to)
    if not orders.ok:
        raise RuntimeError(f"history_orders_get failed [{date_from}..{date_to}]: {orders.describe()}")

    deal_rows = _sorted_rows(deals.rows())
    order_rows = _sorted_rows(orders.rows(), time_field="time_setup")
    reached_present = window_end >= now_epoch
    chunk_id = _chunk_id(cursor, window_end)
    parent_chunk_id = f"{prev_epoch}:{cursor}" if prev_epoch is not None else None

    pipe = redis_client.pipeline(transaction=False)
    n_deals, _ = _queue_stream(
        pipe, config.STREAM_DEALS, login, "deals", deal_rows,
        chunk_id, parent_chunk_id, cursor, window_end, reached_present, "time",
    )
    n_orders, _ = _queue_stream(
        pipe, config.STREAM_ORDERS, login, "orders", order_rows,
        chunk_id, parent_chunk_id, cursor, window_end, reached_present, "time_setup",
    )
    pipe.execute()

    # Every record + both barriers published — safe to advance. prev_epoch
    # becomes this chunk's own window_start, chaining the next call's
    # parentChunkId to this completed chunk.
    write_cursor(redis_client, login, window_end, prev_epoch=cursor)
    return {
        "idle": False, "cursor_from": cursor, "cursor_to": window_end,
        "deals_published": n_deals, "orders_published": n_orders,
        "reached_present": reached_present,
    }
