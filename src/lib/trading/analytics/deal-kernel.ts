export type NumericLike = number | { valueOf(): unknown } | null | undefined;

export type TimedRow = {
  time: Date | string;
  dealId?: string;
  dealNo?: string;
};

export type BalanceRow = TimedRow & {
  type?: string | null;
  direction?: string | null;
  comment?: string | null;
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
  balanceAfter?: NumericLike;
  balance?: NumericLike;
  symbol?: string | null;
};

export const EMPTY_TEXT_VALUES = new Set(["unknown", "n/a", "na", "--"]);
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const RX_DEPOSIT = /deposit/i;
const RX_WITHDRAWAL = /withdraw/i;
const RX_ADJUSTMENT = /balance adjustment/i;
const RX_GENERIC_BAL =
  /credit|correction|bonus|fee|charge|interest|tax|agent|dividend/i;

export function parseTimestamp(time: Date | string | null | undefined): number {
  if (!time) return NaN;
  return typeof time === "string" ? Date.parse(time) : time.getTime();
}

export function getDealSortKey(row: { dealId?: string; dealNo?: string }) {
  return String(row.dealId ?? row.dealNo ?? "");
}

export function getPositionSortKey(row: {
  positionNo?: string | null;
  positionId?: string | null;
}) {
  return String(row.positionNo ?? row.positionId ?? "");
}

// Returns true when a deal should be counted as a trade entry in the balance curve.
// A deal is a trade if its type field is present (including empty string, which MT5 emits
// for regular trade deals) OR it has a non-empty comment.
// Only skip deals where type is null/undefined AND comment is null/empty — these are
// system/internal entries with no classification at all.
export function hasDealTypeOrComment(deal: {
  type?: string | null;
  comment?: string | null;
}): boolean {
  return deal.type != null || (deal.comment != null && deal.comment !== "");
}

// Pre-calculate timestamps and keys to ensure O(N log N) sorting is extremely fast
export function sortDeals<T extends TimedRow>(deals: T[]): T[] {
  return deals
    .map((deal) => ({
      deal,
      ts: parseTimestamp(deal.time),
      key: getDealSortKey(deal),
    }))
    .sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key))
    .map((x) => x.deal);
}

export function getDealBalanceValue(row: {
  balanceAfter?: NumericLike;
  balance?: NumericLike;
}) {
  const value = Number(row.balanceAfter ?? row.balance ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

type BalanceOperationKind =
  "deposit" | "withdrawal" | "balance-adjustment" | "balance";

export function classifyBalanceOperation(
  type: string | null | undefined,
  comment: string | null | undefined,
  delta: number | null = null,
): BalanceOperationKind | null {
  const t = (type || "").toLowerCase().trim();
  const c = (comment || "").toLowerCase().trim();
  if (!t && !c) return null;

  const text = `${t} ${c}`;
  if (RX_DEPOSIT.test(text)) return "deposit";
  if (RX_WITHDRAWAL.test(text)) return "withdrawal";
  if (RX_ADJUSTMENT.test(text) || (t === "balance" && c.includes("adjustment")))
    return "balance-adjustment";

  // Raw MT5 type "balance" (DEAL_TYPE_BALANCE) is authoritative: delta sign
  // decides deposit vs withdrawal. Free-text comment can contain unrelated
  // words (e.g. a payment-gateway name matching RX_GENERIC_BAL) and must not
  // override it, or a real deposit/withdrawal silently drops from the KPI.
  if (t === "balance") {
    if ((delta ?? 0) > 0) return "deposit";
    if ((delta ?? 0) < 0) return "withdrawal";
    return "balance";
  }

  if (RX_GENERIC_BAL.test(text)) return "balance";

  return null;
}

export function getTradeMetrics(
  deals: BalanceRow[],
  start: Date | null,
  end: Date | null = null,
) {
  const sorted = sortDeals(deals);
  const startTime = start ? start.getTime() : 0;
  const endTime = end ? end.getTime() : Infinity;

  let firstDeposit = 0;
  let totalDeposits = 0;
  let hasDeposit = false;

  for (const deal of sorted) {
    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    if (op === "deposit" && delta > 0) {
      if (!hasDeposit) {
        firstDeposit = delta;
        hasDeposit = true;
      }
      if (parseTimestamp(deal.time) <= endTime) {
        totalDeposits += delta;
      }
    }
  }

  if (!hasDeposit) {
    const firstKnown = sorted.find((d) => getDealBalanceValue(d) !== null);
    if (firstKnown) {
      firstDeposit = Number(getDealBalanceValue(firstKnown));
      totalDeposits = firstDeposit;
    }
  }

  // Find the first deal with a known balance in the sorted deals list
  let firstKnownIndex = -1;
  let firstKnownBalance = null;
  for (let i = 0; i < sorted.length; i++) {
    const b = getDealBalanceValue(sorted[i]);
    if (b !== null) {
      firstKnownIndex = i;
      firstKnownBalance = b;
      break;
    }
  }

  let calculatedStartBalance = firstDeposit;
  if (firstKnownIndex !== -1 && firstKnownBalance !== null) {
    let bal = firstKnownBalance;
    for (let i = firstKnownIndex; i > 0; i--) {
      bal -= dealNet(sorted[i]);
    }
    calculatedStartBalance = bal;
  }

  let runningBalance = firstKnownIndex !== -1 ? calculatedStartBalance : 0;
  let startBalance =
    firstKnownIndex !== -1 ? calculatedStartBalance : firstDeposit;
  const points: Array<{ time: number; balance: number; delta: number }> = [];

  for (const deal of sorted) {
    const ts = parseTimestamp(deal.time);
    if (ts > endTime) break;

    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    const shouldTrackBalance = op !== null || hasDealTypeOrComment(deal);
    if (shouldTrackBalance) {
      const providedBalance = getDealBalanceValue(deal);
      runningBalance =
        providedBalance !== null ? providedBalance : runningBalance + delta;
      if (ts < startTime) {
        startBalance = runningBalance;
      } else {
        points.push({ time: ts, balance: runningBalance, delta });
      }
    }
  }

  const endBalance =
    points.length > 0 ? points[points.length - 1].balance : startBalance;

  return {
    points,
    initialDeposit: firstDeposit,
    totalDeposits: Math.max(totalDeposits, firstDeposit),
    startBalance,
    endBalance,
  };
}

export function dealNet(row: {
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
}) {
  return (
    Number(row.profit ?? 0) +
    Number(row.commission ?? 0) +
    Number(row.swap ?? 0)
  );
}

export const positionNetPnl = dealNet;
export const positionProfit = dealNet;

export function normalizeTradeSide(
  type: string | null | undefined,
  direction: string | null | undefined,
) {
  const t = (type || "").toLowerCase().trim();
  if (t === "buy" || t === "sell") return t;
  const d = (direction || "").toLowerCase().trim();
  if (d === "buy" || d === "sell") return d;
  return t || d || "unknown";
}

export function isBalanceDeal(
  type: string | null | undefined,
  comment?: string | null,
  delta?: number | null,
) {
  return classifyBalanceOperation(type, comment, delta ?? null) !== null;
}

export const isFundingDeal = isBalanceDeal;

type TradingDealLike = {
  type?: string | null;
  direction?: string | null;
  symbol?: string | null;
};

export function isTradingDeal(
  typeOrDeal: string | null | undefined | TradingDealLike,
  direction?: string | null,
  symbol?: string | null,
) {
  if (typeof typeOrDeal === "object" && typeOrDeal !== null) {
    const d = (typeOrDeal.direction || "").trim();
    const s = (typeOrDeal.symbol || "").trim();
    if (d && s) return true;
    typeOrDeal = typeOrDeal.type;
  } else if ((direction || "").trim() && (symbol || "").trim()) {
    return true;
  }

  const t = (typeOrDeal || "").toLowerCase().trim();
  if (!t || isBalanceDeal(t)) return false;
  if (t === "trade") return true;
  return t.includes("buy") || t.includes("sell");
}

export function getLatestDealBalance(
  deals: Array<{
    time: Date | string;
    dealId?: string;
    dealNo?: string;
    balanceAfter?: NumericLike;
    balance?: NumericLike;
  }>,
  fallback: NumericLike = 0,
) {
  let last: number | null = null;
  for (const deal of sortDeals(deals as TimedRow[])) {
    const b = getDealBalanceValue(deal as any);
    if (b !== null) last = b;
  }
  return last !== null ? last : Number(fallback ?? 0);
}
