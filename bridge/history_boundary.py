from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from bridge.config import TerminalProfile

DEFAULT_HISTORY_SYNC_GRACE_S = 60


@dataclass(frozen=True)
class SafeEndBoundaryProvider:
    """HistorySynchronizer's `boundary_provider` (bridge/history.py):
    bounds a history window's end at `now - grace`, never at `now` exactly
    -- mirrors bridge_v2's V2_HISTORY_SYNC_GRACE_SECONDS: guards against MT5
    surfacing a server-originated balance operation (deposit/withdrawal) a
    moment after the poll already advanced past that timestamp.

    # ponytail: raw timestamps here are treated as wall-clock epoch
    # seconds with no broker-UTC-offset correction -- bridge_v2's per-login
    # --broker-offset handling has no equivalent field on TerminalProfile
    # yet. Add one (mirroring V2_BROKER_UTC_OFFSET_MINUTES) if/when this
    # bridge needs to support brokers whose server clock materially drifts
    # from UTC, the same trigger that made bridge_v2 need it.
    """

    now_s: Callable[[], float]
    grace_s: int = DEFAULT_HISTORY_SYNC_GRACE_S

    def safe_end(self, profile: TerminalProfile) -> int:
        del profile  # no per-profile adjustment yet, see class docstring
        return int(self.now_s()) - self.grace_s
