"""bridge_v2 configuration — constants and environment overrides.

No secrets here. Redis URL and terminal path are passed explicitly on the
command line or via environment so nothing is silently defaulted.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

# ── History start ────────────────────────────────────────────────────────────
# Default deployment value is 2026-01-01. Configurable, but never falls back to
# now-30-days and never reaches back to 2000 (that is the OLD bridge's job).
DEFAULT_HISTORY_START_ISO = os.environ.get("V2_HISTORY_START", "2026-01-01T00:00:00")


def history_start_epoch(iso: str = DEFAULT_HISTORY_START_ISO) -> int:
    """Parse the configured history start into a raw epoch (UTC seconds).

    The string is interpreted as UTC wall-clock. This is only a *query
    boundary* passed to MT5 history calls — it is NOT the record time.
    """
    return int(datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp())


# ── Live poll cadence ────────────────────────────────────────────────────────
LIVE_POLL_INTERVAL = float(os.environ.get("V2_LIVE_POLL_INTERVAL", "2.0"))

# ── History windowing ────────────────────────────────────────────────────────
HISTORY_WINDOW_DAYS = int(os.environ.get("V2_HISTORY_WINDOW_DAYS", "30"))
HISTORY_SYNC_INTERVAL = float(os.environ.get("V2_HISTORY_SYNC_INTERVAL", "30.0"))


# ── Redis keys (all under the mt5:v2: namespace, isolated from old bridge) ────
def key_heartbeat(login: int) -> str:
    return f"mt5:v2:bridge:{login}:heartbeat"


def key_live(login: int) -> str:
    return f"mt5:v2:account:{login}:live"


def key_positions(login: int) -> str:
    return f"mt5:v2:account:{login}:positions"


def key_history_cursor(login: int) -> str:
    return f"mt5:v2:history:{login}:cursor"


def key_lock(login: int) -> str:
    """Exclusive per-login lock. Bridge owns duplicate detection, not the supervisor."""
    return f"mt5:v2:bridge:lock:{login}"


LOCK_TTL = int(os.environ.get("V2_LOCK_TTL", "15"))
LOCK_REFRESH_INTERVAL = int(os.environ.get("V2_LOCK_REFRESH_INTERVAL", "5"))


# History streams are global (one per record kind); each message carries its
# own login field so consumers can route. Matches the spec literally.
STREAM_DEALS = "mt5:v2:history:deals"
STREAM_ORDERS = "mt5:v2:history:orders"
