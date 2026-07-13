"""Phase 1 raw MT5 verifier.

Connects to ONE explicit portable terminal, exports the original MT5 responses,
and produces a validation + diagnostic-reconciliation report. No Redis, no
PostgreSQL, no production Position model, no reconstruction.

Usage (PowerShell):
  python -m bridge_v2.raw_export `
    --terminal-path "C:\\path\\to\\terminal64.exe" `
    --from-date "2026-01-01T00:00:00" `
    --output ".\\artifacts\\7948784"

Outputs into --output:
  account.json  terminal.json  open_positions.json
  deals.jsonl   orders.jsonl   summary.json  validation.json

The pure functions below (validation, reconciliation) take already-serialized
dict rows so they unit-test with no MT5 installed.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from .models import (
    COST_ONLY_DEAL_TYPES,
    DEAL_ENTRY_INOUT,
    DEAL_ENTRY_OUT_BY,
    FUNDING_DEAL_TYPES,
    deal_entry_name,
    deal_type_name,
    margin_mode_name,
    order_type_name,
    trade_mode_name,
)
from .mt5_client import CallResult, Mt5Client
from .serializers import serialize_record, to_decimal

OPENING_ENTRIES = {0, 2}   # in, inout
CLOSING_ENTRIES = {1, 2, 3}  # out, inout, out_by


# ── Predicates on serialized deal dicts ──────────────────────────────────────
def _is_trade_deal(d: dict) -> bool:
    return bool(d.get("symbol")) and d.get("position_id") not in (None, 0)


def _iso(epoch) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()


# ── Diagnostic per-position financial reconciliation (Decimal only) ──────────
def reconcile_positions(deals: list[dict]) -> dict:
    """Per MT5 position_id: entry/exit tickets, volumes, PnL components (Decimal).

    Diagnostic ONLY. Makes no assumption about one-entry/one-exit, ticket==pid,
    INOUT being a normal exit, or every cost deal carrying a symbol/position id.
    """
    by_pid: dict = defaultdict(lambda: {
        "entry_deal_tickets": [], "exit_deal_tickets": [], "order_tickets": set(),
        "symbol": None, "deal_entry_types": Counter(),
        "buy_volume": Decimal("0"), "sell_volume": Decimal("0"),
        "profit": Decimal("0"), "commission": Decimal("0"),
        "fee": Decimal("0"), "swap": Decimal("0"),
        "first_deal_time": None, "last_deal_time": None,
    })
    for d in deals:
        pid = d.get("position_id")
        if pid in (None, 0):
            continue
        p = by_pid[pid]
        if p["symbol"] is None and d.get("symbol"):
            p["symbol"] = d.get("symbol")
        entry = d.get("entry")
        p["deal_entry_types"][deal_entry_name(entry)] += 1
        if d.get("order"):
            p["order_tickets"].add(d["order"])
        try:
            entry_int = int(entry) if entry is not None else None
        except (TypeError, ValueError):
            entry_int = None
        if entry_int in OPENING_ENTRIES:
            p["entry_deal_tickets"].append(d.get("ticket"))
        if entry_int in CLOSING_ENTRIES:
            p["exit_deal_tickets"].append(d.get("ticket"))
        dtype = d.get("type")
        vol = to_decimal(d.get("volume"))
        if dtype == 0:  # buy
            p["buy_volume"] += vol
        elif dtype == 1:  # sell
            p["sell_volume"] += vol
        p["profit"] += to_decimal(d.get("profit"))
        p["commission"] += to_decimal(d.get("commission"))
        p["fee"] += to_decimal(d.get("fee"))
        p["swap"] += to_decimal(d.get("swap"))
        t = d.get("time")
        if t:
            if p["first_deal_time"] is None or t < p["first_deal_time"]:
                p["first_deal_time"] = t
            if p["last_deal_time"] is None or t > p["last_deal_time"]:
                p["last_deal_time"] = t

    out = {}
    for pid, p in by_pid.items():
        net = p["profit"] + p["commission"] + p["fee"] + p["swap"]
        out[str(pid)] = {
            "entry_deal_tickets": p["entry_deal_tickets"],
            "exit_deal_tickets": p["exit_deal_tickets"],
            "order_tickets": sorted(p["order_tickets"]),
            "symbol": p["symbol"],
            "deal_entry_types": dict(p["deal_entry_types"]),
            "buy_volume": str(p["buy_volume"]),
            "sell_volume": str(p["sell_volume"]),
            "profit": str(p["profit"]),
            "commission": str(p["commission"]),
            "fee": str(p["fee"]),
            "swap": str(p["swap"]),
            "net_pnl": str(net),
            "first_deal_time": p["first_deal_time"],
            "first_deal_time_iso": _iso(p["first_deal_time"]),
            "last_deal_time": p["last_deal_time"],
            "last_deal_time_iso": _iso(p["last_deal_time"]),
        }
    return out


# ── Validation report ────────────────────────────────────────────────────────
def _duplicates(tickets: list) -> list:
    counts = Counter(t for t in tickets if t is not None)
    return sorted(t for t, c in counts.items() if c > 1)


def build_validation_report(
    account: dict | None,
    deals: list[dict],
    orders: list[dict],
    positions: list[dict],
) -> dict:
    trade_deals = [d for d in deals if _is_trade_deal(d)]
    deal_times = [d["time"] for d in deals if d.get("time")]
    order_times = [
        o.get("time_done") or o.get("time_setup")
        for o in orders if (o.get("time_done") or o.get("time_setup"))
    ]

    order_tickets = {o.get("ticket") for o in orders if o.get("ticket")}
    deals_unknown_order = sorted(
        d.get("ticket") for d in deals
        if d.get("order") not in (None, 0) and d.get("order") not in order_tickets
    )

    # Group trade deals by position id.
    by_pid_entries: dict = defaultdict(lambda: {"entry": 0, "exit": 0})
    deals_by_pid = Counter()
    for d in trade_deals:
        pid = d["position_id"]
        deals_by_pid[pid] += 1
        try:
            e = int(d["entry"]) if d.get("entry") is not None else None
        except (TypeError, ValueError):
            e = None
        if e in OPENING_ENTRIES:
            by_pid_entries[pid]["entry"] += 1
        if e in CLOSING_ENTRIES:
            by_pid_entries[pid]["exit"] += 1

    positions_no_entry = sorted(p for p, c in by_pid_entries.items() if c["entry"] == 0)
    positions_no_exit = sorted(p for p, c in by_pid_entries.items() if c["exit"] == 0)
    positions_multi_entry = sorted(p for p, c in by_pid_entries.items() if c["entry"] > 1)
    positions_multi_exit = sorted(p for p, c in by_pid_entries.items() if c["exit"] > 1)

    inout = [d.get("ticket") for d in deals if d.get("entry") == DEAL_ENTRY_INOUT]
    out_by = [d.get("ticket") for d in deals if d.get("entry") == DEAL_ENTRY_OUT_BY]

    def _money_zero(d, field):
        return to_decimal(d.get(field)) == 0

    commission_only = [
        d.get("ticket") for d in deals
        if not _money_zero(d, "commission")
        and _money_zero(d, "profit") and _money_zero(d, "fee") and _money_zero(d, "swap")
    ]
    fee_only = [
        d.get("ticket") for d in deals
        if not _money_zero(d, "fee")
        and _money_zero(d, "profit") and _money_zero(d, "commission") and _money_zero(d, "swap")
    ]

    funding_records: dict = defaultdict(lambda: {"count": 0, "total": Decimal("0")})
    for d in deals:
        try:
            dtype = int(d["type"]) if d.get("type") is not None else None
        except (TypeError, ValueError):
            dtype = None
        if dtype in FUNDING_DEAL_TYPES or dtype in COST_ONLY_DEAL_TYPES:
            name = deal_type_name(dtype)
            funding_records[name]["count"] += 1
            funding_records[name]["total"] += (
                to_decimal(d.get("profit")) + to_decimal(d.get("commission"))
                + to_decimal(d.get("fee")) + to_decimal(d.get("swap"))
            )

    return {
        "account_login": (account or {}).get("login"),
        "broker_server": (account or {}).get("server"),
        "trade_mode": trade_mode_name((account or {}).get("trade_mode")),
        "margin_mode_raw": (account or {}).get("margin_mode"),
        "margin_mode": margin_mode_name((account or {}).get("margin_mode")),
        "hedging_or_netting": (
            "hedging" if (account or {}).get("margin_mode") == 2
            else "netting" if (account or {}).get("margin_mode") == 0
            else "other"
        ),
        "deal_count": len(deals),
        "order_count": len(orders),
        "open_position_count": len(positions),
        "earliest_deal_time": min(deal_times) if deal_times else None,
        "earliest_deal_time_iso": _iso(min(deal_times)) if deal_times else None,
        "latest_deal_time": max(deal_times) if deal_times else None,
        "latest_deal_time_iso": _iso(max(deal_times)) if deal_times else None,
        "earliest_order_time": min(order_times) if order_times else None,
        "earliest_order_time_iso": _iso(min(order_times)) if order_times else None,
        "latest_order_time": max(order_times) if order_times else None,
        "latest_order_time_iso": _iso(max(order_times)) if order_times else None,
        "duplicate_deal_tickets": _duplicates([d.get("ticket") for d in deals]),
        "duplicate_order_tickets": _duplicates([o.get("ticket") for o in orders]),
        "deals_missing_or_zero_position_id": sorted(
            d.get("ticket") for d in deals
            if d.get("symbol") and d.get("position_id") in (None, 0)
        ),
        "deals_referencing_unknown_orders": deals_unknown_order,
        "deals_grouped_by_position_id": {str(k): v for k, v in deals_by_pid.items()},
        "deal_entry_types_by_count": dict(Counter(deal_entry_name(d.get("entry")) for d in deals)),
        "deal_types_by_count": dict(Counter(deal_type_name(d.get("type")) for d in deals)),
        "order_types_by_count": dict(Counter(order_type_name(o.get("type")) for o in orders)),
        "positions_with_no_entry_deal": positions_no_entry,
        "positions_with_no_exit_deal": positions_no_exit,
        "positions_with_multiple_entry_deals": positions_multi_entry,
        "positions_with_multiple_exit_deals": positions_multi_exit,
        "reversal_inout_deal_tickets": inout,
        "out_by_deal_tickets": out_by,
        "commission_only_deal_tickets": commission_only,
        "fee_only_deal_tickets": fee_only,
        "funding_records": {k: {"count": v["count"], "total": str(v["total"])} for k, v in funding_records.items()},
    }


# ── IO / CLI ─────────────────────────────────────────────────────────────────
def _require(result: CallResult, label: str) -> CallResult:
    """Abort the export on a FAILED/ERROR call. Never convert to empty."""
    if not result.ok:
        raise SystemExit(f"[raw_export] {label} did not succeed: {result.describe()}")
    return result


def _write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, default=str) + "\n")


def export(terminal_path: str, from_iso: str, output_dir: str) -> dict:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    date_from = datetime.fromisoformat(from_iso)
    date_to = datetime.now()

    client = Mt5Client(terminal_path)
    client.initialize()
    try:
        account_res = _require(client.account_info(), "account_info()")
        terminal_res = _require(client.terminal_info(), "terminal_info()")
        positions_res = _require(client.positions_get(), "positions_get()")
        deals_res = _require(client.history_deals_get(date_from, date_to), "history_deals_get()")
        orders_res = _require(client.history_orders_get(date_from, date_to), "history_orders_get()")
    finally:
        client.shutdown()

    account = serialize_record(account_res.value)
    terminal = serialize_record(terminal_res.value)
    positions = [serialize_record(p) for p in positions_res.rows()]
    deals = [serialize_record(d) for d in deals_res.rows()]
    orders = [serialize_record(o) for o in orders_res.rows()]

    _write_json(out / "account.json", account)
    _write_json(out / "terminal.json", terminal)
    _write_json(out / "open_positions.json", positions)
    _write_jsonl(out / "deals.jsonl", deals)
    _write_jsonl(out / "orders.jsonl", orders)

    validation = build_validation_report(account, deals, orders, positions)
    reconciliation = reconcile_positions(deals)
    _write_json(out / "validation.json", validation)

    summary = {
        "terminal_path": terminal_path,
        "from_date": from_iso,
        "to_date": date_to.isoformat(),
        "account_login": account.get("login"),
        "mt5_calls": {
            "account_info": "ok", "terminal_info": "ok", "positions_get": "ok",
            "history_deals_get": "ok", "history_orders_get": "ok",
        },
        "counts": {
            "deals": len(deals), "orders": len(orders), "open_positions": len(positions),
            "reconciled_positions": len(reconciliation),
        },
        "reconciliation": reconciliation,
    }
    _write_json(out / "summary.json", summary)

    print(f"[raw_export] login={account.get('login')} deals={len(deals)} "
          f"orders={len(orders)} open_positions={len(positions)} -> {out}")
    return {"summary": summary, "validation": validation}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="bridge_v2 Phase 1 raw MT5 verifier")
    parser.add_argument("--terminal-path", required=True, help="Explicit portable terminal64.exe path")
    parser.add_argument("--from-date", default="2026-01-01T00:00:00", help="History query start (ISO)")
    parser.add_argument("--output", required=True, help="Output directory for artifacts")
    args = parser.parse_args(argv)
    export(args.terminal_path, args.from_date, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
