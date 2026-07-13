"""MT5 enum semantics — decode only, no reconstruction.

These maps let the validator label raw records in human-readable terms. They do
NOT collapse records into a production schema. Every raw field is preserved
elsewhere; this module only names codes.
"""

from __future__ import annotations

# MT5 DEAL_TYPE enum
DEAL_TYPE = {
    0: "buy", 1: "sell", 2: "balance", 3: "credit", 4: "charge",
    5: "correction", 6: "bonus", 7: "commission", 8: "commission_daily",
    9: "commission_monthly", 10: "commission_agent_daily",
    11: "commission_agent_monthly", 12: "interest", 13: "buy_canceled",
    14: "sell_canceled", 15: "dividend", 16: "dividend_franked", 17: "tax",
}

# MT5 DEAL_ENTRY enum
DEAL_ENTRY = {0: "in", 1: "out", 2: "inout", 3: "out_by"}
DEAL_ENTRY_IN = 0
DEAL_ENTRY_OUT = 1
DEAL_ENTRY_INOUT = 2
DEAL_ENTRY_OUT_BY = 3

# MT5 ORDER_TYPE enum
ORDER_TYPE = {
    0: "buy", 1: "sell", 2: "buy_limit", 3: "sell_limit",
    4: "buy_stop", 5: "sell_stop", 6: "buy_stop_limit", 7: "sell_stop_limit",
}

# MT5 ACCOUNT_TRADE_MODE enum
TRADE_MODE = {0: "demo", 1: "contest", 2: "real"}

# MT5 ACCOUNT_MARGIN_MODE enum. RETAIL_HEDGING allows many positions per symbol;
# NETTING nets to one. This distinction is why bridge_v2 must NOT assume one
# entry/one exit per position — the worker handles both, mode-aware.
MARGIN_MODE = {0: "retail_netting", 1: "exchange", 2: "retail_hedging"}

# Non-trade deal types that carry cost/funding, not directional volume.
FUNDING_DEAL_TYPES = {2, 3, 5, 6, 12, 15, 16, 17}  # balance/credit/correction/bonus/interest/dividend*/tax
COST_ONLY_DEAL_TYPES = {4, 7, 8, 9, 10, 11}          # charge/commission*


def deal_type_name(code) -> str:
    try:
        return DEAL_TYPE.get(int(code), f"deal_type_{code}")
    except (TypeError, ValueError):
        return f"deal_type_{code}"


def deal_entry_name(code) -> str:
    if code is None:
        return "unknown"
    try:
        return DEAL_ENTRY.get(int(code), f"deal_entry_{code}")
    except (TypeError, ValueError):
        return f"deal_entry_{code}"


def order_type_name(code) -> str:
    try:
        return ORDER_TYPE.get(int(code), f"order_type_{code}")
    except (TypeError, ValueError):
        return f"order_type_{code}"


def trade_mode_name(code) -> str:
    try:
        return TRADE_MODE.get(int(code), f"trade_mode_{code}")
    except (TypeError, ValueError):
        return f"trade_mode_{code}"


def margin_mode_name(code) -> str:
    try:
        return MARGIN_MODE.get(int(code), f"margin_mode_{code}")
    except (TypeError, ValueError):
        return f"margin_mode_{code}"
