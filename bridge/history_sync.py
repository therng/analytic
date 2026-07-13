"""Pure automatic history backfill state machine.

No MT5, Redis, or PostgreSQL dependencies.  Raw numeric times remain opaque
server-time values until the Node persistence mapper handles event rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import asdict, dataclass, field


MIN_HISTORY_START_TS = 946684800.0  # 2000-01-01 00:00:00
HISTORY_CHUNK_DAYS = int(os.environ.get("HISTORY_CHUNK_DAYS", "30"))
if HISTORY_CHUNK_DAYS <= 0:
    raise ValueError("HISTORY_CHUNK_DAYS must be greater than zero")

STREAMS = frozenset(("deals", "orders", "position-closed"))


@dataclass(frozen=True)
class HistoryWindow:
    start: float
    end: float


@dataclass(frozen=True)
class HistoryAck:
    chunk_id: str
    streams: frozenset[str]
    deals_cursor: tuple[float, int]
    orders_cursor: tuple[float, int]
    reached_present: bool = False
    reconstruction: dict = field(default_factory=dict)


@dataclass(frozen=True)
class HistoryChunk:
    chunk_id: str
    parent_chunk_id: str | None
    window: HistoryWindow
    deals_cursor: tuple[float, int]
    orders_cursor: tuple[float, int]
    deal_payloads: tuple[dict, ...]
    order_payloads: tuple[dict, ...]
    close_payloads: tuple[dict, ...]
    reached_present: bool = False


@dataclass
class _Checkpoint:
    phase: str = "backfill"
    completed_through: float = MIN_HISTORY_START_TS
    deals_cursor: tuple[float, int] = (MIN_HISTORY_START_TS, 0)
    orders_cursor: tuple[float, int] = (MIN_HISTORY_START_TS, 0)
    reconstruction: dict = field(default_factory=dict)
    last_chunk_id: str | None = None
    waiting_chunk_id: str | None = None


def _record_time(record: dict, *, order: bool = False) -> float:
    if order:
        done = float(record.get("time_done", 0) or 0)
        return done if done > 0 else float(record.get("time_setup", 0) or 0)
    return float(record.get("time", 0) or 0)


def _cursor(records: tuple[dict, ...], *, order: bool = False) -> tuple[float, int]:
    if not records:
        return (MIN_HISTORY_START_TS, 0)
    row = max(records, key=lambda item: (_record_time(item, order=order), int(item.get("ticket", 0) or 0)))
    return (_record_time(row, order=order), int(row.get("ticket", 0) or 0))


def _chunk_id(window: HistoryWindow, parent_chunk_id: str | None, deals_cursor: tuple[float, int], orders_cursor: tuple[float, int]) -> str:
    core = json.dumps(
        {
            "start": window.start,
            "end": window.end,
            "parent": parent_chunk_id,
            "deals": deals_cursor,
            "orders": orders_cursor,
        },
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(core).hexdigest()


class HistorySyncMachine:
    def __init__(self, checkpoint: _Checkpoint, window_days: int = HISTORY_CHUNK_DAYS):
        if window_days <= 0:
            raise ValueError("window_days must be greater than zero")
        self._checkpoint = checkpoint
        self.window_days = window_days
        self._pending_window_end: float | None = None
        self._pending_deals_cursor: tuple[float, int] | None = None
        self._pending_orders_cursor: tuple[float, int] | None = None

    @classmethod
    def initial(cls, window_days: int = HISTORY_CHUNK_DAYS) -> "HistorySyncMachine":
        return cls(_Checkpoint(), window_days)

    @classmethod
    def restore(cls, raw: str, window_days: int = HISTORY_CHUNK_DAYS) -> "HistorySyncMachine":
        try:
            data = json.loads(raw)
            completed_through = data.get("completedThrough", data.get("completedThroughServerTime"))
            deals_cursor = data.get("dealsCursor") or {"time": data["deals_cursor"]["time"], "ticket": data["deals_cursor"]["ticket"]}
            orders_cursor = data.get("ordersCursor") or {"time": data["orders_cursor"]["time"], "ticket": data["orders_cursor"]["ticket"]}
            checkpoint = _Checkpoint(
                phase=data["phase"],
                completed_through=float(completed_through),
                deals_cursor=(float(deals_cursor["time"]), int(deals_cursor["ticket"])),
                orders_cursor=(float(orders_cursor["time"]), int(orders_cursor["ticket"])),
                reconstruction=data.get("reconstruction", data.get("reconstructionState")) or {},
                last_chunk_id=data.get("lastChunkId", data.get("lastCompletedChunkId")),
                waiting_chunk_id=None,
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid durable history checkpoint: {exc}") from exc
        if checkpoint.completed_through < MIN_HISTORY_START_TS:
            raise ValueError("durable history checkpoint precedes 2000-01-01")
        if checkpoint.phase not in {"backfill", "incremental"}:
            raise ValueError(f"invalid durable history phase: {checkpoint.phase}")
        return cls(checkpoint, window_days)

    @property
    def checkpoint(self) -> _Checkpoint:
        return self._checkpoint

    def plan(self, now_ts: float) -> HistoryWindow | None:
        if self._checkpoint.waiting_chunk_id is not None:
            raise RuntimeError("cannot plan next history chunk before durable ack")
        start = self._checkpoint.completed_through
        if now_ts <= start:
            return None
        end = min(start + self.window_days * 86400, float(now_ts))
        return HistoryWindow(start, end)

    def stage(self, window: HistoryWindow, deals, orders, reached_present: bool | None = None) -> HistoryChunk:
        if self._checkpoint.waiting_chunk_id is not None:
            raise RuntimeError("history chunk already awaiting durable ack")
        if window.start != self._checkpoint.completed_through or window.end <= window.start:
            raise ValueError("history window does not start at confirmed coverage boundary")
        deal_payloads = tuple(dict(row) for row in deals)
        order_payloads = tuple(dict(row) for row in orders)
        deals_cursor = _cursor(deal_payloads) if deal_payloads else self._checkpoint.deals_cursor
        orders_cursor = _cursor(order_payloads, order=True) if order_payloads else self._checkpoint.orders_cursor
        if reached_present is None:
            reached_present = self._checkpoint.phase == "incremental"
        chunk = HistoryChunk(
            chunk_id=_chunk_id(window, self._checkpoint.last_chunk_id, deals_cursor, orders_cursor),
            parent_chunk_id=self._checkpoint.last_chunk_id,
            window=window,
            deals_cursor=deals_cursor,
            orders_cursor=orders_cursor,
            deal_payloads=deal_payloads,
            order_payloads=order_payloads,
            close_payloads=(),
            reached_present=reached_present,
        )
        self._checkpoint.waiting_chunk_id = chunk.chunk_id
        self._pending_window_end = window.end
        self._pending_deals_cursor = deals_cursor
        self._pending_orders_cursor = orders_cursor
        return chunk

    def confirm(self, ack: HistoryAck) -> bool:
        if self._checkpoint.waiting_chunk_id is None or ack.chunk_id != self._checkpoint.waiting_chunk_id:
            return False
        if ack.streams != STREAMS:
            return False
        # The staged target is encoded by chunk ID; cursor equality is checked
        # by the producer when it builds the ACK mirror.  Keep local state
        # monotonic even when a mirror is replayed after restart.
        if ack.deals_cursor < self._checkpoint.deals_cursor or ack.orders_cursor < self._checkpoint.orders_cursor:
            raise ValueError("durable history acknowledgement regressed cursor")
        if self._pending_deals_cursor and ack.deals_cursor != self._pending_deals_cursor:
            raise ValueError("durable history acknowledgement has wrong deal cursor")
        if self._pending_orders_cursor and ack.orders_cursor != self._pending_orders_cursor:
            raise ValueError("durable history acknowledgement has wrong order cursor")
        if self._pending_window_end is None:
            raise ValueError("durable history acknowledgement has no staged window")
        self._checkpoint.completed_through = self._pending_window_end
        self._checkpoint.deals_cursor = ack.deals_cursor
        self._checkpoint.orders_cursor = ack.orders_cursor
        self._checkpoint.last_chunk_id = ack.chunk_id
        self._checkpoint.reconstruction = ack.reconstruction
        self._checkpoint.waiting_chunk_id = None
        self._pending_window_end = None
        self._pending_deals_cursor = None
        self._pending_orders_cursor = None
        if ack.reached_present:
            self._checkpoint.phase = "incremental"
        return True

    def checkpoint_json(self) -> str:
        return json.dumps({
            "phase": self._checkpoint.phase,
            "completedThrough": self._checkpoint.completed_through,
            "dealsCursor": {"time": self._checkpoint.deals_cursor[0], "ticket": self._checkpoint.deals_cursor[1]},
            "ordersCursor": {"time": self._checkpoint.orders_cursor[0], "ticket": self._checkpoint.orders_cursor[1]},
            "reconstruction": self._checkpoint.reconstruction,
            "lastChunkId": self._checkpoint.last_chunk_id,
        }, separators=(",", ":"))


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MT5 Bridge history diagnostics")
    parser.add_argument("--terminal-path", required=True)
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--startup-jitter", type=float, default=0.0)
    parser.add_argument("--mode", choices=["live", "discover-history"], default="live")
    return parser
