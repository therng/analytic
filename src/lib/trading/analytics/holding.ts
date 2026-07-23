import { computeHoldingSeconds } from "@/lib/trading/trade-distributions";
import { isTradingDeal, parseTimestamp } from "./deal-kernel";
import { getPositionCloseTime, getPositionOpenTime } from "./position-time";

export function computeAverageHoldHours(
  rows: Array<{
    openTime?: Date | string | null;
    inTime?: Date | string | null;
    closeTime?: Date | string | null;
    outTime?: Date | string | null;
  }>,
) {
  let totalHours = 0;
  let count = 0;
  for (const row of rows) {
    const opened = parseTimestamp(getPositionOpenTime(row));
    const closed = parseTimestamp(getPositionCloseTime(row));
    if (Number.isFinite(opened) && Number.isFinite(closed) && closed > opened) {
      totalHours += (closed - opened) / 3_600_000;
      count++;
    }
  }
  return count === 0 ? null : totalHours / count;
}

/**
 * Min/max/avg position holding time in seconds, unified on
 * computeHoldingSeconds (trade-distributions.ts) rather than duplicating the
 * open/close diff logic computeAverageHoldHours already has in hours.
 */
export function summarizeHoldingTime(
  rows: Array<{
    openTime?: Date | string | null;
    inTime?: Date | string | null;
    closeTime?: Date | string | null;
    outTime?: Date | string | null;
  }>,
) {
  let min: number | null = null;
  let max: number | null = null;
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const seconds = computeHoldingSeconds(
      getPositionOpenTime(row),
      getPositionCloseTime(row),
    );
    if (seconds === null) continue;
    if (min === null || seconds < min) min = seconds;
    if (max === null || seconds > max) max = seconds;
    total += seconds;
    count++;
  }
  return {
    minHoldingSeconds: min,
    maxHoldingSeconds: max,
    avgHoldingSeconds: count === 0 ? null : total / count,
  };
}

/**
 * Per-trade holding-period % returns (r_i = eventDelta_i / balanceBefore_i)
 * from a Deal-derived balance curve (buildBalanceCurve), filtered to trading
 * events only so deposits/withdrawals don't distort the sequence — same
 * convention as computeCompoundedGrowth's balance-operation segmentation.
 * Source boundary: balance curve / growth → Deal (per CLAUDE.md), matching
 * AHPR/GHPR being defined over the trade-by-trade equity curve, not raw
 * per-trade profit.
 */
export function computeHoldingPeriodReturns(
  points: Array<{ balance: number; eventDelta: number; eventType: string | null }>,
) {
  const returns: number[] = [];
  for (const point of points) {
    if (!isTradingDeal(point.eventType)) continue;
    const balanceBefore = point.balance - point.eventDelta;
    if (!(balanceBefore > 0)) continue;
    const r = point.eventDelta / balanceBefore;
    if (Number.isFinite(r)) returns.push(r);
  }
  return returns;
}

/**
 * Arithmetic mean of per-trade % returns (AHPR), scaled as a percent number
 * (e.g. 2.34 for +2.34%) — matching this codebase's existing %-field
 * convention (winPercent, balanceDrawdown*Pct all use value*100, not a raw
 * fraction or MT5's internal 1+r multiplier form).
 */
export function computeAHPR(returns: number[]) {
  if (returns.length === 0) return null;
  return (returns.reduce((sum, r) => sum + r, 0) / returns.length) * 100;
}

/**
 * Geometric mean of per-trade % returns (GHPR): (prod(1+r_i))^(1/n) - 1,
 * scaled as a percent number — see computeAHPR for the scaling rationale.
 */
export function computeGHPR(returns: number[]) {
  if (returns.length === 0) return null;
  const logSum = returns.reduce((sum, r) => {
    const growth = 1 + r;
    return sum + (growth > 0 ? Math.log(growth) : Number.NEGATIVE_INFINITY);
  }, 0);
  if (!Number.isFinite(logSum)) return null;
  return (Math.exp(logSum / returns.length) - 1) * 100;
}
