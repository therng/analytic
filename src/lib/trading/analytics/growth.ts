import { startOfBangkokYear, endOfBangkokYear } from "@/lib/time";
import type { BalanceRow } from "./deal-kernel";
import {
  classifyBalanceOperation,
  dealNet,
  getDealBalanceValue,
  parseTimestamp,
  sortDeals,
} from "./deal-kernel";
import { getTradeMetrics } from "./deal-kernel";

export function computeCompoundedGrowth(
  deals: BalanceRow[],
  start: Date | null,
  end: Date | null = null,
) {
  const sorted = sortDeals(deals);
  const startTime = start ? start.getTime() : 0;
  const endTime = end ? end.getTime() : Infinity;

  let balance = 0;
  let periodStartBalance = 0;
  let growthFactor = 1;
  let hasDealsInWindow = false;

  for (const deal of sorted) {
    const ts = parseTimestamp(deal.time);
    if (ts > endTime) break;

    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    const providedBalance = getDealBalanceValue(deal);

    const inWindow = ts >= startTime;
    if (inWindow && !hasDealsInWindow) {
      hasDealsInWindow = true;
      periodStartBalance = balance;
    }

    if (op !== null) {
      if (inWindow && periodStartBalance > 0) {
        growthFactor *= balance / periodStartBalance;
      }
      balance = providedBalance !== null ? providedBalance : balance + delta;
      if (inWindow) periodStartBalance = balance;
    } else {
      balance = providedBalance !== null ? providedBalance : balance + delta;
    }
  }

  if (hasDealsInWindow && periodStartBalance > 0) {
    growthFactor *= balance / periodStartBalance;
  }

  if (!hasDealsInWindow) return 0;

  const growth = (growthFactor - 1) * 100;
  return Number.isFinite(growth) ? growth : 0;
}

export function computeAbsoluteGain(
  deals: BalanceRow[],
  start: Date | null,
  end: Date | null = null,
) {
  const { points, initialDeposit, startBalance, endBalance } = getTradeMetrics(
    deals,
    start,
    end,
  );
  if (!points.length) return 0;
  const profit = endBalance - startBalance;
  const capitalBase =
    startBalance > 0 ? startBalance : initialDeposit > 0 ? initialDeposit : 0;
  if (capitalBase <= 0) return 0;
  return (profit / capitalBase) * 100;
}

export function computeAllTimeGrowth(deals: BalanceRow[]) {
  return computeCompoundedGrowth(deals, null, null);
}

export function computeYearGrowth(deals: BalanceRow[], year: number) {
  const yearStart = startOfBangkokYear(new Date(Date.UTC(year, 0, 1))) ??
    new Date(Date.UTC(year, 0, 1));
  const yearEnd = endOfBangkokYear(yearStart) ??
    new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return computeCompoundedGrowth(
    deals,
    yearStart,
    yearEnd,
  );
}
