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
  latestSnapshotBalance: number = 0,
) {
  const sortedDeals = [...deals].sort(
    (left, right) =>
      new Date(left.time).getTime() - new Date(right.time).getTime(),
  );
  const anchorTime = reportTime.getTime();
  const startTime = startOfReportDay(reportTime).getTime();
  const endTime = startTime + 24 * ONE_HOUR_MS;
  const clampedAnchorTime = Math.min(Math.max(anchorTime, startTime), endTime);

  // Balance at the start of today = the current snapshot balance, since
  // nothing has happened yet today. Deals before startTime already happened
  // and are already baked into latestSnapshotBalance — replaying them here
  // would double-count every prior trading day's P&L onto today's baseline.
  const baselineBalance = latestSnapshotBalance;

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
