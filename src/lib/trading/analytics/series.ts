import type { BalanceEventPoint } from "@/lib/trading/types";
import { addBangkokDays, endOfBangkokDay, getBangkokDateKey } from "@/lib/time";
import type { BalanceRow } from "./deal-kernel";
import {
  classifyBalanceOperation,
  dealNet,
  getDealBalanceValue,
  getTradeMetrics,
  isTradingDeal,
  sortDeals,
} from "./deal-kernel";
import { sanitizeOptionalText } from "./timeframe";

function toIsoDay(value: Date | string) {
  return getBangkokDateKey(value);
}

export function buildDailyProfitSeries(
  deals: BalanceRow[],
  days = 5,
  now = new Date(),
) {
  const end = endOfBangkokDay(now) ?? new Date(now.getTime());
  const dayKeys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = addBangkokDays(end, -offset);
    dayKeys.push(getBangkokDateKey(cursor) ?? "-");
  }

  const totals = new Map(dayKeys.map((k) => [k, 0]));
  for (const deal of deals) {
    const delta = dealNet(deal);
    if (!isTradingDeal(deal)) continue;

    const day = toIsoDay(deal.time);
    if (day && totals.has(day)) totals.set(day, totals.get(day)! + delta);
  }
  return dayKeys.map((date) => ({ date, profit: totals.get(date)! }));
}

export function buildFundingTotals(deals: BalanceRow[]) {
  let totalDeposit = 0,
    totalWithdraw = 0;
  for (const deal of deals) {
    const delta = dealNet(deal);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    if (op === "deposit" && delta > 0) totalDeposit += delta;
    else if (op === "withdrawal" && delta < 0) totalWithdraw += Math.abs(delta);
  }
  return { totalDeposit, totalWithdraw };
}

export function buildSymbolTradePercent(
  deals: Array<{ symbol?: string | null; type?: string | null }>,
) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const deal of deals) {
    if (!isTradingDeal(deal.type)) continue;
    const symbol = sanitizeOptionalText(deal.symbol) ?? "UNKNOWN";
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    total++;
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .map(([symbol, count]) => ({ symbol, percent: (count / total) * 100 }))
    .sort((a, b) => b.percent - a.percent || a.symbol.localeCompare(b.symbol));
}

export function buildBalanceCurve(deals: BalanceRow[]) {
  const sorted = sortDeals(deals);
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

  let runningBalance: number | null = null;
  if (firstKnownIndex !== -1 && firstKnownBalance !== null) {
    let bal = firstKnownBalance;
    for (let i = firstKnownIndex; i > 0; i--) {
      bal -= dealNet(sorted[i]);
    }
    runningBalance = bal;
  }

  const points = [];
  for (const deal of sorted) {
    const b = getDealBalanceValue(deal);
    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    if (b !== null) {
      runningBalance = b;
    } else if (runningBalance !== null) {
      runningBalance += delta;
    } else if (op === "deposit" && delta > 0) {
      runningBalance = delta;
    }
    if (runningBalance !== null && Number.isFinite(runningBalance)) {
      points.push({
        time: deal.time,
        balance: runningBalance,
        eventType: isTradingDeal(deal)
          ? deal.type || "trade"
          : (deal.type ?? null),
        eventDelta: delta,
      });
    }
  }
  return points;
}

export function buildUnitDrawdownCurve(
  deals: BalanceRow[],
  start: Date | null = null,
  end: Date | null = null,
) {
  const { points, startBalance } = getTradeMetrics(deals, start, end);
  let highWaterMark = startBalance;
  return points.map((pt) => {
    highWaterMark = Math.max(highWaterMark, pt.balance);
    return {
      time: new Date(pt.time),
      equity: pt.balance,
      unitValue: pt.balance,
      highWaterMark,
      drawdownPercent:
        highWaterMark > 0
          ? ((highWaterMark - pt.balance) / highWaterMark) * 100
          : 0,
    };
  });
}

// Normalise a BalanceEventPoint curve by stripping external deposits/withdrawals so the chart
// reflects pure trading P&L. When skipSeedDeposit=true (timeframe "all"), the very first
// non-trading event is the initial deposit and must remain as the baseline; all subsequent
// transfers are zeroed out. When skipSeedDeposit=false (filtered windows), every transfer is
// normalised away because the curve already starts at the period-open balance.
export function normalizeExcludeTransfers(
  curve: BalanceEventPoint[],
  skipSeedDeposit: boolean,
): { x: number; balance: number }[] {
  let cumulativeFunding = 0;
  let seedDepositConsumed = !skipSeedDeposit;
  return curve.map((pt) => {
    if (!isTradingDeal(pt.eventType) && pt.eventDelta != null) {
      if (!seedDepositConsumed) {
        seedDepositConsumed = true;
      } else {
        cumulativeFunding += pt.eventDelta;
      }
    }
    return {
      x: new Date(pt.x).getTime(),
      balance: pt.balance - cumulativeFunding,
    };
  });
}

// Compute a drawdown-percent series from an already-normalised {x, balance} curve.
// hwm seeds from the first point so the initial region is not artificially flat.
export function buildDrawdownPercentSeries(
  normalized: { x: number; balance: number }[],
): { x: number; y: number }[] {
  let hwm = normalized[0]?.balance ?? 0;
  return normalized.map((pt) => {
    hwm = Math.max(hwm, pt.balance);
    const dd = hwm > 0 ? ((hwm - pt.balance) / hwm) * 100 : 0;
    return { x: pt.x, y: -dd };
  });
}
