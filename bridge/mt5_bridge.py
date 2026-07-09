"""
MT5 Bridge: connects to one portable MT5 terminal and pushes live data to Redis.

One process per terminal, launched by run_all.py.

Exit codes (read by supervisor in run_all.py):
  EXIT_OK        0   — clean shutdown (signal received)
  EXIT_DUPLICATE 20  — another bridge owns this login; supervisor should wait for
                       the heartbeat to expire before respawning
  EXIT_AUTH      30  — terminal not logged in; needs manual intervention
  EXIT_IPC       40  — too many consecutive MT5 API failures
  EXIT_REDIS     50  — too many consecutive Redis failures
  EXIT_FATAL     99  — unrecoverable startup error (bad path, import failure)

Redis keys written:
  mt5:bridge:lock:{login}          String (NX, TTL)  — exclusive process lock
  mt5:bridge:pid:{pid}             String (TTL)      — pid→login for supervisor join
  mt5:bridge:heartbeat:{login}     Hash   (TTL)      — liveness/health info
  mt5:account:{login}:live         Hash   (no TTL)   — account financials
  mt5:account:{login}:positions    String JSON (TTL) — open positions
  mt5:account:{login}:position-state  Hash (no TTL)     — running MAE/MFE per open ticket
  mt5:account:{login}:equity-state    Hash (no TTL)     — running peak equity
  mt5:account:{login}:deals-stream    Stream (maxlen)   — closed deals, "data" field JSON
  mt5:account:{login}:orders-stream   Stream (maxlen)   — closed orders, "data" field JSON
  mt5:account:{login}:position-closed-stream  Stream (maxlen)  — enriched close events, "data" field JSON
  mt5:account:{login}:position-closed-dedupe  Set (no TTL)  — position ids already published to closed stream
  mt5:bridge:history-cursor:{login}   String (no TTL)   — JSON with independent deals/orders cursors

Manual verification (Windows VPS, after deploy):
  1. Start one bridge process against a live/demo terminal with an open position.
  2. redis-cli HGETALL mt5:account:{login}:position-state — confirm one entry per
     open ticket with mae <= 0 <= mfe.
  3. Let price move, confirm mae/mfe widen (never narrow) on subsequent polls.
  4. Kill and restart the bridge process; confirm HGETALL still shows the same
     ticket's mae/mfe (not reset to 0) — proves restart reseeding works.
  5. Close the position in the terminal; confirm the ticket disappears from
     mt5:account:{login}:position-state within one poll cycle.
  6. Close a trade in the terminal, wait up to HISTORY_SYNC_INTERVAL (30s).
  7. redis-cli XLEN mt5:account:{login}:deals-stream — confirm it increased.
  8. redis-cli XRANGE mt5:account:{login}:deals-stream - + COUNT 1 — confirm the
     "data" field JSON has the expected keys (ticket, order, positionId, symbol,
     type, volume, price, commission, fee, swap, profit, time, comment).
  9. redis-cli GET mt5:bridge:history-cursor:{login} — confirm it advanced to
     {"deals":{"time":...,"ticket":...},"orders":{"time":...,"ticket":...}}.
  10. Restart the bridge process; confirm the cursor is NOT reset (history sync
      resumes from the persisted cursor, doesn't rescan the full initial history window).
  11. Close a trade in the terminal.
  12. redis-cli XRANGE mt5:account:{login}:position-closed-stream - + COUNT 1 —
      confirm exactly one new entry, "data" JSON has mae <= 0 <= mfe matching
      what was seen in position-state before the close, and exitPrice/profit
      are populated (not null) once history_deals_get(position=ticket) has
      the matching deal (may need one extra poll cycle if MT5 hasn't
      registered the deal yet — note this as a known small race in the
      module docstring).

Known race condition: when a position closes, the closing deal may not yet
be visible via mt5.history_deals_get(position=ticket) on the same poll cycle
that detects the ticket as closed (MT5 can lag briefly registering history).
In that case exitPrice/profit/commission/swap/dealTicket/orderTicket are
published as null with exitTime falling back to "now" — downstream consumers
should treat a null exitPrice as "pending enrichment" rather than a permanent
value.
"""

import argparse
import hashlib
import json
import logging
import math
import os
import signal

import sys
import threading
import time
from datetime import datetime, timedelta

from tracking import PositionTracker, EquityTrack, compute_drawdown

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Exit codes ─────────────────────────────────────────────────────────────────
EXIT_OK        = 0
EXIT_DUPLICATE = 20
EXIT_AUTH      = 30
EXIT_IPC       = 40
EXIT_REDIS     = 50
EXIT_FATAL     = 99

# MT5 DEAL_TYPE enum → lowercase string, matching the dashboard analytics convention
# (src/lib/trading/analytics.ts normalizeTradeSide/isBalanceDeal expect
# lowercase "buy"/"sell", and treat anything containing "balance"/"credit"
# etc. as a funding operation via comment/type text matching).
DEAL_TYPE_MAP = {
    0: "buy", 1: "sell", 2: "balance", 3: "credit", 4: "charge",
    5: "correction", 6: "bonus", 7: "commission", 8: "commission daily",
    9: "commission monthly", 10: "commission agent daily",
    11: "commission agent monthly", 12: "interest", 13: "buy canceled",
    14: "sell canceled", 15: "dividend", 16: "dividend franked",
    17: "tax",
}

POSITION_COST_DEAL_TYPES = {4, 7, 8, 9, 10, 11, 17}

# MT5 ORDER_TYPE enum → lowercase string.
ORDER_TYPE_MAP = {
    0: "buy", 1: "sell", 2: "buy limit", 3: "sell limit",
    4: "buy stop", 5: "sell stop", 6: "buy stop limit", 7: "sell stop limit",
}


def _deal_type_str(code: int) -> str:
    return DEAL_TYPE_MAP.get(code, f"type_{code}")


def _order_type_str(code: int) -> str:
    return ORDER_TYPE_MAP.get(code, f"type_{code}")


def _deal_entry(deal) -> int | None:
    value = getattr(deal, "entry", None)
    return int(value) if value is not None else None


def _deal_type_code(deal) -> int | None:
    value = getattr(deal, "type", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _is_trade_deal(deal) -> bool:
    return getattr(deal, "symbol", "") != "" and getattr(deal, "position_id", 0) not in (None, 0)


def _is_exit_deal(deal) -> bool:
    # MT5 DEAL_ENTRY_OUT=1, INOUT=2, OUT_BY=3. Older terminals can omit
    # `entry`; in that case a trade deal with non-zero profit is the best
    # available close signal.
    entry = _deal_entry(deal)
    if entry in (1, 2, 3):
        return True
    return entry is None and _is_trade_deal(deal) and abs(float(getattr(deal, "profit", 0) or 0)) > 0


def _deal_balance_delta(deal) -> float:
    return (
        float(getattr(deal, "profit", 0) or 0)
        + float(getattr(deal, "commission", 0) or 0)
        + float(getattr(deal, "fee", 0) or 0)
        + float(getattr(deal, "swap", 0) or 0)
    )


def _belongs_to_position(position_id: int, deal) -> bool:
    deal_position_id = getattr(deal, "position_id", position_id)
    if deal_position_id in (None, 0):
        return True
    try:
        return int(deal_position_id) == int(position_id)
    except (TypeError, ValueError):
        return False


def _is_position_cost_deal(deal) -> bool:
    return _deal_type_code(deal) in POSITION_COST_DEAL_TYPES


def _position_profit_component(deal) -> float:
    if _is_position_cost_deal(deal):
        return 0.0
    return float(getattr(deal, "profit", 0) or 0)


def _position_commission_component(deal) -> float:
    commission = float(getattr(deal, "commission", 0) or 0)
    fee = float(getattr(deal, "fee", 0) or 0)
    cost_profit = float(getattr(deal, "profit", 0) or 0) if _is_position_cost_deal(deal) else 0.0
    return commission + fee + cost_profit


def _position_close_payload_from_deals(position_id: int, deals) -> dict | None:
    position_deals = sorted(
        [d for d in deals if _belongs_to_position(position_id, d)],
        key=lambda d: (getattr(d, "time", 0), getattr(d, "ticket", 0)),
    )
    trade_deals = [d for d in position_deals if _is_trade_deal(d)]
    if not trade_deals:
        return None

    entry_deals = [d for d in trade_deals if _deal_entry(d) in (0, 2) or _deal_entry(d) is None]
    exit_deals = [d for d in trade_deals if _is_exit_deal(d)]
    if not exit_deals:
        return None

    entry_deal = entry_deals[0] if entry_deals else trade_deals[0]
    exit_deal = exit_deals[-1]
    entry_time = int(getattr(entry_deal, "time", 0) or 0)
    exit_time = int(getattr(exit_deal, "time", 0) or 0)
    last_comment = next(
        (getattr(d, "comment", "") for d in reversed(position_deals) if getattr(d, "comment", "")),
        "",
    )

    return {
        "ticket": position_id,
        "symbol": getattr(entry_deal, "symbol", "") or getattr(exit_deal, "symbol", ""),
        "positionType": int(getattr(entry_deal, "type", 0) or 0),
        "volume": sum(float(getattr(d, "volume", 0) or 0) for d in entry_deals) or float(getattr(entry_deal, "volume", 0) or 0),
        "entryPrice": float(getattr(entry_deal, "price", 0) or 0),
        "exitPrice": float(getattr(exit_deal, "price", 0) or 0),
        "entryTime": entry_time,
        "exitTime": exit_time,
        "durationSeconds": max(0, exit_time - entry_time),
        "mae": 0,
        "mfe": 0,
        "profit": sum(_position_profit_component(d) for d in position_deals),
        "commission": sum(_position_commission_component(d) for d in position_deals),
        "swap": sum(float(getattr(d, "swap", 0) or 0) for d in position_deals),
        "dealTicket": getattr(exit_deal, "ticket", None),
        "orderTicket": getattr(exit_deal, "order", None),
        "comment": last_comment,
    }


def _build_close_event_from_track(track, deals, now_ts: float) -> dict:
    close_event = _position_close_payload_from_deals(track.ticket, deals)
    if close_event:
        close_event["symbol"] = track.symbol or close_event.get("symbol")
        close_event["positionType"] = track.position_type
        close_event["volume"] = track.volume
        close_event["entryPrice"] = track.entry_price
        close_event["entryTime"] = track.first_seen_ts
        close_event["mae"] = track.mae
        close_event["mfe"] = track.mfe
        close_event["durationSeconds"] = max(0, close_event["exitTime"] - close_event["entryTime"])
        return close_event

    return {
        "ticket": track.ticket,
        "symbol": track.symbol,
        "positionType": track.position_type,
        "volume": track.volume,
        "entryPrice": track.entry_price,
        "exitPrice": None,
        "entryTime": track.first_seen_ts,
        "exitTime": now_ts,
        "durationSeconds": max(0, now_ts - track.first_seen_ts),
        "mae": track.mae,
        "mfe": track.mfe,
        "profit": None,
        "commission": None,
        "swap": None,
        "dealTicket": None,
        "orderTicket": None,
        "comment": "",
    }


# ── Config ─────────────────────────────────────────────────────────────────────
LOCK_TTL            = int(os.environ.get("LOCK_TTL",            "15"))
LOCK_REFRESH        = int(os.environ.get("LOCK_REFRESH",        "5"))
POSITIONS_TTL       = int(os.environ.get("POSITIONS_TTL",       "10"))
HEARTBEAT_TTL       = int(os.environ.get("HEARTBEAT_TTL",       "10"))
PID_KEY_TTL         = int(os.environ.get("PID_KEY_TTL",         "30"))  # how long pid→login lives
IPC_FAIL_THRESHOLD  = int(os.environ.get("IPC_FAIL_THRESHOLD",  "5"))   # consecutive MT5 failures → EXIT_IPC
REDIS_FAIL_THRESHOLD= int(os.environ.get("REDIS_FAIL_THRESHOLD","5"))   # consecutive Redis failures → EXIT_REDIS
HISTORY_SYNC_INTERVAL = float(os.environ.get("HISTORY_SYNC_INTERVAL", "30"))
HISTORY_TOTALS_INTERVAL = float(os.environ.get("HISTORY_TOTALS_INTERVAL", "60"))
HISTORY_TOTALS_INTERVAL = max(60.0, HISTORY_TOTALS_INTERVAL)
HISTORY_TOTALS_DAYS  = int(os.environ.get("HISTORY_TOTALS_DAYS", "30"))
HISTORY_STREAM_MAXLEN  = int(os.environ.get("HISTORY_STREAM_MAXLEN",  "100000"))
HISTORY_BACKFILL_DAYS  = int(os.environ.get("HISTORY_BACKFILL_DAYS",  "0"))
HISTORY_WARNING_INTERVAL = 60.0

RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
"""

EXTEND_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
else
  return 0
end
"""

CLOSE_EVENT_SCRIPT = """
if redis.call('sadd', KEYS[2], ARGV[1]) == 1 then
  return redis.call('xadd', KEYS[1], 'MAXLEN', '~', ARGV[2], '*', 'data', ARGV[3])
else
  return 0
end
"""


def _hash(data: str) -> str:
    return hashlib.md5(data.encode(), usedforsecurity=False).hexdigest()


def _history_start_timestamp(now_ts: float, backfill_days: int) -> float:
    if backfill_days > 0:
        return max(0.0, now_ts - backfill_days * 86400)
    return 0.0


def _history_totals_start_timestamp(now_ts: float, totals_days: int) -> float:
    days = max(1, totals_days)
    return max(0.0, now_ts - days * 86400)


def _valid_cursor_pair(cursor_time, cursor_ticket) -> tuple[float, int] | None:
    if cursor_time is None and cursor_ticket is None:
        return None
    try:
        parsed_time = float(cursor_time or 0)
        parsed_ticket = int(cursor_ticket or 0)
    except (TypeError, ValueError):
        return None
    if math.isfinite(parsed_time) and parsed_time >= 0 and parsed_ticket >= 0:
        return parsed_time, parsed_ticket
    return None


def _legacy_history_cursor(cursor_raw) -> tuple[float, int] | None:
    try:
        cursor = float(cursor_raw)
    except (TypeError, ValueError):
        return None
    if math.isfinite(cursor) and cursor >= 0:
        return cursor, 0
    return None


def _initial_history_cursor(now_ts: float, backfill_days: int) -> tuple[float, int]:
    return _history_start_timestamp(now_ts, backfill_days), 0


def _history_cursor_from_raw(cursor_raw: str | None, now_ts: float, backfill_days: int) -> tuple[float, int]:
    if cursor_raw:
        try:
            cursor = json.loads(cursor_raw)
            if isinstance(cursor, dict):
                parsed = _valid_cursor_pair(cursor.get("time"), cursor.get("ticket"))
                if parsed:
                    return parsed
        except (TypeError, ValueError, json.JSONDecodeError):
            pass

        # Backward compatibility: old cursor values were plain unix timestamps.
        parsed = _legacy_history_cursor(cursor_raw)
        if parsed:
            return parsed

    return _initial_history_cursor(now_ts, backfill_days)


def _history_cursors_from_raw(
    cursor_raw: str | None,
    now_ts: float,
    backfill_days: int,
) -> tuple[tuple[float, int], tuple[float, int]]:
    fallback = _initial_history_cursor(now_ts, backfill_days)
    if not cursor_raw:
        return fallback, fallback

    try:
        cursor = json.loads(cursor_raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        legacy_cursor = _legacy_history_cursor(cursor_raw) or fallback
        return legacy_cursor, legacy_cursor

    if not isinstance(cursor, dict):
        legacy_cursor = _legacy_history_cursor(cursor) or fallback
        return legacy_cursor, legacy_cursor

    legacy_cursor = _valid_cursor_pair(cursor.get("time"), cursor.get("ticket"))
    if legacy_cursor:
        return legacy_cursor, legacy_cursor

    deals_cursor = fallback
    orders_cursor = fallback
    if isinstance(cursor.get("deals"), dict):
        deals_cursor = _valid_cursor_pair(cursor["deals"].get("time"), cursor["deals"].get("ticket")) or fallback
    if isinstance(cursor.get("orders"), dict):
        orders_cursor = _valid_cursor_pair(cursor["orders"].get("time"), cursor["orders"].get("ticket")) or fallback
    return deals_cursor, orders_cursor


def _history_cursor_json(deals_cursor: tuple[float, int], orders_cursor: tuple[float, int]) -> str:
    return json.dumps(
        {
            "deals": {"time": deals_cursor[0], "ticket": deals_cursor[1]},
            "orders": {"time": orders_cursor[0], "ticket": orders_cursor[1]},
        },
        separators=(",", ":"),
    )


def _deal_cursor(deal) -> tuple[float, int]:
    return float(getattr(deal, "time", 0) or 0), int(getattr(deal, "ticket", 0) or 0)


def _order_cursor(order) -> tuple[float, int]:
    return (
        float(getattr(order, "time_done", 0) or getattr(order, "time_setup", 0) or 0),
        int(getattr(order, "ticket", 0) or 0),
    )


def _deal_after_cursor(deal, cursor: tuple[float, int]) -> bool:
    return _deal_cursor(deal) > cursor


def _order_after_cursor(order, cursor: tuple[float, int]) -> bool:
    return _order_cursor(order) > cursor


def _deal_direction(deal) -> str | None:
    if not _is_trade_deal(deal):
        return None
    entry = _deal_entry(deal)
    if entry == 0:
        return "in"
    if entry in (1, 2, 3):
        return "out"
    return "out" if abs(float(getattr(deal, "profit", 0) or 0)) > 0 else "in"


def _deal_payload(deal, balance_after: float | None) -> dict:
    direction = _deal_direction(deal)
    payload = {
        "ticket": deal.ticket,
        "order": deal.order,
        "positionId": deal.position_id,
        "symbol": deal.symbol,
        "type": _deal_type_str(deal.type),
        "direction": direction,
        "volume": deal.volume,
        "price": deal.price,
        "commission": deal.commission,
        "fee": deal.fee,
        "swap": deal.swap,
        "profit": deal.profit,
        "balanceAfter": balance_after,
        "time": deal.time,
        "comment": deal.comment,
    }
    payload.update({
        "deal_id": str(deal.ticket),
        "order_id": str(deal.order) if deal.order not in (None, 0, "") else None,
        "position_no": str(deal.position_id) if deal.position_id not in (None, 0, "") else None,
        "balance_after": balance_after,
    })
    return payload


def _order_payload(order) -> dict:
    payload = {
        "ticket": order.ticket,
        "positionId": order.position_id,
        "symbol": order.symbol,
        "type": _order_type_str(order.type),
        "state": str(order.state),
        "volume": order.volume_initial,
        "priceOpen": order.price_open,
        "sl": order.sl,
        "tp": order.tp,
        "timeSetup": order.time_setup,
        "timeDone": order.time_done,
        "comment": order.comment,
    }
    payload.update({
        "order_id": str(order.ticket),
        "position_no": str(order.position_id) if order.position_id not in (None, 0, "") else None,
        "open_time": order.time_setup,
        "close_time": order.time_done or None,
        "price": order.price_open,
    })
    return payload



def _terminal_process_is_running(terminal_path: str) -> bool:
    """
    Return True only when exactly one portable terminal process is already running.
    This check prevents the bridge from launching a new terminal process and
    avoids attaching to a path that has multiple instances running.
    """
    if os.name != "nt":
        # On non-Windows systems, assume it's running for development.
        return True

    try:
        import psutil
    except ImportError:
        log.error("psutil is not installed. Run: pip install psutil")
        return False  # CRITICAL: Must not assume running if psutil is missing.

    target_path = os.path.normcase(os.path.abspath(terminal_path))
    matches = []
    # Using ad_value=None makes psutil return None for restricted processes
    # instead of raising AccessDenied, which is more efficient.
    for proc in psutil.process_iter(attrs=["exe", "name"], ad_value=None):
        try:
            if proc.info["name"] and proc.info["name"].lower() == "terminal64.exe":
                proc_path = proc.info["exe"]
                if proc_path and os.path.normcase(os.path.abspath(proc_path)) == target_path:
                    matches.append(proc.pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            # Should not happen with ad_value=None, but defensive.
            continue
        except Exception as exc:
            log.warning("Error checking process %s: %s", proc.pid, exc)

    if len(matches) == 1:
        return True

    if len(matches) > 1:
        log.error(
            "Multiple terminal64.exe processes are running for %s: PIDs %s",
            terminal_path,
            matches,
        )

    return False


def _initialize_mt5_terminal(mt5, terminal_path: str) -> bool:
    if not _terminal_process_is_running(terminal_path):
        log.error(
            "Terminal is not already running: %s. Open it with /portable before starting the bridge.",
            terminal_path,
        )
        return False

    return bool(mt5.initialize(path=terminal_path, portable=True))


def _mt5_attr(value, name: str, default=""):
    return getattr(value, name, default) if value is not None else default


def _optional_int(value):
    if value in (None, ""):
        return ""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(numeric):
        return ""
    return int(numeric)


def _redis_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and not math.isfinite(value):
        return ""
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _redis_mapping(mapping: dict) -> dict:
    return {key: _redis_value(value) for key, value in mapping.items()}


def run(terminal_path: str, redis_url: str, poll_interval: float = 2.0, startup_jitter: float = 0.0) -> None:
    if startup_jitter > 0:
        log.info("Startup jitter: sleeping %.2fs before connecting", startup_jitter)
        time.sleep(startup_jitter)

    try:
        import MetaTrader5 as mt5  # type: ignore[import]
    except ImportError:
        log.error("MetaTrader5 not installed. Run: pip install MetaTrader5")
        sys.exit(EXIT_FATAL)

    try:
        import redis as redislib  # type: ignore[import]
    except ImportError:
        log.error("redis not installed. Run: pip install redis")
        sys.exit(EXIT_FATAL)

    pid = str(os.getpid())
    mt5_lock = threading.Lock()
    startup_time = time.monotonic()

    def _mt5_call(fn, *args, **kwargs):
        with mt5_lock:
            return fn(*args, **kwargs)

    history_warning_last_seen: dict[str, float] = {}

    def _warn_history_once(key: str, message: str, exc: Exception) -> None:
        now = time.monotonic()
        elapsed_since_startup = now - startup_time
        startup_grace_period = 60.0
        last_seen = history_warning_last_seen.get(key, 0.0)

        if elapsed_since_startup < startup_grace_period:
            return
        if now - last_seen < HISTORY_WARNING_INTERVAL:
            return

        history_warning_last_seen[key] = now
        mt5_err = _mt5_call(mt5.last_error)
        log.warning("%s (login=%s): %s [mt5_err=%s]", message, login, exc, mt5_err)

    def _safe_history_call(key: str, message: str, fn, *args, default=None, **kwargs):
        try:
            result = _mt5_call(fn, *args, **kwargs)
            return default if result is None else result
        except Exception as exc:
            _warn_history_once(key, message, exc)
            return default

    def _mt5_initialize() -> bool:
        return _mt5_call(_initialize_mt5_terminal, mt5, terminal_path)

    def _mt5_last_error():
        return _mt5_call(mt5.last_error)

    def _mt5_shutdown() -> None:
        _mt5_call(mt5.shutdown)

    # ── Connect to Redis first so we can write pid→login on duplicate ──────────
    try:
        r = redislib.from_url(redis_url, decode_responses=True, protocol=2)
        r.ping()
    except Exception as exc:
        log.error("Cannot connect to Redis: %s", exc)
        sys.exit(EXIT_REDIS)

    # ── Connect to MT5 terminal ────────────────────────────────────────────────
    log.info("Connecting to terminal: %s", terminal_path)
    if not _mt5_initialize():
        log.error("mt5.initialize failed: %s", _mt5_last_error())
        sys.exit(EXIT_FATAL)

    info = _mt5_call(mt5.account_info)
    if not info:
        log.error("account_info() returned None after init — terminal not logged in: %s", _mt5_last_error())
        _mt5_shutdown()
        sys.exit(EXIT_AUTH)

    login = info.login
    log.info("Connected — login=%s  balance=%.2f %s", login, info.balance, info.currency)

    tracker = PositionTracker()
    equity_track = EquityTrack.start(info.equity, time.time())

    key_lock = f"mt5:bridge:lock:{login}"
    key_live = f"mt5:account:{login}:live"
    key_pos  = f"mt5:account:{login}:positions"
    key_hb   = f"mt5:bridge:heartbeat:{login}"
    key_pid  = f"mt5:bridge:pid:{pid}"
    key_pos_state    = f"mt5:account:{login}:position-state"
    key_equity_state = f"mt5:account:{login}:equity-state"
    key_deals_stream    = f"mt5:account:{login}:deals-stream"
    key_orders_stream   = f"mt5:account:{login}:orders-stream"
    key_closed_stream   = f"mt5:account:{login}:position-closed-stream"
    key_closed_dedupe   = f"mt5:account:{login}:position-closed-dedupe"
    key_history_cursor  = f"mt5:bridge:history-cursor:{login}"

    try:
        for ticket_str, state_json in r.hgetall(key_pos_state).items():
            tracker.seed(int(ticket_str), json.loads(state_json))
        equity_state_raw = r.hgetall(key_equity_state)
        if equity_state_raw:
            equity_track = EquityTrack.from_state(equity_state_raw)
    except Exception as exc:
        log.warning("Could not reseed tracking state for login=%s: %s", login, exc)

    release_script = r.register_script(RELEASE_SCRIPT)
    extend_script  = r.register_script(EXTEND_SCRIPT)
    close_event_script = r.register_script(CLOSE_EVENT_SCRIPT)

    def _publish_close_event_once(close_payload: dict) -> None:
        position_id = close_payload.get("ticket")
        if position_id in (None, ""):
            log.warning("Skipping close event without ticket (login=%s)", login)
            return
        close_event_script(
            keys=[key_closed_stream, key_closed_dedupe],
            args=[str(position_id), HISTORY_STREAM_MAXLEN, json.dumps(close_payload)],
        )

    # ── Write pid→login so supervisor can join on exit code ────────────────────
    r.set(key_pid, str(login), ex=PID_KEY_TTL)

    # ── Acquire exclusive lock ─────────────────────────────────────────────────
    acquired = r.set(key_lock, pid, nx=True, ex=LOCK_TTL)
    if not acquired:
        existing_pid = r.get(key_lock)
        log.warning(
            "Bridge for login=%s already running (PID=%s). Exiting — supervisor will wait for heartbeat to expire.",
            login, existing_pid,
        )
        _mt5_shutdown()
        sys.exit(EXIT_DUPLICATE)

    log.info("Lock acquired for login=%s (PID=%s)", login, pid)

    # Extend pid key TTL for the lifetime of the process
    r.expire(key_pid, LOCK_TTL + 5)

    # ── Graceful shutdown ──────────────────────────────────────────────────────
    stop_event = threading.Event()
    lock_lost  = threading.Event()

    def _request_stop(sig, frame):
        log.info("Received signal %s, shutting down...", sig)
        stop_event.set()

    signal.signal(signal.SIGINT,  _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _request_stop)

    # ── Background thread: keep lock and pid key alive ─────────────────────────
    def _refresh_lock() -> None:
        while not stop_event.is_set():
            try:
                if extend_script(keys=[key_lock], args=[pid, LOCK_TTL]) == 0:
                    log.error("Lost ownership of lock for login=%s — stopping.", login)
                    lock_lost.set()
                    stop_event.set()
                    return
                r.expire(key_pid, LOCK_TTL + 5)
            except Exception as exc:
                log.warning("Lock refresh error (login=%s): %s", login, exc)
            stop_event.wait(LOCK_REFRESH)

    lock_thread = threading.Thread(target=_refresh_lock, daemon=True, name=f"lock-{login}")
    lock_thread.start()

    # ── Background thread: sync closed-trade history to Redis streams ──────────
    def _history_sync() -> None:
        while not stop_event.is_set():
            try:
                cursor_raw = r.get(key_history_cursor)
                deals_cursor, orders_cursor = _history_cursors_from_raw(
                    cursor_raw,
                    time.time(),
                    HISTORY_BACKFILL_DAYS,
                )
                deals_date_from = datetime.fromtimestamp(deals_cursor[0])
                orders_date_from = datetime.fromtimestamp(orders_cursor[0])
                date_to = datetime.now() + timedelta(minutes=5)

                deals_msg = f"History sync deals fetch failed (range {deals_date_from.isoformat()} to {date_to.isoformat()})"
                deals = _safe_history_call(
                    "history_deals_get_range",
                    deals_msg,
                    mt5.history_deals_get,
                    deals_date_from,
                    date_to,
                    default=(),
                )
                orders_msg = f"History sync orders fetch failed (range {orders_date_from.isoformat()} to {date_to.isoformat()})"
                orders = _safe_history_call(
                    "history_orders_get_range",
                    orders_msg,
                    mt5.history_orders_get,
                    orders_date_from,
                    date_to,
                    default=(),
                )

                pipe = r.pipeline(transaction=False)
                max_deals_cursor = deals_cursor
                max_orders_cursor = orders_cursor
                closed_position_ids: set[int] = set()

                visible_deals = sorted(
                    [d for d in deals if _deal_after_cursor(d, deals_cursor)],
                    key=_deal_cursor,
                )
                if visible_deals:
                    account_info = _mt5_call(mt5.account_info)
                    ending_balance = float(getattr(account_info, "balance", 0) or 0) if account_info else 0
                    running_balance = ending_balance - sum(_deal_balance_delta(d) for d in visible_deals)

                for d in visible_deals:
                    running_balance += _deal_balance_delta(d)
                    if _is_exit_deal(d):
                        closed_position_ids.add(int(d.position_id))
                    payload = _deal_payload(d, running_balance)
                    pipe.xadd(
                        key_deals_stream, {"data": json.dumps(payload)},
                        maxlen=HISTORY_STREAM_MAXLEN, approximate=True,
                    )
                    max_deals_cursor = max(max_deals_cursor, _deal_cursor(d))

                for position_id in closed_position_ids:
                    try:
                        position_deals = _safe_history_call(
                            "history_deals_get_position_sync",
                            f"Historical close-event deals fetch failed for position={position_id}",
                            mt5.history_deals_get,
                            position=position_id,
                            default=(),
                        )
                        close_payload = _position_close_payload_from_deals(position_id, position_deals)
                    except Exception as exc:
                        log.warning(
                            "Could not build historical close event for position=%s (login=%s): %s",
                            position_id, login, exc,
                        )
                        continue
                    if not close_payload:
                        continue
                    _publish_close_event_once(close_payload)

                visible_orders = sorted(
                    [o for o in orders if _order_after_cursor(o, orders_cursor)],
                    key=_order_cursor,
                )
                for o in visible_orders:
                    payload = _order_payload(o)
                    pipe.xadd(
                        key_orders_stream, {"data": json.dumps(payload)},
                        maxlen=HISTORY_STREAM_MAXLEN, approximate=True,
                    )
                    max_orders_cursor = max(max_orders_cursor, _order_cursor(o))

                pipe.execute()
                if max_deals_cursor > deals_cursor or max_orders_cursor > orders_cursor:
                    r.set(key_history_cursor, _history_cursor_json(max_deals_cursor, max_orders_cursor))
            except Exception as exc:
                log.warning("History sync error (login=%s): %s", login, exc)
            stop_event.wait(HISTORY_SYNC_INTERVAL)

    history_thread = threading.Thread(target=_history_sync, daemon=True, name=f"history-{login}")
    history_thread.start()

    # ── Poll loop ──────────────────────────────────────────────────────────────
    last_pos_hash = ""
    reconnects    = 0
    errors        = 0
    consecutive_ipc_errors   = 0
    consecutive_redis_errors = 0
    last_history_totals_at = 0.0
    history_orders_total = None
    history_deals_total = None

    try:
        while not stop_event.is_set():
            # ── Phase 1: MT5 / IPC ────────────────────────────────────────────
            try:
                acct = _mt5_call(mt5.account_info)

                if acct is None:
                    raise RuntimeError(f"account_info() returned None: {_mt5_last_error()}")

                terminal = _mt5_call(mt5.terminal_info)
                orders_total = _mt5_call(mt5.orders_total)
                positions_total = _mt5_call(mt5.positions_total)
                positions = _mt5_call(mt5.positions_get) or ()

                pos_data = [
                    {
                        "ticket":       p.ticket,
                        "symbol":       p.symbol,
                        "type":         p.type,
                        "volume":       p.volume,
                        "openPrice":    p.price_open,
                        "currentPrice": p.price_current,
                        "sl":           p.sl,
                        "tp":           p.tp,
                        "profit":       p.profit,
                        "swap":         p.swap,
                        "comment":      p.comment,
                        "openTime":     p.time,
                    }
                    for p in positions
                ]

                now_ts = time.time()
                open_tickets = {p.ticket for p in positions}
                for p in positions:
                    tracker.update(
                        p.ticket, p.profit, p.symbol, p.type, p.volume, p.price_open, p.time,
                    )
                closed_tracks = tracker.drop_closed(open_tickets)
                equity_track.update(acct.equity, now_ts)

                if now_ts - last_history_totals_at >= HISTORY_TOTALS_INTERVAL:
                    date_from = datetime.fromtimestamp(_history_totals_start_timestamp(now_ts, HISTORY_TOTALS_DAYS))
                    date_to = datetime.now() + timedelta(minutes=5)
                    totals_msg = f"History orders total probe failed (range {date_from.isoformat()} to {date_to.isoformat()})"
                    orders_total_result = _safe_history_call(
                        "history_orders_total",
                        totals_msg,
                        mt5.history_orders_total,
                        date_from,
                        date_to,
                    )
                    totals_msg = f"History deals total probe failed (range {date_from.isoformat()} to {date_to.isoformat()})"
                    deals_total_result = _safe_history_call(
                        "history_deals_total",
                        totals_msg,
                        mt5.history_deals_total,
                        date_from,
                        date_to,
                    )
                    if orders_total_result is not None:
                        history_orders_total = orders_total_result
                    if deals_total_result is not None:
                        history_deals_total = deals_total_result
                    last_history_totals_at = now_ts

                consecutive_ipc_errors = 0  # clear on success

            except Exception as exc:
                errors += 1
                consecutive_ipc_errors += 1
                log.warning(
                    "IPC error #%d (login=%s): %s",
                    consecutive_ipc_errors, login, exc,
                )
                if consecutive_ipc_errors >= IPC_FAIL_THRESHOLD:
                    log.error(
                        "Circuit breaker: %d consecutive IPC failures for login=%s, exiting.",
                        consecutive_ipc_errors, login,
                    )
                    sys.exit(EXIT_IPC)
                # Attempt reconnect
                try:
                    _mt5_shutdown()
                except Exception:
                    pass
                if _mt5_initialize():
                    reconnects += 1
                    log.info("Reconnected to terminal (login=%s)", login)
                else:
                    log.error("Reconnect failed (login=%s): %s", login, _mt5_last_error())
                stop_event.wait(poll_interval)
                continue

            # ── Phase 2: Redis write ───────────────────────────────────────────
            try:
                pos_json = json.dumps(pos_data)
                pos_hash = _hash(pos_json)

                pipe = r.pipeline(transaction=False)

                pipe.hset(key_live, mapping=_redis_mapping({
                    "login":       acct.login,
                    "name":        getattr(acct, "name", "") or "",
                    "server":      getattr(acct, "server", "") or "",
                    "company":     getattr(acct, "company", "") or "",
                    "leverage":    getattr(acct, "leverage", 0) or 0,
                    "tradeMode":   _mt5_attr(acct, "trade_mode", ""),
                    "limitOrders": _mt5_attr(acct, "limit_orders", ""),
                    "marginSoMode": _mt5_attr(acct, "margin_so_mode", ""),
                    "tradeAllowed": _mt5_attr(acct, "trade_allowed", ""),
                    "tradeExpert": _mt5_attr(acct, "trade_expert", ""),
                    "marginMode":  _mt5_attr(acct, "margin_mode", ""),
                    "currencyDigits": _mt5_attr(acct, "currency_digits", ""),
                    "fifoClose":   _mt5_attr(acct, "fifo_close", ""),
                    "balance":     acct.balance,
                    "equity":      acct.equity,
                    "margin":      acct.margin,
                    "freeMargin":  acct.margin_free,
                    "marginLevel": acct.margin_level,
                    "profit":      acct.profit,
                    "credit":      acct.credit,
                    "currency":    acct.currency,
                    "marginSoCall": _mt5_attr(acct, "margin_so_call", ""),
                    "marginSoSo":  _mt5_attr(acct, "margin_so_so", ""),
                    "marginInitial": _mt5_attr(acct, "margin_initial", ""),
                    "marginMaintenance": _mt5_attr(acct, "margin_maintenance", ""),
                    "commissionBlocked": _mt5_attr(acct, "commission_blocked", ""),
                    "terminalCommunityAccount": _mt5_attr(terminal, "community_account", ""),
                    "terminalCommunityConnection": _mt5_attr(terminal, "community_connection", ""),
                    "terminalConnected": _mt5_attr(terminal, "connected", ""),
                    "terminalTradeAllowed": _mt5_attr(terminal, "trade_allowed", ""),
                    "terminalTradeapiDisabled": _mt5_attr(terminal, "tradeapi_disabled", ""),
                    "terminalFtpEnabled": _mt5_attr(terminal, "ftp_enabled", ""),
                    "terminalNotificationsEnabled": _mt5_attr(terminal, "notifications_enabled", ""),
                    "terminalBuild": _mt5_attr(terminal, "build", ""),
                    "terminalMaxbars": _mt5_attr(terminal, "maxbars", ""),
                    "terminalPingLast": _mt5_attr(terminal, "ping_last", ""),
                    "terminalName": _mt5_attr(terminal, "name", ""),
                    "terminalPath": _mt5_attr(terminal, "path", ""),
                    "terminalDataPath": _mt5_attr(terminal, "data_path", ""),
                    "terminalCommondataPath": _mt5_attr(terminal, "commondata_path", ""),
                    "ordersTotal": _optional_int(orders_total),
                    "positionsTotal": _optional_int(positions_total),
                    "historyOrdersTotal": _optional_int(history_orders_total),
                    "historyDealsTotal": _optional_int(history_deals_total),
                    "historyTotalsUpdatedAt": _optional_int(last_history_totals_at),
                    "timestamp":   now_ts,
                }))

                for ticket, state in tracker.all_states().items():
                    pipe.hset(key_pos_state, str(ticket), json.dumps(state))
                for track in closed_tracks:
                    pipe.hdel(key_pos_state, str(track.ticket))
                pipe.hset(key_equity_state, mapping=_redis_mapping({
                    k: str(v) for k, v in equity_track.to_state().items()
                }))

                for track in closed_tracks:
                    close_event = None
                    try:
                        deals = _safe_history_call(
                            "history_deals_get_position_poll",
                            f"Closing deal fetch failed for position={track.ticket}",
                            mt5.history_deals_get,
                            position=track.ticket,
                            default=(),
                        )
                        close_event = _build_close_event_from_track(track, deals, now_ts)
                    except Exception as exc:
                        log.warning(
                            "Could not fetch closing deal for ticket=%s (login=%s): %s",
                            track.ticket, login, exc,
                        )
                    if close_event is None:
                        close_event = _build_close_event_from_track(track, (), now_ts)
                    _publish_close_event_once(close_event)

                pipe.hset(key_hb, mapping=_redis_mapping({
                    "pid":        pid,
                    "lastSeen":   time.time(),
                    "reconnects": reconnects,
                    "errors":     errors,
                }))
                pipe.expire(key_hb, HEARTBEAT_TTL)

                if pos_hash != last_pos_hash:
                    pipe.set(key_pos, pos_json, ex=POSITIONS_TTL)
                    last_pos_hash = pos_hash
                else:
                    pipe.expire(key_pos, POSITIONS_TTL)

                pipe.execute()
                consecutive_redis_errors = 0  # clear on success

            except Exception as exc:
                consecutive_redis_errors += 1
                log.warning(
                    "Redis error #%d (login=%s): %s",
                    consecutive_redis_errors, login, exc,
                )
                if consecutive_redis_errors >= REDIS_FAIL_THRESHOLD:
                    log.error(
                        "Circuit breaker: %d consecutive Redis failures for login=%s, exiting.",
                        consecutive_redis_errors, login,
                    )
                    sys.exit(EXIT_REDIS)

            stop_event.wait(poll_interval)

    finally:
        stop_event.set()
        try:
            if not lock_lost.is_set():
                release_script(keys=[key_lock], args=[pid])
                log.info("Lock released for login=%s", login)
        except Exception:
            pass
        try:
            r.delete(key_pid)
        except Exception:
            pass
        _mt5_shutdown()
        log.info("Bridge stopped for login=%s", login)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MT5 Bridge — push live data to Redis")
    parser.add_argument("--terminal-path", required=True, help="Path to terminal64.exe")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--interval", type=float, default=float(os.environ.get("POLL_INTERVAL", "2.0")))
    parser.add_argument("--startup-jitter", type=float, default=0.0)
    args = parser.parse_args()

    run(args.terminal_path, args.redis_url, args.interval, args.startup_jitter)
