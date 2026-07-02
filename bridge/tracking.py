"""
Pure, MT5-independent tracking logic for per-position excursion (MAE/MFE)
and per-account equity peak/drawdown.

No I/O, no MT5 API, no Redis — safe to unit test on any OS. mt5_bridge.py
supplies the live values (profit, equity) and persists to/reseeds from
Redis; this module only holds the tracking math.
"""

from dataclasses import dataclass


@dataclass
class PositionTrack:
    ticket: int
    symbol: str
    position_type: int
    volume: float
    entry_price: float
    first_seen_ts: float
    mae: float = 0.0  # <= 0, worst unrealized loss reached
    mfe: float = 0.0  # >= 0, best unrealized gain reached

    def update_profit(self, profit: float) -> None:
        self.mae = min(self.mae, profit)
        self.mfe = max(self.mfe, profit)

    def to_state(self) -> dict:
        return {
            "ticket": self.ticket,
            "symbol": self.symbol,
            "positionType": self.position_type,
            "volume": self.volume,
            "entryPrice": self.entry_price,
            "firstSeenTs": self.first_seen_ts,
            "mae": self.mae,
            "mfe": self.mfe,
        }

    @classmethod
    def from_state(cls, state: dict) -> "PositionTrack":
        return cls(
            ticket=int(state["ticket"]),
            symbol=str(state["symbol"]),
            position_type=int(state["positionType"]),
            volume=float(state["volume"]),
            entry_price=float(state["entryPrice"]),
            first_seen_ts=float(state["firstSeenTs"]),
            mae=float(state.get("mae", 0.0)),
            mfe=float(state.get("mfe", 0.0)),
        )


class PositionTracker:
    """Tracks running MAE/MFE for every currently-open ticket."""

    def __init__(self):
        self._tracks: dict[int, PositionTrack] = {}

    def seed(self, ticket: int, state: dict) -> None:
        self._tracks[ticket] = PositionTrack.from_state(state)

    def update(
        self,
        ticket: int,
        profit: float,
        symbol: str,
        position_type: int,
        volume: float,
        entry_price: float,
        now_ts: float,
    ) -> PositionTrack:
        track = self._tracks.get(ticket)
        if track is None:
            track = PositionTrack(
                ticket=ticket,
                symbol=symbol,
                position_type=position_type,
                volume=volume,
                entry_price=entry_price,
                first_seen_ts=now_ts,
            )
            self._tracks[ticket] = track
        track.update_profit(profit)
        return track

    def drop_closed(self, open_tickets: set) -> list:
        """Remove tracks for tickets no longer open; return the dropped
        tracks (final MAE/MFE state) so the caller can build close events."""
        closed_tickets = set(self._tracks) - open_tickets
        return [self._tracks.pop(t) for t in closed_tickets]

    def all_states(self) -> dict:
        return {ticket: track.to_state() for ticket, track in self._tracks.items()}


@dataclass
class EquityTrack:
    peak_equity: float
    peak_equity_ts: float
    tracking_start_ts: float

    def update(self, equity: float, now_ts: float) -> None:
        if equity > self.peak_equity:
            self.peak_equity = equity
            self.peak_equity_ts = now_ts

    def to_state(self) -> dict:
        return {
            "peakEquity": self.peak_equity,
            "peakEquityTs": self.peak_equity_ts,
            "trackingStartTs": self.tracking_start_ts,
        }

    @classmethod
    def from_state(cls, state: dict) -> "EquityTrack":
        return cls(
            peak_equity=float(state["peakEquity"]),
            peak_equity_ts=float(state["peakEquityTs"]),
            tracking_start_ts=float(state["trackingStartTs"]),
        )

    @classmethod
    def start(cls, equity: float, now_ts: float) -> "EquityTrack":
        return cls(peak_equity=equity, peak_equity_ts=now_ts, tracking_start_ts=now_ts)


def compute_drawdown(peak_equity: float, current_equity: float) -> float:
    return max(0.0, peak_equity - current_equity)
