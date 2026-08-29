import { addBangkokDays, getBangkokDateKey, startOfBangkokDay } from "@/lib/time";
import type { NumericLike } from "./deal-kernel";
import { dealNet, parseTimestamp } from "./deal-kernel";
import {
  getLifetimeCalendarDayCount,
  getLifetimeCalendarWindow,
  getPositionCloseTime,
  getPositionLifetimeRange,
  MS_PER_YEAR,
  type PositionLifetimeRow,
} from "./position-time";

export function computeTradesPerYear(
  positions: Array<{
    closeTime?: Date | string | null;
    outTime?: Date | string | null;
  }>,
) {
  const closes = positions
    .map((position) => parseTimestamp(getPositionCloseTime(position)))
    .filter((ts) => Number.isFinite(ts))
    .sort((left, right) => left - right);
  if (closes.length < 2) return null;
  const spanMs = closes[closes.length - 1] - closes[0];
  if (spanMs <= 0) return null;
  return (closes.length / spanMs) * MS_PER_YEAR;
}

export function computeTradeActivityPercent(
  rows: PositionLifetimeRow[],
  reportTime?: Date | string | null,
  windowStart?: Date | null,
) {
  let totalDays: number;
  let windowStartMs: number | null = null;
  let windowEndMs: number | null = null;
  if (windowStart) {
    const reportTimestamp = reportTime ? parseTimestamp(reportTime) : null;
    const windowEnd = Number.isFinite(reportTimestamp as number)
      ? (reportTimestamp as number)
      : Date.now();
    const counted = getLifetimeCalendarDayCount(
      windowStart.getTime(),
      windowEnd,
    );
    if (!counted) return null;
    totalDays = counted;
    windowStartMs = windowStart.getTime();
    windowEndMs = windowEnd;
  } else {
    const lifetimeWindow = getLifetimeCalendarWindow(rows, reportTime ?? null);
    if (!lifetimeWindow) return null;
    totalDays = lifetimeWindow.totalDays;
  }

  const activeDays = new Set<string>();

  for (const row of rows) {
    const range = getPositionLifetimeRange(row);
    if (!range) {
      continue;
    }

    // Scoped windows count positions by closeTime >= since, but a held span
    // may start days before `since`; clamp the walk to the window so active
    // days can never exceed totalDays.
    const startMs =
      windowStartMs !== null ? Math.max(range.start, windowStartMs) : range.start;
    const endMs =
      windowEndMs !== null ? Math.min(range.end, windowEndMs) : range.end;
    if (startMs > endMs) {
      continue;
    }

    let cursor = startOfBangkokDay(startMs);
    const endDay = startOfBangkokDay(endMs);
    if (!cursor || !endDay) {
      continue;
    }

    while (cursor.getTime() <= endDay.getTime()) {
      const dayKey = getBangkokDateKey(cursor);
      if (dayKey) {
        activeDays.add(dayKey);
      }

      const nextDay = addBangkokDays(cursor, 1);
      if (!nextDay) {
        break;
      }

      cursor = nextDay;
    }
  }

  return (activeDays.size / totalDays) * 100;
}

const RX_MANUAL_COMMENT =
  /^(manual|balance|credit|deposit|withdrawal|correction|rebate)$/i;

export function computeAlgoTradingPercent(
  rows: Array<{ comment?: string | null }>,
) {
  if (rows.length === 0) return null;
  const algoCount = rows.filter((row) => {
    const c = row.comment?.trim();
    if (!c) return false;
    return !RX_MANUAL_COMMENT.test(c);
  }).length;
  return (algoCount / rows.length) * 100;
}

export function computeAlgoTradingByComment(
  rows: Array<{
    comment?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  const groups = new Map<
    string,
    { count: number; wins: number; netProfit: number }
  >();

  for (const row of rows) {
    const comment = row.comment?.trim();
    if (!comment || RX_MANUAL_COMMENT.test(comment)) continue;

    const netProfit = dealNet(row);
    const group = groups.get(comment) ?? {
      count: 0,
      wins: 0,
      netProfit: 0,
    };
    group.count += 1;
    if (netProfit > 0) group.wins += 1;
    group.netProfit += netProfit;
    groups.set(comment, group);
  }

  const total = [...groups.values()].reduce(
    (sum, group) => sum + group.count,
    0,
  );

  return [...groups.entries()]
    .map(([comment, group]) => ({
      comment,
      count: group.count,
      winRate: (group.wins / group.count) * 100,
      netProfit: group.netProfit,
      percentOfTotal: (group.count / total) * 100,
    }))
    .sort((left, right) => right.count - left.count);
}

export function computeTradesPerWeek(
  rows: PositionLifetimeRow[],
  reportTime?: Date | string | null,
) {
  const closedCount = rows.reduce(
    (total, row) =>
      Number.isFinite(parseTimestamp(getPositionCloseTime(row)))
        ? total + 1
        : total,
    0,
  );
  if (closedCount === 0) {
    return null;
  }

  const lifetimeWindow = getLifetimeCalendarWindow(rows, reportTime);
  if (!lifetimeWindow) {
    return null;
  }

  return (closedCount / lifetimeWindow.totalDays) * 7;
}
