import { startOfBangkokDay } from "@/lib/time";
import { parseTimestamp } from "./deal-kernel";

export function getPositionCloseTime(row: {
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
}) {
  return row.outTime ?? row.closeTime ?? null;
}

export function getPositionOpenTime(row: {
  openTime?: Date | string | null;
  inTime?: Date | string | null;
}) {
  return row.inTime ?? row.openTime ?? null;
}

export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export type PositionLifetimeRow = {
  openTime?: Date | string | null;
  inTime?: Date | string | null;
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
};

export type PositionLifetimeRange = {
  start: number;
  end: number;
};

export function getPositionLifetimeRange(
  row: PositionLifetimeRow,
): PositionLifetimeRange | null {
  const opened = parseTimestamp(getPositionOpenTime(row));
  const closed = parseTimestamp(getPositionCloseTime(row));

  if (!Number.isFinite(opened) && !Number.isFinite(closed)) {
    return null;
  }

  if (!Number.isFinite(opened)) {
    return { start: closed, end: closed };
  }

  if (!Number.isFinite(closed)) {
    return { start: opened, end: opened };
  }

  if (closed < opened) {
    return { start: closed, end: closed };
  }

  return { start: opened, end: closed };
}

export function getLifetimeCalendarDayCount(start: number, end: number) {
  const startDay = startOfBangkokDay(start);
  const endDay = startOfBangkokDay(end);
  if (!startDay || !endDay) {
    return null;
  }

  return Math.max(
    1,
    Math.floor((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1,
  );
}

export function getLifetimeCalendarWindow(
  rows: PositionLifetimeRow[],
  reportTime?: Date | string | null,
) {
  let earliestStart = Number.POSITIVE_INFINITY;
  let latestEnd = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const range = getPositionLifetimeRange(row);
    if (!range) {
      continue;
    }

    earliestStart = Math.min(earliestStart, range.start);
    latestEnd = Math.max(latestEnd, range.end);
  }

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd)) {
    return null;
  }

  const reportTimestamp = parseTimestamp(reportTime);
  const windowEnd = Number.isFinite(reportTimestamp)
    ? Math.max(latestEnd, reportTimestamp)
    : latestEnd;
  const totalDays = getLifetimeCalendarDayCount(earliestStart, windowEnd);
  if (!totalDays) {
    return null;
  }

  return {
    totalDays,
  };
}
