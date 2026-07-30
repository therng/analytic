"""Phase 2 minimal bridge — one process per terminal.

Live path (main thread, ~2s): account_info + positions_get -> Redis.
History path (bg thread, ~30s): bounded window of raw deals+orders -> streams.

No worker-controlled startup. The bridge owns only its extraction cursor AND
its own duplicate-login detection: the supervisor discovers terminal
processes and spawns one bridge per path, but it never knows or decides which
MT5 login that terminal will turn out to be. Login is only known after
account_info() succeeds, so the bridge — not the supervisor — is the only
place that can correctly enforce "one bridge per login".
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime, timezone

from . import config
from .history_publisher import sync_history_once
from .live_publisher import run_live_once
from .mt5_client import Mt5Client, login_of

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("bridge_v2")

EXIT_OK = 0
EXIT_DUPLICATE = 20
EXIT_AUTH = 30
EXIT_IPC = 40

IPC_FAIL_THRESHOLD = int(os.environ.get("V2_IPC_FAIL_THRESHOLD", "5"))


def ipc_breaker_tripped(consecutive_errors: int, threshold: int = IPC_FAIL_THRESHOLD) -> bool:
    """True once consecutive live-poll failures mean the terminal is gone
    (closed, crashed) rather than a one-off IPC hiccup. This is what makes a
    closed terminal visible to the supervisor at all: a live loop that just
    logs-and-continues forever never exits, so the supervisor never sees a
    child to fail over away from.
    """
    return consecutive_errors >= threshold


def acquire_lock(redis_client, login: int, pid: str) -> bool:
    """SETNX the per-login lock. True = this process owns login exclusively."""
    return bool(redis_client.set(config.key_lock(login), pid, nx=True, ex=config.LOCK_TTL))


def extend_lock(redis_client, login: int, pid: str) -> bool:
    """Refresh TTL only if we still hold the lock. False = ownership lost.

    ponytail: plain get-then-expire, not a Lua CAS — a lost race here just
    means an extra restart cycle, not data corruption. Upgrade to a script if
    two bridges racing on the same login in production proves this too loose.
    """
    if redis_client.get(config.key_lock(login)) != pid:
        return False
    redis_client.expire(config.key_lock(login), config.LOCK_TTL)
    return True


def release_lock(redis_client, login: int, pid: str) -> None:
    if redis_client.get(config.key_lock(login)) == pid:
        redis_client.delete(config.key_lock(login))


def run(terminal_path: str, redis_url: str, from_iso: str, broker_utc_offset_minutes: int) -> None:
    import redis as redislib  # type: ignore[import]

    client = Mt5Client(terminal_path)
    client.initialize()
    acct = client.account_info()
    if not acct.ok:
        client.shutdown()
        log.error("account_info failed at startup: %s", acct.describe())
        sys.exit(EXIT_AUTH)
    login = login_of(acct.value)
    log.info("Connected login=%s terminal=%s", login, terminal_path)

    r = redislib.from_url(redis_url, decode_responses=True)
    r.ping()

    pid = str(os.getpid())
    if not acquire_lock(r, login, pid):
        log.warning("Bridge for login=%s already running — exiting (duplicate).", login)
        client.shutdown()
        sys.exit(EXIT_DUPLICATE)
    log.info("Lock acquired login=%s pid=%s", login, pid)

    start_epoch = config.history_start_epoch(from_iso)
    stop = threading.Event()

    def _stop(sig, frame):
        log.info("signal %s -> stopping", sig)
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    def _lock_refresh_loop():
        while not stop.is_set():
            if not extend_lock(r, login, pid):
                log.error("Lost lock ownership for login=%s — stopping.", login)
                stop.set()
                return
            stop.wait(config.LOCK_REFRESH_INTERVAL)

    threading.Thread(target=_lock_refresh_loop, daemon=True, name=f"v2-lock-{login}").start()

    # MT5's history_deals_get/history_orders_get filter against
    # deal.time/order.time_setup, which are the broker trade server's own
    # wall clock — NOT true UTC (confirmed: same raw epoch from
    # positions_get() and history_deals_get() for the same ticket). The
    # window's upper bound must be expressed in that same broker-local
    # space, or every query permanently excludes the most recent
    # broker_utc_offset_minutes of real history while reporting
    # reached_present=True.
    broker_utc_offset_seconds = broker_utc_offset_minutes * 60

    def _history_loop():
        while not stop.is_set():
            try:
                now_epoch = int(datetime.now(tz=timezone.utc).timestamp()) + broker_utc_offset_seconds
                status = sync_history_once(client, r, login, now_epoch, start_epoch)
                if not status.get("idle"):
                    log.info("history %s", status)
            except Exception as exc:  # cursor NOT advanced on failure
                log.warning("history sync error (login=%s): %s", login, exc)
            stop.wait(config.HISTORY_SYNC_INTERVAL)

    threading.Thread(target=_history_loop, daemon=True, name=f"v2-history-{login}").start()

    consecutive_ipc_errors = 0
    try:
        while not stop.is_set():
            try:
                run_live_once(client, r, login)
                consecutive_ipc_errors = 0
            except Exception as exc:
                consecutive_ipc_errors += 1
                log.warning("live poll error #%d (login=%s): %s", consecutive_ipc_errors, login, exc)
                if ipc_breaker_tripped(consecutive_ipc_errors):
                    log.error(
                        "Circuit breaker: %d consecutive MT5 failures (login=%s) — "
                        "terminal likely closed; exiting so the supervisor can fail over.",
                        consecutive_ipc_errors, login,
                    )
                    sys.exit(EXIT_IPC)
            stop.wait(config.LIVE_POLL_INTERVAL)
    finally:
        stop.set()
        release_lock(r, login, pid)
        client.shutdown()
        log.info("bridge_v2 stopped login=%s", login)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="bridge_v2 minimal live+history bridge")
    parser.add_argument("--terminal-path", required=True)
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--from-date", default=config.DEFAULT_HISTORY_START_ISO)
    parser.add_argument(
        "--broker-utc-offset-minutes",
        default=config.DEFAULT_BROKER_UTC_OFFSET_MINUTES,
        type=int,
        help="Broker server UTC offset minutes for this login (default: 180 for UTC+3).",
    )
    args = parser.parse_args(argv)
    run(args.terminal_path, args.redis_url, args.from_date, args.broker_utc_offset_minutes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
