"""Validation report: duplicates, relationships, reversal/close-by, empty input."""

from bridge_v2.raw_export import build_validation_report, reconcile_positions


def deal(**over):
    base = dict(
        ticket=1, order=10, position_id=101, symbol="EURUSD", type=0, entry=0,
        volume=0.1, price=1.1, commission=0.0, fee=0.0, swap=0.0, profit=0.0,
        time=1_767_225_600, comment="",
    )
    base.update(over)
    return base


def order(**over):
    base = dict(ticket=10, position_id=101, symbol="EURUSD", type=0,
                time_setup=1_767_225_600, time_done=1_767_225_700)
    base.update(over)
    return base


ACCOUNT = {"login": 7948784, "server": "Broker-Live", "trade_mode": 2, "margin_mode": 2}


def test_empty_history_is_a_valid_zero_report_not_an_error():
    rep = build_validation_report(ACCOUNT, [], [], [])
    assert rep["deal_count"] == 0
    assert rep["order_count"] == 0
    assert rep["earliest_deal_time"] is None
    assert rep["duplicate_deal_tickets"] == []


def test_detects_duplicate_deal_and_order_tickets():
    rep = build_validation_report(
        ACCOUNT,
        [deal(ticket=1), deal(ticket=1), deal(ticket=2)],
        [order(ticket=10), order(ticket=10)],
        [],
    )
    assert rep["duplicate_deal_tickets"] == [1]
    assert rep["duplicate_order_tickets"] == [10]


def test_account_mode_is_reported_as_hedging():
    rep = build_validation_report(ACCOUNT, [], [], [])
    assert rep["hedging_or_netting"] == "hedging"
    assert rep["trade_mode"] == "real"
    assert rep["account_login"] == 7948784


def test_reversal_inout_and_out_by_are_identified_not_treated_as_normal_exits():
    deals = [
        deal(ticket=1, entry=0),
        deal(ticket=2, entry=2),  # DEAL_ENTRY_INOUT — reversal
        deal(ticket=3, entry=3),  # DEAL_ENTRY_OUT_BY — close-by
    ]
    rep = build_validation_report(ACCOUNT, deals, [order()], [])
    assert rep["reversal_inout_deal_tickets"] == [2]
    assert rep["out_by_deal_tickets"] == [3]
    assert rep["deal_entry_types_by_count"] == {"in": 1, "inout": 1, "out_by": 1}


def test_reports_positions_missing_entry_or_exit_and_multi_leg_positions():
    deals = [
        deal(ticket=1, position_id=101, entry=0),  # open only, never closed
        deal(ticket=2, position_id=102, entry=1),  # exit with no entry in range
        deal(ticket=3, position_id=103, entry=0),  # 103: two entries, two exits
        deal(ticket=4, position_id=103, entry=0),
        deal(ticket=5, position_id=103, entry=1),
        deal(ticket=6, position_id=103, entry=1),
    ]
    rep = build_validation_report(ACCOUNT, deals, [order()], [])
    assert rep["positions_with_no_exit_deal"] == [101]
    assert rep["positions_with_no_entry_deal"] == [102]
    assert rep["positions_with_multiple_entry_deals"] == [103]
    assert rep["positions_with_multiple_exit_deals"] == [103]
    assert rep["deals_grouped_by_position_id"] == {"101": 1, "102": 1, "103": 4}


def test_flags_deals_referencing_unknown_orders_and_zero_position_ids():
    deals = [
        deal(ticket=1, order=999),          # order 999 was never returned
        deal(ticket=2, position_id=0),      # trade deal with no position id (order 10 is known)
    ]
    rep = build_validation_report(ACCOUNT, deals, [order(ticket=10)], [])
    assert rep["deals_referencing_unknown_orders"] == [1]
    assert rep["deals_missing_or_zero_position_id"] == [2]


def test_commission_only_and_funding_records_are_counted_separately():
    deals = [
        deal(ticket=1, type=7, symbol="", position_id=0, commission=-2.5),  # commission-only, no symbol
        deal(ticket=2, type=2, symbol="", position_id=0, profit=1000.0),    # balance deposit
    ]
    rep = build_validation_report(ACCOUNT, deals, [], [])
    assert rep["commission_only_deal_tickets"] == [1]
    assert rep["funding_records"]["commission"] == {"count": 1, "total": "-2.5"}
    assert rep["funding_records"]["balance"] == {"count": 1, "total": "1000.0"}


def test_reconciliation_sums_money_with_decimal_precision():
    # Three legs whose float sum would drift; Decimal-from-str keeps it exact.
    deals = [
        deal(ticket=1, position_id=101, entry=0, type=0, volume="0.1", profit="0.1", commission="0.2"),
        deal(ticket=2, position_id=101, entry=1, type=1, volume="0.1", profit="0.2", swap="0.1"),
    ]
    rec = reconcile_positions(deals)["101"]
    assert rec["entry_deal_tickets"] == [1]
    assert rec["exit_deal_tickets"] == [2]
    assert rec["buy_volume"] == "0.1"
    assert rec["sell_volume"] == "0.1"
    assert rec["profit"] == "0.3"          # not 0.30000000000000004
    assert rec["net_pnl"] == "0.6"         # 0.3 + 0.2 commission + 0.1 swap
    assert rec["symbol"] == "EURUSD"


def test_reconciliation_handles_multi_entry_multi_exit_hedging_position():
    deals = [
        deal(ticket=1, position_id=200, entry=0, type=0, volume="0.5"),
        deal(ticket=2, position_id=200, entry=0, type=0, volume="0.5"),
        deal(ticket=3, position_id=200, entry=1, type=1, volume="0.3", profit="5"),
        deal(ticket=4, position_id=200, entry=1, type=1, volume="0.7", profit="-2"),
    ]
    rec = reconcile_positions(deals)["200"]
    assert rec["entry_deal_tickets"] == [1, 2]
    assert rec["exit_deal_tickets"] == [3, 4]
    assert rec["buy_volume"] == "1.0"
    assert rec["sell_volume"] == "1.0"
    # Decimal preserves scale from the source records (0.0 + 0.0 + 5 - 2 -> "3.0").
    assert rec["net_pnl"] == "3.0"
