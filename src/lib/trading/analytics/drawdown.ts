import type { BalanceRow } from "./deal-kernel";
import { getTradeMetrics } from "./deal-kernel";

export function computeAbsoluteDrawdown(
  initialDeposit: number | null | undefined,
  minimalBalance: number | null | undefined,
) {
  const initial = Number(initialDeposit ?? 0);
  const minimal = Number(minimalBalance ?? 0);
  const value = initial - minimal;

  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function computeDepositLoadPercent(params: {
  equity: number | null | undefined;
  margin: number | null | undefined;
}) {
  const equity = Number(params.equity ?? 0);
  if (!Number.isFinite(equity) || equity <= 0) return null;
  const margin = Math.max(0, Number(params.margin ?? 0));
  const load = (margin / equity) * 100;
  return Number.isFinite(load) ? load : null;
}

export function computeBalanceDrawdown(
  deals: BalanceRow[],
  start: Date | null = null,
  end: Date | null = null,
) {
  const { points, initialDeposit, totalDeposits, startBalance } =
    getTradeMetrics(deals, start, end);
  const absoluteAmount = computeAbsoluteDrawdown(initialDeposit, startBalance);

  if (!points.length) {
    return {
      initialDeposit,
      totalDeposits,
      minimalBalance: startBalance,
      absoluteAmount,
      maximalAmount: 0,
      maximalPercent: 0,
      relativeAmount: 0,
      relativePercent: 0,
      peakBalance: startBalance,
      troughBalance: startBalance,
    };
  }

  let peak = startBalance,
    minimal = startBalance;
  let peakBal = startBalance,
    troughBal = startBalance;
  let maxAmt = 0,
    maxPct = 0,
    relAmt = 0,
    relPct = 0;

  for (const pt of points) {
    minimal = Math.min(minimal, pt.balance);
    peak = Math.max(peak, pt.balance);
    const ddAmt = peak - pt.balance;
    const ddPct = peak > 0 ? (ddAmt / peak) * 100 : 0;

    if (ddAmt > maxAmt || (ddAmt === maxAmt && ddPct > maxPct)) {
      maxAmt = ddAmt;
      maxPct = ddPct;
      peakBal = peak;
      troughBal = pt.balance;
    }
    if (ddPct > relPct || (ddPct === relPct && ddAmt > relAmt)) {
      relAmt = ddAmt;
      relPct = ddPct;
    }
  }

  return {
    initialDeposit,
    totalDeposits,
    minimalBalance: minimal,
    absoluteAmount: computeAbsoluteDrawdown(initialDeposit, minimal),
    maximalAmount: maxAmt,
    maximalPercent: maxPct,
    relativeAmount: relAmt,
    relativePercent: relPct,
    peakBalance: peakBal,
    troughBalance: troughBal,
  };
}
