from types import SimpleNamespace

from mt5_bridge import (
    _build_close_event_from_track,
    _deal_type_str,
    _history_start_timestamp,
    _position_close_payload_from_deals,
)
from tracking import PositionTrack


def deal(**overrides):
    defaults = {
        "ticket": 1,
        "order": 10,
        "position_id": 101,
        "symbol": "EURUSD",
        "type": 0,
        "entry": 0,
        "volume": 0.1,
        "price": 1.1,
        "commission": 0.0,
        "fee": 0.0,
        "swap": 0.0,
        "profit": 0.0,
        "time": 1_700_000_000,
        "comment": "",
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_history_start_timestamp_defaults_to_all_available_history():
    assert _history_start_timestamp(None, now_ts=1_700_000_000, backfill_days=0) == 0.0


def test_history_start_timestamp_keeps_existing_cursor():
    assert _history_start_timestamp("1700000123.0", now_ts=1_700_000_500, backfill_days=0) == 1_700_000_123.0


def test_history_start_timestamp_allows_bounded_backfill_override():
    assert _history_start_timestamp(None, now_ts=1_700_000_000, backfill_days=2) == 1_699_827_200


def test_deal_type_str_maps_extended_mt5_commission_types():
    assert _deal_type_str(8) == "commission daily"
    assert _deal_type_str(11) == "commission agent monthly"
    assert _deal_type_str(16) == "dividend franked"


def test_position_close_payload_aggregates_position_linked_cost_deals():
    payload = _position_close_payload_from_deals(101, [
        deal(ticket=1, order=11, entry=0, time=100, price=1.1000, profit=0, commission=-0.5),
        deal(ticket=2, order=12, entry=None, time=150, symbol="", type=7, profit=-2.0, fee=-0.25),
        deal(ticket=3, order=13, entry=1, time=200, type=1, price=1.1050, profit=50, commission=-0.5, swap=-0.1, comment="close"),
    ])

    assert payload is not None
    assert payload["profit"] == 50.0
    assert payload["commission"] == -3.25
    assert payload["swap"] == -0.1
    assert payload["exitPrice"] == 1.105
    assert payload["exitTime"] == 200


def test_position_close_payload_aggregates_partial_closes():
    payload = _position_close_payload_from_deals(101, [
        deal(ticket=1, order=11, entry=0, time=100, volume=1.0, price=1.1000),
        deal(ticket=2, order=12, entry=1, time=200, type=1, volume=0.4, price=1.1040, profit=20.0),
        deal(ticket=3, order=13, entry=1, time=300, type=1, volume=0.6, price=1.0980, profit=-12.0, commission=-1.0),
    ])

    assert payload is not None
    assert payload["volume"] == 1.0
    assert payload["profit"] == 8.0
    assert payload["commission"] == -1.0
    assert payload["exitPrice"] == 1.098
    assert payload["exitTime"] == 300


def test_build_close_event_from_track_uses_aggregate_history_and_preserves_excursion():
    track = PositionTrack(
        ticket=101,
        symbol="EURUSD",
        position_type=0,
        volume=0.1,
        entry_price=1.1,
        first_seen_ts=100.0,
        mae=-9.0,
        mfe=14.0,
    )

    payload = _build_close_event_from_track(track, [
        deal(ticket=1, order=11, entry=0, time=100, price=1.1000, profit=0.0),
        deal(ticket=2, order=12, entry=None, time=150, symbol="", type=7, profit=-2.0),
        deal(ticket=3, order=13, entry=1, time=200, type=1, price=1.1050, profit=50.0),
    ], now_ts=250.0)

    assert payload["ticket"] == 101
    assert payload["profit"] == 50.0
    assert payload["commission"] == -2.0
    assert payload["mae"] == -9.0
    assert payload["mfe"] == 14.0
    assert payload["durationSeconds"] == 100
