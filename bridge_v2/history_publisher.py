"""Phase 2 history path — raw Deals/Orders -> Redis streams, cursor-driven.

The bridge owns exactly ONE piece of state: its extraction cursor
(mt5:v2:history:{login}:cursor). No barriers, no custom ACK, no PostgreSQL
mirror, no parent chunk ids, no reconstruction checkpoints. Downstream
idempotency comes for free from stable MT5 ticket ids.

Cursor invariants:
  * advance ONLY after every record in the window is published successfully
  * never advance on an MT5 failure
  * never convert an MT5 failure into an empty window
  * republishing a window is safe downstream (stable ticket ids)
  * start is configurable; default 2026-01-01, never now-30d, never 2000
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from . import config
from .mt5_client import Mt5Client
from .serializers import serialize_record


def read_cursor(redis_client, login: int, default_epoch: int) -> int:
    raw = redis_client.get(config.key_history_cursor(login))
    if not raw:
        return default_epoch
    try:
        return int(json.loads(raw)["epoch"])
    except (ValueError, KeyError, TypeError):
        return default_epoch


def write_cursor(redis_client, login: int, epoch: int) -> None:
    redis_client.set(config.key_history_cursor(login), json.dumps({"epoch": int(epoch)}))


def _stream_message(login: int, kind: str, record: dict) -> dict:
    return {"data": json.dumps({"login": login, "kind": kind, "record": record}, default=str)}


def _queue_records(pipe, stream: str, login: int, kind: str, rows: tuple) -> None:
    for raw in rows:
        pipe.xadd(stream, _stream_message(login, kind, serialize_record(raw)))


def sync_history_once(client: Mt5Client, redis_client, login: int, now_epoch: int,
                      start_epoch: int, window_days: int = config.HISTORY_WINDOW_DAYS) -> dict:
    """Publish one bounded window of raw deals+orders, then advance the cursor.

    Returns a small status dict. Raises on MT5 failure so the caller does NOT
    advance the cursor (the raise happens before write_cursor).
    """
    cursor = read_cursor(redis_client, login, start_epoch)
    if cursor >= now_epoch:
        return {"idle": True, "cursor": cursor}

    window_end = min(cursor + window_days * 86400, now_epoch)
    date_from = datetime.fromtimestamp(cursor, tz=timezone.utc)
    date_to = datetime.fromtimestamp(window_end, tz=timezone.utc)

    deals = client.history_deals_get(date_from, date_to)
    if not deals.ok:
        raise RuntimeError(f"history_deals_get failed [{date_from}..{date_to}]: {deals.describe()}")
    orders = client.history_orders_get(date_from, date_to)
    if not orders.ok:
        raise RuntimeError(f"history_orders_get failed [{date_from}..{date_to}]: {orders.describe()}")

    deal_rows, order_rows = deals.rows(), orders.rows()
    pipe = redis_client.pipeline(transaction=False)
    _queue_records(pipe, config.STREAM_DEALS, login, "deal", deal_rows)
    _queue_records(pipe, config.STREAM_ORDERS, login, "order", order_rows)
    if deal_rows or order_rows:
        pipe.execute()
    n_deals, n_orders = len(deal_rows), len(order_rows)

    # Every record published — safe to advance.
    write_cursor(redis_client, login, window_end)
    return {
        "idle": False, "cursor_from": cursor, "cursor_to": window_end,
        "deals_published": n_deals, "orders_published": n_orders,
        "reached_present": window_end >= now_epoch,
    }
