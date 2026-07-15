// Balance drawdown analytics (spec §7.7-7.9). Pure exact-decimal functions over
// an ordered balance curve. No rounding is applied internally; presentation
// rounding is a caller/API concern. Maximal drawdown (greatest money) and
// relative drawdown (greatest percent) are tracked separately in one pass
// because the two can point at different peak/trough spans — see the mandatory
// fixture in drawdown.test.ts (§8).
import { Prisma } from "@prisma/client";

const D = (value: Prisma.Decimal.Value): Prisma.Decimal =>
  new Prisma.Decimal(value);
const ZERO = D(0);
const HUNDRED = D(100);

/** One point on the balance curve, already ordered ascending by event time. */
export interface BalancePoint {
  time: Date;
  balanceAfter: Prisma.Decimal;
}

/** A peak-to-following-trough drawdown span. */
export interface DrawdownSpan {
  /** peak - trough, always >= 0. */
  money: Prisma.Decimal;
  /** (peak - trough) / peak * 100. Null when peak <= 0 (undefined percentage). */
  percent: Prisma.Decimal | null;
  peakBalance: Prisma.Decimal;
  troughBalance: Prisma.Decimal;
  peakTime: Date;
  troughTime: Date;
}

export interface DrawdownResult {
  /** §7.7 max(0, initialDeposit - minimum balance observed after initial deposit). */
  absolute: Prisma.Decimal;
  /** §7.8 greatest monetary drawdown. Null when the curve has no drawdown. */
  maximal: DrawdownSpan | null;
  /** §7.9 greatest percentage drawdown. Null when no drawdown has a positive peak. */
  relative: DrawdownSpan | null;
}

/**
 * Compute absolute, maximal (money) and relative (percent) balance drawdown.
 *
 * @param points ordered balance curve (ascending event time). Must be sorted by
 *   the caller; this function does not reorder.
 * @param initialDeposit the initial deposit identified from the balance ledger
 *   (spec §7.7) — NOT the current balance.
 */
export function computeDrawdown(
  points: BalancePoint[],
  initialDeposit: Prisma.Decimal,
): DrawdownResult {
  if (points.length === 0) {
    return { absolute: ZERO, maximal: null, relative: null };
  }

  // §7.7 absolute drawdown: initial deposit minus the lowest balance seen.
  let minBalance = points[0].balanceAfter;
  for (const p of points) {
    if (p.balanceAfter.lessThan(minBalance)) minBalance = p.balanceAfter;
  }
  const absoluteRaw = initialDeposit.minus(minBalance);
  const absolute = absoluteRaw.greaterThan(ZERO) ? absoluteRaw : ZERO;

  // §7.8 / §7.9 single running-peak pass.
  let runningPeak = points[0].balanceAfter;
  let peakTime = points[0].time;
  let maximal: DrawdownSpan | null = null; // greatest money
  let relative: DrawdownSpan | null = null; // greatest percent

  for (const p of points) {
    if (p.balanceAfter.greaterThan(runningPeak)) {
      runningPeak = p.balanceAfter;
      peakTime = p.time;
      continue; // a fresh peak has no drawdown against itself
    }

    const money = runningPeak.minus(p.balanceAfter);
    if (!money.greaterThan(ZERO)) continue; // flat or equal: no drawdown

    const percent = runningPeak.greaterThan(ZERO)
      ? money.dividedBy(runningPeak).times(HUNDRED)
      : null;

    const span: DrawdownSpan = {
      money,
      percent,
      peakBalance: runningPeak,
      troughBalance: p.balanceAfter,
      peakTime,
      troughTime: p.time,
    };

    if (maximal === null || money.greaterThan(maximal.money)) {
      maximal = span;
    }
    if (
      percent !== null &&
      (relative === null ||
        relative.percent === null ||
        percent.greaterThan(relative.percent))
    ) {
      relative = span;
    }
  }

  return { absolute, maximal, relative };
}
