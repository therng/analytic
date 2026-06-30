"""
MT5 Bridge: connects to one portable MT5 terminal and pushes live data to Redis.

Runs as a separate process per terminal (one process per account).
Launched by run_all.py.

Redis keys written:
  mt5:account:{login}:live     — Hash, account info fields (no TTL)
  mt5:account:{login}:positions — String (JSON), TTL 10s (absence = stale)
"""

import argparse
import json
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


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

    key_live = f"mt5:account:{login}:live"
    key_pos = f"mt5:account:{login}:positions"

    r = redislib.from_url(redis_url, decode_responses=True)

    try:
        while True:
            try:
                acct = mt5.account_info()
                if acct:
                    r.hset(key_live, mapping={
                        "login": acct.login,
                        "balance": acct.balance,
                        "equity": acct.equity,
                        "margin": acct.margin,
                        "freeMargin": acct.margin_free,
                        "marginLevel": acct.margin_level,
                        "profit": acct.profit,
                        "credit": acct.credit,
                        "currency": acct.currency,
                    })

                positions = mt5.positions_get() or []
                pos_data = [
                    {
                        "ticket": p.ticket,
                        "symbol": p.symbol,
                        "type": p.type,
                        "volume": p.volume,
                        "openPrice": p.price_open,
                        "currentPrice": p.price_current,
                        "sl": p.sl,
                        "tp": p.tp,
                        "profit": p.profit,
                        "swap": p.swap,
                        "comment": p.comment,
                        "openTime": p.time,
                    }
                    for p in positions
                ]
                r.set(key_pos, json.dumps(pos_data), ex=10)

            except Exception as exc:
                log.warning("Poll error (login=%s): %s", login, exc)

            time.sleep(poll_interval)

    except KeyboardInterrupt:
        pass
    finally:
        log.info("Shutting down bridge for login=%s", login)
        mt5.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MT5 Bridge — push live data to Redis")
    parser.add_argument("--terminal-path", required=True, help="Path to terminal64.exe")
    parser.add_argument("--redis-url", default="redis://127.0.0.1:6379", help="Redis URL")
    parser.add_argument("--interval", type=float, default=2.0, help="Poll interval in seconds")
    args = parser.parse_args()

    run(args.terminal_path, args.redis_url, args.interval)
