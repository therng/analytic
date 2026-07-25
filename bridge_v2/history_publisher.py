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


# ── Package 4: durable-mode ack + pending-window (retry-stable, no live-`now`
# recomputation while a window is unconfirmed) ───────────────────────────────

def _key_ack(login: int) -> str:
    return f"mt5:v2:history:{login}:ack"


def _key_pending_window(login: int) -> str:
    return f"mt5:v2:history:{login}:pending-window"


def _key_watermark(login: int) -> str:
    return f"mt5:v2:history:{login}:watermark"


def _read_watermark(redis_client, login: int) -> int | None:
    raw = redis_client.get(_key_watermark(login))
    if not raw:
        return None
    try:
        return int(raw)
    except (ValueError, TypeError):
        return None


def _read_ack(redis_client, login: int) -> dict | None:
    raw = redis_client.get(_key_ack(login))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def _read_pending_window(redis_client, login: int) -> tuple[int, int] | None:
    raw = redis_client.get(_key_pending_window(login))
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return int(data["start"]), int(data["end"])
    except (ValueError, KeyError, TypeError):
        return None


def _write_pending_window(redis_client, login: int, start: int, end: int) -> None:
    redis_client.set(_key_pending_window(login), json.dumps({"start": start, "end": end}))


def _clear_pending_window(redis_client, login: int) -> None:
    redis_client.delete(_key_pending_window(login))


def _resolve_durable_window(
    redis_client, login: int, now_epoch: int, start_epoch: int, window_days: int,
) -> tuple[int | None, int | None, str | None]:
    """Returns (window_start, window_end, parent_chunk_id), or (None, None, None)
    when idle. The ack mirror is the sole source of truth for both the cursor
    and the parent chunk id — the bridge's own cursor key is never read here.
    """
    ack = _read_ack(redis_client, login)
    cursor = int(ack["completedThroughServerTime"]) if ack else start_epoch
    parent_chunk_id = ack.get("lastCompletedChunkId") if ack else None

    pending = _read_pending_window(redis_client, login)
    if pending is not None:
        pending_start, pending_end = pending
        acked_through = int(ack["completedThroughServerTime"]) if ack else -1
        if acked_through < pending_end:
            # Not yet confirmed durable -> republish the exact same window,
            # byte-stable (same chunkId, same records, same digests), so the
            # consumer's replay-idempotency no-ops it rather than minting a
            # new orphaned chunk on every retry.
            return pending_start, pending_end, parent_chunk_id
        _clear_pending_window(redis_client, login)

    if cursor >= now_epoch:
        return None, None, None
    window_end = min(cursor + window_days * 86400, now_epoch)
    return cursor, window_end, parent_chunk_id


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
                      start_epoch: int, window_days: int = config.HISTORY_WINDOW_DAYS,
                      durable_mode: bool | None = None) -> dict:
    """Publish one bounded window of raw deals+orders as a chunk-and-barrier
    protocol, then advance the cursor.

    Returns a small status dict. Raises on MT5 failure so the caller does NOT
    advance the cursor (the raise happens before any Redis write).

    durable_mode (Package 4, default from config.V2_HISTORY_DURABLE_MODE):
    when on, the window start and parent chunk id are derived solely from
    the PostgreSQL-backed ack mirror (mt5:v2:history:{login}:ack), never
    from this bridge's own publish-progress cursor — see
    _resolve_durable_window. An unconfirmed window is republished
    byte-identically (same chunkId) until the ack catches up, rather than
    floating window_end with live `now` on every retry.
    """
    if durable_mode is None:
        durable_mode = config.V2_HISTORY_DURABLE_MODE

    if durable_mode:
        window_start, window_end, parent_chunk_id = _resolve_durable_window(
            redis_client, login, now_epoch, start_epoch, window_days,
        )
        if window_start is None:
            return {"idle": True, "cursor": read_cursor(redis_client, login, start_epoch)}
    else:
        cursor = read_cursor(redis_client, login, start_epoch)
        if cursor >= now_epoch:
            return {"idle": True, "cursor": cursor}
        prev_epoch = _read_prev_epoch(redis_client, login)
        window_start = cursor
        window_end = min(cursor + window_days * 86400, now_epoch)
        parent_chunk_id = f"{prev_epoch}:{window_start}" if prev_epoch is not None else None

    # Package 4 §2d: an operator/rollout script can freeze a per-account
    # target watermark (mt5:v2:history:{login}:watermark) — once the window
    # start reaches it, stop publishing without querying MT5 again. The
    # mechanism only; freezing/clearing the key is Package 5's runbook.
    watermark = _read_watermark(redis_client, login)
    if watermark is not None and window_start >= watermark:
        return {"idle": True, "cursor": window_start, "watermark_reached": True}

    date_from = datetime.fromtimestamp(window_start, tz=timezone.utc)
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
    chunk_id = _chunk_id(window_start, window_end)

    pipe = redis_client.pipeline(transaction=False)
    n_deals, _ = _queue_stream(
        pipe, config.STREAM_DEALS, login, "deals", deal_rows,
        chunk_id, parent_chunk_id, window_start, window_end, reached_present, "time",
    )
    n_orders, _ = _queue_stream(
        pipe, config.STREAM_ORDERS, login, "orders", order_rows,
        chunk_id, parent_chunk_id, window_start, window_end, reached_present, "time_setup",
    )
    pipe.execute()

    if durable_mode:
        # The bridge's own cursor key is still written for compatibility and
        # observability, but durable mode never reads it back as the window
        # start (see _resolve_durable_window) — the ack mirror is that source
        # of truth. Persist the pending window so a retry before the ack
        # lands republishes it byte-identically instead of floating with `now`.
        write_cursor(redis_client, login, window_end, prev_epoch=window_start)
        _write_pending_window(redis_client, login, window_start, window_end)
    else:
        # Every record + both barriers published — safe to advance. prev_epoch
        # becomes this chunk's own window_start, chaining the next call's
        # parentChunkId to this completed chunk.
        write_cursor(redis_client, login, window_end, prev_epoch=window_start)

    return {
        "idle": False, "cursor_from": window_start, "cursor_to": window_end,
        "deals_published": n_deals, "orders_published": n_orders,
        "reached_present": reached_present,
    }
