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

const FUNDING_DEAL_TYPES = new Set([2, 3, 5, 6, 12, 15, 16, 17]);

function toCode(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
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
