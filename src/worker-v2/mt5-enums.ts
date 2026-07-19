// Mirrors bridge_v2/models.py DEAL_TYPE/DEAL_ENTRY/ORDER_TYPE/FUNDING_DEAL_TYPES.
// Keep in sync manually if the bridge's enum maps change (no cross-language import possible).

const DEAL_TYPE: Record<number, string> = {
  0: "buy",
  1: "sell",
  2: "balance",
  3: "credit",
  4: "charge",
  5: "correction",
  6: "bonus",
  7: "commission",
  8: "commission_daily",
  9: "commission_monthly",
  10: "commission_agent_daily",
  11: "commission_agent_monthly",
  12: "interest",
  13: "buy_canceled",
  14: "sell_canceled",
  15: "dividend",
  16: "dividend_franked",
  17: "tax",
};

const DEAL_ENTRY: Record<number, string> = {
  0: "in",
  1: "out",
  2: "inout",
  3: "out_by",
};

// MT5 ENUM_DEAL_REASON.
const DEAL_REASON: Record<number, string> = {
  0: "client",
  1: "mobile",
  2: "web",
  3: "expert",
  4: "sl",
  5: "tp",
  6: "so",
  7: "rollover",
  8: "vmargin",
  9: "split",
  10: "corporate_action",
};

// MT5 ENUM_ORDER_REASON. Subset of DEAL_REASON (no rollover/vmargin/split).
const ORDER_REASON: Record<number, string> = {
  0: "client",
  1: "mobile",
  2: "web",
  3: "expert",
  4: "sl",
  5: "tp",
  6: "so",
};

const ORDER_TYPE: Record<number, string> = {
  0: "buy",
  1: "sell",
  2: "buy_limit",
  3: "sell_limit",
  4: "buy_stop",
  5: "sell_stop",
  6: "buy_stop_limit",
  7: "sell_stop_limit",
};

// MT5 ENUM_ORDER_STATE. Values are stable, documented MetaTrader5 constants
// (unchanged since MT5's introduction) — not sourced from bridge_v2/models.py
// because the Python side doesn't decode order state today.
const ORDER_STATE: Record<number, string> = {
  0: "started",
  1: "placed",
  2: "canceled",
  3: "partial",
  4: "filled",
  5: "rejected",
  6: "expired",
  7: "request_add",
  8: "request_modify",
  9: "request_cancel",
};

// MT5 ENUM_ORDER_TYPE_FILLING.
const ORDER_FILLING: Record<number, string> = {
  0: "fok",
  1: "ioc",
  2: "return",
  3: "boc",
};

// MT5 ENUM_ORDER_TYPE_TIME.
const ORDER_TIME: Record<number, string> = {
  0: "gtc",
  1: "day",
  2: "specified",
  3: "specified_day",
};

// Mirrors bridge_v2/models.py TRADE_MODE/MARGIN_MODE (ACCOUNT_TRADE_MODE / ACCOUNT_MARGIN_MODE).
const TRADE_MODE: Record<number, string> = {
  0: "demo",
  1: "contest",
  2: "real",
};

const MARGIN_MODE: Record<number, string> = {
  0: "retail_netting",
  1: "exchange",
  2: "retail_hedging",
};

const FUNDING_DEAL_TYPES = new Set([2, 3, 5, 6, 12, 15, 16, 17]);

function toCode(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function decodeDealType(raw: unknown): string {
  const code = toCode(raw);
  if (code !== null && DEAL_TYPE[code] !== undefined) return DEAL_TYPE[code];
  return `deal_type_${String(raw)}`;
}

export function decodeDealEntry(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return DEAL_ENTRY[code] ?? null;
}

export function decodeDealReason(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return DEAL_REASON[code] ?? null;
}

export function decodeOrderReason(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return ORDER_REASON[code] ?? null;
}

export function decodeOrderType(raw: unknown): string {
  const code = toCode(raw);
  if (code !== null && ORDER_TYPE[code] !== undefined) return ORDER_TYPE[code];
  return `order_type_${String(raw)}`;
}

export function decodePositionSide(raw: unknown): "buy" | "sell" | null {
  if (raw === 0 || raw === "0") return "buy";
  if (raw === 1 || raw === "1") return "sell";
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower === "buy") return "buy";
    if (lower === "sell") return "sell";
  }
  return null;
}

export function isFundingDealType(rawType: unknown): boolean {
  const code = toCode(rawType);
  return code !== null && FUNDING_DEAL_TYPES.has(code);
}

export function decodeOrderState(raw: unknown): string {
  const code = toCode(raw);
  if (code !== null && ORDER_STATE[code] !== undefined) return ORDER_STATE[code];
  return `order_state_${String(raw)}`;
}

export function decodeFillPolicy(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return ORDER_FILLING[code] ?? null;
}

export function decodeOrderTimeType(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return ORDER_TIME[code] ?? null;
}

export function decodeTradeMode(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return TRADE_MODE[code] ?? null;
}

export function decodeMarginMode(raw: unknown): string | null {
  const code = toCode(raw);
  if (code === null) return null;
  return MARGIN_MODE[code] ?? null;
}
