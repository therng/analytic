"""
MT5 Bridge: connects to one portable MT5 terminal and pushes live data to Redis.

One process per terminal, launched by run_all.py.

Safety: acquires a Redis lock keyed by MT5 login so two processes can never
push data for the same account simultaneously.

Performance: batches every poll cycle into a single Redis pipeline round-trip
and skips the positions write when the data has not changed.

Redis keys written:
  mt5:bridge:lock:{login}          String (NX, TTL 15s)  — exclusive process lock
  mt5:account:{login}:live         Hash  (no TTL)         — account financials
  mt5:account:{login}:positions    String JSON (TTL 10s)  — open positions
"""

import argparse
import hashlib
import json
import logging
import os
import sys
import threading
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

LOCK_TTL = 15       # seconds — lock key TTL
LOCK_REFRESH = 5    # seconds — how often to refresh lock
POSITIONS_TTL = 10  # seconds — positions key TTL (absence = stale)


def _hash(data: str) -> str:
    return hashlib.md5(data.encode(), usedforsecurity=False).hexdigest()


def run(terminal_path: str, redis_url: str, poll_interval: float = 2.0) -> None:
    try:
        import MetaTrader5 as mt5  # type: ignore[import]
    except ImportError:
        log.error("MetaTrader5 not installed. Run: pip install MetaTrader5")
        sys.exit(1)

    try:
        import redis as redislib  # type: ignore[import]
    except ImportError:
        log.error("redis not installed. Run: pip install redis")
        sys.exit(1)

    # ── Connect to terminal ────────────────────────────────────────────────────
    log.info("Connecting to terminal: %s", terminal_path)
    if not mt5.initialize(path=terminal_path):
        log.error("mt5.initialize failed: %s", mt5.last_error())
        sys.exit(1)

    info = mt5.account_info()
    if not info:
        log.error("account_info() returned None after init: %s", mt5.last_error())
        mt5.shutdown()
        sys.exit(1)

    login = info.login
    log.info("Connected — login=%s  balance=%.2f %s", login, info.balance, info.currency)

    key_lock = f"mt5:bridge:lock:{login}"
    key_live = f"mt5:account:{login}:live"
    key_pos  = f"mt5:account:{login}:positions"
    pid      = str(os.getpid())

    r = redislib.from_url(redis_url, decode_responses=True, protocol=2)

    # ── Acquire exclusive lock ─────────────────────────────────────────────────
    acquired = r.set(key_lock, pid, nx=True, ex=LOCK_TTL)
    if not acquired:
        existing_pid = r.get(key_lock)
        log.warning(
            "Bridge for login=%s already running (PID=%s). Exiting to avoid duplicate.",
            login, existing_pid,
        )
        mt5.shutdown()
        sys.exit(0)

    log.info("Lock acquired for login=%s (PID=%s)", login, pid)

    # ── Background thread: keep lock alive ────────────────────────────────────
    stop_event = threading.Event()

    def _refresh_lock() -> None:
        while not stop_event.is_set():
            try:
                r.expire(key_lock, LOCK_TTL)
            except Exception:
                pass
            stop_event.wait(LOCK_REFRESH)

    lock_thread = threading.Thread(target=_refresh_lock, daemon=True, name=f"lock-{login}")
    lock_thread.start()

    # ── Poll loop ──────────────────────────────────────────────────────────────
    last_pos_hash: str = ""

    try:
        while True:
            try:
                acct = mt5.account_info()
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
                pos_json = json.dumps(pos_data)
                pos_hash = _hash(pos_json)

                # Batch all writes in one pipeline round-trip
                pipe = r.pipeline(transaction=False)

                if acct:
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

                # Only write positions when data has changed (skip unchanged)
                if pos_hash != last_pos_hash:
                    pipe.set(key_pos, pos_json, ex=POSITIONS_TTL)
                    last_pos_hash = pos_hash
                else:
                    # Still refresh TTL so the key doesn't expire
                    pipe.expire(key_pos, POSITIONS_TTL)

                pipe.execute()

            except Exception as exc:
                log.warning("Poll error (login=%s): %s", login, exc)

            time.sleep(poll_interval)

    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        try:
            # Release lock only if we still own it
            current = r.get(key_lock)
            if current == pid:
                r.delete(key_lock)
                log.info("Lock released for login=%s", login)
        except Exception:
            pass
        mt5.shutdown()
        log.info("Bridge stopped for login=%s", login)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MT5 Bridge — push live data to Redis")
    parser.add_argument("--terminal-path", required=True, help="Path to terminal64.exe")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--interval", type=float, default=2.0, help="Poll interval in seconds")
    args = parser.parse_args()

    run(args.terminal_path, args.redis_url, args.interval)
