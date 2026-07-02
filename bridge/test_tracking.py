from tracking import PositionTrack, PositionTracker, EquityTrack, compute_drawdown


def test_position_track_updates_mae_and_mfe():
    track = PositionTrack(
        ticket=1, symbol="EURUSD", position_type=0, volume=0.1,
        entry_price=1.1000, first_seen_ts=1000.0,
    )
    track.update_profit(5.0)
    track.update_profit(-3.0)
    track.update_profit(8.0)
    track.update_profit(-1.0)
    assert track.mae == -3.0
    assert track.mfe == 8.0


def test_position_track_state_roundtrip():
    track = PositionTrack(
        ticket=42, symbol="XAUUSD", position_type=1, volume=0.5,
        entry_price=3320.5, first_seen_ts=500.0, mae=-12.5, mfe=30.0,
    )
    restored = PositionTrack.from_state(track.to_state())
    assert restored == track


def test_tracker_update_creates_and_updates_track():
    tracker = PositionTracker()
    tracker.update(1, profit=2.0, symbol="EURUSD", position_type=0, volume=0.1, entry_price=1.1, now_ts=100.0)
    tracker.update(1, profit=-4.0, symbol="EURUSD", position_type=0, volume=0.1, entry_price=1.1, now_ts=102.0)
    state = tracker.all_states()[1]
    assert state["mae"] == -4.0
    assert state["mfe"] == 2.0
    assert state["firstSeenTs"] == 100.0  # unchanged on second update


def test_tracker_seed_restores_existing_track():
    tracker = PositionTracker()
    tracker.seed(7, {
        "ticket": 7, "symbol": "GBPUSD", "positionType": 1, "volume": 0.2,
        "entryPrice": 1.25, "firstSeenTs": 50.0, "mae": -2.0, "mfe": 6.0,
    })
    tracker.update(7, profit=9.0, symbol="GBPUSD", position_type=1, volume=0.2, entry_price=1.25, now_ts=60.0)
    state = tracker.all_states()[7]
    assert state["mfe"] == 9.0
    assert state["firstSeenTs"] == 50.0  # preserved from seed


def test_tracker_drop_closed_removes_and_returns_tracks():
    tracker = PositionTracker()
    tracker.update(1, profit=1.0, symbol="EURUSD", position_type=0, volume=0.1, entry_price=1.1, now_ts=1.0)
    tracker.update(2, profit=1.0, symbol="EURUSD", position_type=0, volume=0.1, entry_price=1.1, now_ts=1.0)
    closed = tracker.drop_closed(open_tickets={2})
    assert [t.ticket for t in closed] == [1]
    assert set(tracker.all_states().keys()) == {2}


def test_equity_track_peak_only_increases():
    track = EquityTrack.start(equity=1000.0, now_ts=0.0)
    track.update(equity=1200.0, now_ts=10.0)
    track.update(equity=900.0, now_ts=20.0)
    assert track.peak_equity == 1200.0
    assert track.peak_equity_ts == 10.0


def test_equity_track_state_roundtrip():
    track = EquityTrack.start(equity=500.0, now_ts=5.0)
    restored = EquityTrack.from_state(track.to_state())
    assert restored == track


def test_compute_drawdown_never_negative():
    assert compute_drawdown(peak_equity=1000.0, current_equity=1200.0) == 0.0
    assert compute_drawdown(peak_equity=1000.0, current_equity=800.0) == 200.0
