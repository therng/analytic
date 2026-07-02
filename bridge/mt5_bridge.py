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
  mt5:bridge:history-cursor:{login}   String (no TTL)   — last-synced unix timestamp

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
  9. redis-cli GET mt5:bridge:history-cursor:{login} — confirm it advanced past
     the closed deal's time.
  10. Restart the bridge process; confirm the cursor is NOT reset (history sync
      resumes from the persisted cursor, doesn't rescan the full 24h window).
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

# MT5 DEAL_TYPE enum → lowercase string, matching the FTP parser's convention
# (src/lib/trading/analytics.ts normalizeTradeSide/isBalanceDeal expect
# lowercase "buy"/"sell", and treat anything containing "balance"/"credit"
# etc. as a funding operation via comment/type text matching).
DEAL_TYPE_MAP = {
    0: "buy", 1: "sell", 2: "balance", 3: "credit", 4: "charge",
    5: "correction", 6: "bonus", 7: "commission", 12: "interest",
    15: "dividend", 17: "tax",
}

# MT5 ORDER_TYPE enum → lowercase string.
ORDER_TYPE_MAP = {
    0: "buy", 1: "sell", 2: "buy limit", 3: "sell limit",
    4: "buy stop", 5: "sell stop", 6: "buy stop limit", 7: "sell stop limit",
}


def _deal_type_str(code: int) -> str:
    return DEAL_TYPE_MAP.get(code, f"type_{code}")


def _order_type_str(code: int) -> str:
    return ORDER_TYPE_MAP.get(code, f"type_{code}")


# ── Config ─────────────────────────────────────────────────────────────────────
LOCK_TTL            = int(os.environ.get("LOCK_TTL",            "15"))
LOCK_REFRESH        = int(os.environ.get("LOCK_REFRESH",        "5"))
POSITIONS_TTL       = int(os.environ.get("POSITIONS_TTL",       "10"))
HEARTBEAT_TTL       = int(os.environ.get("HEARTBEAT_TTL",       "10"))
PID_KEY_TTL         = int(os.environ.get("PID_KEY_TTL",         "30"))  # how long pid→login lives
IPC_FAIL_THRESHOLD  = int(os.environ.get("IPC_FAIL_THRESHOLD",  "5"))   # consecutive MT5 failures → EXIT_IPC
REDIS_FAIL_THRESHOLD= int(os.environ.get("REDIS_FAIL_THRESHOLD","5"))   # consecutive Redis failures → EXIT_REDIS
HISTORY_SYNC_INTERVAL = float(os.environ.get("HISTORY_SYNC_INTERVAL", "30"))
HISTORY_STREAM_MAXLEN  = int(os.environ.get("HISTORY_STREAM_MAXLEN",  "10000"))

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


def _hash(data: str) -> str:
    return hashlib.md5(data.encode(), usedforsecurity=False).hexdigest()


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

    # ── Connect to Redis first so we can write pid→login on duplicate ──────────
    try:
        r = redislib.from_url(redis_url, decode_responses=True, protocol=2)
        r.ping()
    except Exception as exc:
        log.error("Cannot connect to Redis: %s", exc)
        sys.exit(EXIT_REDIS)

    # ── Connect to MT5 terminal ────────────────────────────────────────────────
    log.info("Connecting to terminal: %s", terminal_path)
    if not mt5.initialize(path=terminal_path):
        log.error("mt5.initialize failed: %s", mt5.last_error())
        sys.exit(EXIT_FATAL)

    info = mt5.account_info()
    if not info:
        log.error("account_info() returned None after init — terminal not logged in: %s", mt5.last_error())
        mt5.shutdown()
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
        mt5.shutdown()
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
                since_ts = float(cursor_raw) if cursor_raw else (time.time() - 86400)
                date_from = datetime.fromtimestamp(since_ts)
                date_to = datetime.now() + timedelta(minutes=5)

                deals = mt5.history_deals_get(date_from, date_to) or ()
                orders = mt5.history_orders_get(date_from, date_to) or ()

                pipe = r.pipeline(transaction=False)
                max_ts = since_ts
                new_count = 0

                for d in deals:
                    if d.time <= since_ts:
                        continue
                    payload = {
                        "ticket": d.ticket,
                        "order": d.order,
                        "positionId": d.position_id,
                        "symbol": d.symbol,
                        "type": _deal_type_str(d.type),
                        "volume": d.volume,
                        "price": d.price,
                        "commission": d.commission,
                        "fee": d.fee,
                        "swap": d.swap,
                        "profit": d.profit,
                        "time": d.time,
                        "comment": d.comment,
                    }
                    pipe.xadd(
                        key_deals_stream, {"data": json.dumps(payload)},
                        maxlen=HISTORY_STREAM_MAXLEN, approximate=True,
                    )
                    max_ts = max(max_ts, d.time)
                    new_count += 1

                for o in orders:
                    if o.time_done != 0 and o.time_done <= since_ts:
                        continue
                    payload = {
                        "ticket": o.ticket,
                        "positionId": o.position_id,
                        "symbol": o.symbol,
                        "type": _order_type_str(o.type),
                        "state": o.state,
                        "volume": o.volume_initial,
                        "priceOpen": o.price_open,
                        "sl": o.sl,
                        "tp": o.tp,
                        "timeSetup": o.time_setup,
                        "timeDone": o.time_done,
                        "comment": o.comment,
                    }
                    pipe.xadd(
                        key_orders_stream, {"data": json.dumps(payload)},
                        maxlen=HISTORY_STREAM_MAXLEN, approximate=True,
                    )
                    if o.time_done != 0:
                        max_ts = max(max_ts, o.time_done)

                pipe.execute()
                if new_count > 0 or max_ts > since_ts:
                    r.set(key_history_cursor, str(max_ts))
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

    try:
        while not stop_event.is_set():
            # ── Phase 1: MT5 / IPC ────────────────────────────────────────────
            try:
                acct = mt5.account_info()

                if acct is None:
                    raise RuntimeError(f"account_info() returned None: {mt5.last_error()}")

                positions = mt5.positions_get() or ()

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
                        p.ticket, p.profit, p.symbol, p.type, p.volume, p.price_open, now_ts,
                    )
                closed_tracks = tracker.drop_closed(open_tickets)
                equity_track.update(acct.equity, now_ts)

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
                    mt5.shutdown()
                except Exception:
                    pass
                if mt5.initialize(path=terminal_path):
                    reconnects += 1
                    log.info("Reconnected to terminal (login=%s)", login)
                else:
                    log.error("Reconnect failed (login=%s): %s", login, mt5.last_error())
                stop_event.wait(poll_interval)
                continue

            # ── Phase 2: Redis write ───────────────────────────────────────────
            try:
                pos_json = json.dumps(pos_data)
                pos_hash = _hash(pos_json)

                pipe = r.pipeline(transaction=False)

                pipe.hset(key_live, mapping={
                    "login":       acct.login,
                    "balance":     acct.balance,
                    "equity":      acct.equity,
                    "margin":      acct.margin,
                    "freeMargin":  acct.margin_free,
                    "marginLevel": acct.margin_level,
                    "profit":      acct.profit,
                    "credit":      acct.credit,
                    "currency":    acct.currency,
                })

                for ticket, state in tracker.all_states().items():
                    pipe.hset(key_pos_state, str(ticket), json.dumps(state))
                for track in closed_tracks:
                    pipe.hdel(key_pos_state, str(track.ticket))
                pipe.hset(key_equity_state, mapping={
                    k: str(v) for k, v in equity_track.to_state().items()
                })

                for track in closed_tracks:
                    exit_deal = None
                    try:
                        deals = mt5.history_deals_get(position=track.ticket) or ()
                        exit_deal = max(deals, key=lambda d: d.time, default=None)
                    except Exception as exc:
                        log.warning(
                            "Could not fetch closing deal for ticket=%s (login=%s): %s",
                            track.ticket, login, exc,
                        )
                    exit_time = exit_deal.time if exit_deal else now_ts
                    close_event = {
                        "ticket": track.ticket,
                        "symbol": track.symbol,
                        "positionType": track.position_type,
                        "volume": track.volume,
                        "entryPrice": track.entry_price,
                        "exitPrice": exit_deal.price if exit_deal else None,
                        "entryTime": track.first_seen_ts,
                        "exitTime": exit_time,
                        "durationSeconds": exit_time - track.first_seen_ts,
                        "mae": track.mae,
                        "mfe": track.mfe,
                        "profit": exit_deal.profit if exit_deal else None,
                        "commission": exit_deal.commission if exit_deal else None,
                        "swap": exit_deal.swap if exit_deal else None,
                        "dealTicket": exit_deal.ticket if exit_deal else None,
                        "orderTicket": exit_deal.order if exit_deal else None,
                        "comment": exit_deal.comment if exit_deal else "",
                    }
                    pipe.xadd(
                        key_closed_stream, {"data": json.dumps(close_event)},
                        maxlen=HISTORY_STREAM_MAXLEN, approximate=True,
                    )

                pipe.hset(key_hb, mapping={
                    "pid":        pid,
                    "lastSeen":   time.time(),
                    "reconnects": reconnects,
                    "errors":     errors,
                })
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
        mt5.shutdown()
        log.info("Bridge stopped for login=%s", login)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MT5 Bridge — push live data to Redis")
    parser.add_argument("--terminal-path", required=True, help="Path to terminal64.exe")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--interval", type=float, default=float(os.environ.get("POLL_INTERVAL", "2.0")))
    parser.add_argument("--startup-jitter", type=float, default=0.0)
    args = parser.parse_args()

    run(args.terminal_path, args.redis_url, args.interval, args.startup_jitter)
