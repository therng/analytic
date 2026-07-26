import { startOfBangkokDay } from "@/lib/time";
import { dealNet, isTradingDeal } from "@/lib/trading/analytics";
import type { DealRow } from "../preaggregated-cache";
import { getDealBalancePointValue } from "./trade-execution";

const ONE_HOUR_MS = 60 * 60 * 1000;

function startOfReportDay(date: Date) {
  return startOfBangkokDay(date) ?? date;
}

export function buildRealtime24HourBalanceCurve(
  deals: DealRow[],
  reportTime: Date,
  endingBalance: number,
) {
  const sortedDeals = [...deals].sort(
    (left, right) =>
      new Date(left.time).getTime() - new Date(right.time).getTime(),
  );
  const anchorTime = reportTime.getTime();
  const startTime = startOfReportDay(reportTime).getTime();
  const endTime = startTime + 24 * ONE_HOUR_MS;
  const clampedAnchorTime = Math.min(Math.max(anchorTime, startTime), endTime);

  let baselineBalance: number | null = null;
  let unanchoredDailyDelta = 0;
  for (const deal of sortedDeals) {
    const timestamp = new Date(deal.time).getTime();
    if (!Number.isFinite(timestamp) || timestamp > clampedAnchorTime) {
      continue;
    }

    const balanceAfter = getDealBalancePointValue(deal);
    const delta = dealNet(deal);

    if (timestamp < startTime) {
      if (balanceAfter !== null) {
        baselineBalance = balanceAfter;
      } else if (baselineBalance !== null && isTradingDeal(deal)) {
        baselineBalance += delta;
      }
      continue;
    }

    if (baselineBalance !== null) {
      break;
    }

    if (balanceAfter !== null) {
      baselineBalance = balanceAfter - delta - unanchoredDailyDelta;
      break;
    }

    if (isTradingDeal(deal)) {
      unanchoredDailyDelta += delta;
    }
  }

  // A day without a usable Deal balance is flat at the current balance. This
  // fallback avoids inventing a zero while keeping Deal rows authoritative for
  // every historical movement in the curve.
  baselineBalance ??= Number.isFinite(endingBalance)
    ? endingBalance - unanchoredDailyDelta
    : 0;

  const points: Array<{
    time: Date;
    balance: number;
    eventType: string | null;
    eventDelta: number | null;
  }> = [
    {
      time: new Date(startTime),
      balance: baselineBalance,
      eventType: null,
      eventDelta: null,
    },
  ];

  let runningBalance = baselineBalance;

  for (const deal of sortedDeals) {
    const timestamp = new Date(deal.time).getTime();
    if (!Number.isFinite(timestamp) || timestamp < startTime) {
      continue;
    }

    if (timestamp > clampedAnchorTime) {
      break;
    }

    const balanceAfter = getDealBalancePointValue(deal);
    const delta = dealNet(deal);

    if (balanceAfter !== null) {
      runningBalance = balanceAfter;
    } else if (isTradingDeal(deal)) {
      runningBalance += delta;
    } else {
      continue; // funding deals without balanceAfter don't affect trading P&L balance curve
    }

    points.push({
      time: new Date(timestamp),
      balance: runningBalance,
      eventType: isTradingDeal(deal)
        ? deal.type || "trade"
        : (deal.type ?? null),
      eventDelta: isTradingDeal(deal) ? delta : null,
    });
  }

  const latestPoint = points[points.length - 1];
  const shouldAppendCurrentPoint =
    !latestPoint ||
    latestPoint.time.getTime() !== clampedAnchorTime ||
    Math.abs(latestPoint.balance - endingBalance) > 0.000001;

  if (shouldAppendCurrentPoint) {
    points.push({
      time: new Date(clampedAnchorTime),
      balance: Number.isFinite(endingBalance) ? endingBalance : runningBalance,
      eventType: null,
      eventDelta: null,
    });
  }

  return points;
}
