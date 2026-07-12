from types import SimpleNamespace

from datetime import datetime

from mt5_bridge import (
    _advance_open_position_reconstruction,
    _build_close_event_from_track,
    _deal_direction,
    _deal_payload,
    _deal_type_str,
    _history_cursor_from_raw,
    _history_cursor_json,
    _history_cursors_from_raw,
    _history_start_timestamp,
    _initialize_mt5_terminal,
    _iter_backfill_windows,
    _order_after_cursor,
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


def order(**overrides):
    defaults = {"ticket": 10, "sl": 0.0, "tp": 0.0, "time_setup": 1_700_000_000, "time_done": 0}
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_history_start_timestamp_defaults_to_all_available_history():
    assert _history_start_timestamp(now_ts=1_700_000_000, backfill_days=0) == 0.0


def test_history_start_timestamp_keeps_existing_cursor():
    assert _history_cursor_from_raw("1700000123.0", now_ts=1_700_000_500, backfill_days=0) == (1_700_000_123.0, 0)


def test_history_start_timestamp_allows_bounded_backfill_override():
    assert _history_start_timestamp(now_ts=1_700_000_000, backfill_days=2) == 1_699_827_200


def test_history_cursor_json_keeps_deal_and_order_cursors_independent():
    raw = _history_cursor_json((100.0, 10), (300.0, 30))

    assert _history_cursors_from_raw(raw, now_ts=1_700_000_000, backfill_days=0) == (
        (100.0, 10),
        (300.0, 30),
    )


def test_history_cursors_from_legacy_cursor_applies_to_both_streams():
    assert _history_cursors_from_raw('{"time":200,"ticket":20}', now_ts=1_700_000_000, backfill_days=0) == (
        (200.0, 20),
        (200.0, 20),
    )


def test_deal_type_str_maps_extended_mt5_commission_types():
    assert _deal_type_str(8) == "commission daily"
    assert _deal_type_str(11) == "commission agent monthly"
    assert _deal_type_str(16) == "dividend franked"


def test_deal_direction_uses_entry_for_trade_deals():
    assert _deal_direction(deal(entry=0, symbol="EURUSD", position_id=101)) == "in"
    assert _deal_direction(deal(entry=1, symbol="EURUSD", position_id=101)) == "out"
    assert _deal_direction(deal(entry=1, symbol="", position_id=0)) is None


def test_deal_payload_includes_report_contract_aliases():
    payload = _deal_payload(deal(ticket=555, order=444, entry=1, profit=12.0), balance_after=1012.0)

    assert payload["ticket"] == 555
    assert payload["deal_id"] == "555"
    assert payload["order_id"] == "444"
    assert payload["position_no"] == "101"
    assert payload["direction"] == "out"
    assert payload["balanceAfter"] == 1012.0
    assert payload["balance_after"] == 1012.0


def test_order_after_cursor_uses_done_time_then_setup_time():
    closed_order = SimpleNamespace(ticket=3, time_setup=100, time_done=200)
    working_order = SimpleNamespace(ticket=4, time_setup=300, time_done=0)

    assert _order_after_cursor(closed_order, (199.0, 99)) is True
    assert _order_after_cursor(closed_order, (200.0, 3)) is False
    assert _order_after_cursor(working_order, (299.0, 99)) is True


def test_initialize_mt5_terminal_always_uses_portable_mode(monkeypatch):
    calls = []

    class FakeMt5:
        @staticmethod
        def initialize(**kwargs):
            calls.append(kwargs)
            return True

    import mt5_bridge
    monkeypatch.setattr(mt5_bridge, "_terminal_process_is_running", lambda path: True)

    assert _initialize_mt5_terminal(FakeMt5, "C:\\MT5\\terminal64.exe") is True
    assert calls == [{"path": "C:\\MT5\\terminal64.exe", "portable": True}]


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


def test_position_close_payload_joins_sl_tp_from_entry_order():
    payload = _position_close_payload_from_deals(
        101,
        [
            deal(ticket=1, order=11, entry=0, time=100, price=1.1000),
            deal(ticket=2, order=12, entry=1, time=200, type=1, price=1.1050, profit=50),
        ],
        orders_by_ticket={11: order(ticket=11, sl=1.0950, tp=1.1100)},
    )
    assert payload["sl"] == 1.0950
    assert payload["tp"] == 1.1100


def test_iter_backfill_windows_splits_range_into_configured_chunks():
    start = datetime(2026, 1, 1)
    end = datetime(2026, 2, 15)
    windows = list(_iter_backfill_windows(start, end, window_days=30))
    assert windows == [
        (datetime(2026, 1, 1), datetime(2026, 1, 31)),
        (datetime(2026, 1, 31), datetime(2026, 2, 15)),
    ]


def test_advance_open_position_reconstruction_closes_only_on_flat_volume():
    pending: dict = {}
    volumes: dict = {}

    # Window 1: position opens, no close yet.
    closed = _advance_open_position_reconstruction(
        [deal(ticket=1, order=11, position_id=101, entry=0, time=100, volume=1.0, price=1.1000)],
        pending, volumes, {},
    )
    assert closed == []
    assert 101 in pending

    # Window 2 (later, separate fetch): partial close leaves volume open, then full close.
    closed = _advance_open_position_reconstruction(
        [
            deal(ticket=2, order=12, position_id=101, entry=1, type=1, time=200, volume=0.4, price=1.1040, profit=20.0),
            deal(ticket=3, order=13, position_id=101, entry=1, type=1, time=300, volume=0.6, price=1.0980, profit=-12.0),
        ],
        pending, volumes, {},
    )
    assert len(closed) == 1
    assert closed[0]["ticket"] == 101
    assert closed[0]["volume"] == 1.0
    assert 101 not in pending  # reconstructed positions are popped, not re-emitted

    # Re-running over the same closing deal must not re-close (idempotent within a run).
    closed_again = _advance_open_position_reconstruction(
        [deal(ticket=3, order=13, position_id=101, entry=1, type=1, time=300, volume=0.6, price=1.0980, profit=-12.0)],
        pending, volumes, {},
    )
    assert closed_again == []
