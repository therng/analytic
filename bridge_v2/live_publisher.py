"""Phase 2 live path — account_info + positions_get -> Redis, every ~2s.

No closed-position calculation. No close-event emission when a ticket vanishes.
Just the current live truth, straight through.
"""

from __future__ import annotations

import json

from . import config
from .mt5_client import Mt5Client

# Live position fields preserved verbatim from MT5 positions_get().
_LIVE_POSITION_FIELDS = (
    "ticket", "identifier", "symbol", "type", "magic", "reason", "volume",
    "price_open", "price_current", "sl", "tp", "profit", "swap", "comment",
    "time", "time_msc",
)


def _getter(obj):
    """Field accessor working for both dict and namedtuple-like MT5 records."""
    return obj.get if isinstance(obj, dict) else (lambda k, d=None: getattr(obj, k, d))


def live_position_payload(raw) -> dict:
    """One raw MT5 position -> a dict of the preserved live fields."""
    get = _getter(raw)
    return {f: get(f, None) for f in _LIVE_POSITION_FIELDS}


def account_live_payload(acct) -> dict:
    get = _getter(acct)
    return {
        "login": get("login"),
        "name": get("name", ""),
        "server": get("server", ""),
        "company": get("company", ""),
        "currency": get("currency", ""),
        "leverage": get("leverage", 0),
        "trade_mode": get("trade_mode"),
        "margin_mode": get("margin_mode"),
        "balance": get("balance"),
        "equity": get("equity"),
        "margin": get("margin"),
        "margin_free": get("margin_free"),
        "margin_level": get("margin_level"),
        "profit": get("profit"),
        "credit": get("credit"),
    }


def _redis_now(redis_client) -> float:
    """Authoritative timestamp for staleness checks. VPS system clocks can
    drift or be misconfigured (seen: a Windows host off by exactly its local
    UTC offset); Redis's own clock is what every reader compares against, so
    stamping heartbeats with it keeps liveness detection correct regardless
    of the bridge host's clock."""
    seconds, microseconds = redis_client.time()
    return seconds + microseconds / 1_000_000


def publish_live(redis_client, login: int, acct, positions) -> None:
    """Write live account + positions + heartbeat under mt5:v2 keys."""
    positions_payload = [live_position_payload(p) for p in positions]
    pipe = redis_client.pipeline(transaction=False)
    pipe.hset(config.key_live(login), mapping={
        k: ("" if v is None else v) for k, v in account_live_payload(acct).items()
    })
    pipe.set(config.key_positions(login), json.dumps(positions_payload, default=str))
    pipe.hset(config.key_heartbeat(login), mapping={"lastSeen": _redis_now(redis_client), "positions": len(positions_payload)})
    pipe.expire(config.key_heartbeat(login), 10)
    pipe.execute()


def run_live_once(client: Mt5Client, redis_client, login: int) -> None:
    acct = client.account_info()
    if not acct.ok:
        raise RuntimeError(f"account_info failed: {acct.describe()}")
    positions = client.positions_get()
    if not positions.ok:
        raise RuntimeError(f"positions_get failed: {positions.describe()}")
    publish_live(redis_client, login, acct.value, positions.rows())
