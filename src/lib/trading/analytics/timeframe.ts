import type { Timeframe } from "@/lib/trading/types";
import {
  addBangkokDays,
  endOfBangkokDay,
  startOfBangkokDay,
} from "@/lib/time";
import {
  EMPTY_TEXT_VALUES,
  MAX_FUTURE_SKEW_MS,
  parseTimestamp,
} from "./deal-kernel";

export function sanitizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return EMPTY_TEXT_VALUES.has(normalized.toLowerCase()) ? null : normalized;
}

export function parseTimeframe(value: string | null): Timeframe {
  switch (value) {
    case "1d":
    case "day":
      return "1d";
    case "1w":
    case "w":
    case "5d":
    case "week":
      return "1w";
    case "1m":
    case "m":
    case "month":
      return "1m";
    case "3m":
      return "3m";
    case "6m":
      return "6m";
    case "1y":
    case "year":
      return "1y";
    case "a":
    case "all":
    case "all-time":
    default:
      return "all";
  }
}

export function startOfDay(date: Date) {
  return startOfBangkokDay(date) ?? new Date(date.getTime());
}

export function endOfDay(date: Date) {
  return endOfBangkokDay(date) ?? new Date(date.getTime());
}

export function getSinceDate(timeframe: Timeframe, now = new Date()) {
  switch (timeframe) {
    case "1d":
      return startOfDay(now);
    case "1w":
      return addBangkokDays(startOfDay(now), -7);
    case "1m":
      return addBangkokDays(startOfDay(now), -30);
    case "3m":
      return addBangkokDays(startOfDay(now), -90);
    case "6m":
      return addBangkokDays(startOfDay(now), -180);
    case "1y":
      return addBangkokDays(startOfDay(now), -365);
    default:
      return null;
  }
}

export function getTimeframeLabel(timeframe: Timeframe) {
  switch (timeframe) {
    case "1d":
      return "D";
    case "1w":
      return "W";
    case "1m":
      return "M";
    case "3m":
      return "3M";
    case "6m":
      return "6M";
    case "1y":
      return "1Y";
    default:
      return "A";
  }
}

export function getAccountStatus(
  lastUpdated: Date | string | null | undefined,
  activeWindowMinutes = 7,
) {
  const timestamp = parseTimestamp(lastUpdated);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > Date.now() + MAX_FUTURE_SKEW_MS
  )
    return "Inactive" as const;
  return Date.now() - timestamp <= activeWindowMinutes * 60_000
    ? ("Active" as const)
    : ("Inactive" as const);
}

export function filterBySince<T>(
  rows: T[],
  getTimestamp: (row: T) => Date | string | null | undefined,
  since: Date | null,
) {
  if (!since) return rows;
  const minimum = since.getTime();
  return rows.filter((row) => {
    const ts = parseTimestamp(getTimestamp(row));
    return Number.isFinite(ts) && ts >= minimum;
  });
}

export function filterByDateRange<T>(
  rows: T[],
  getTimestamp: (row: T) => Date | string | null | undefined,
  start: Date | null,
  end: Date | null = null,
) {
  const min = start ? start.getTime() : null;
  const max = end ? end.getTime() : null;
  return rows.filter((row) => {
    const ts = parseTimestamp(getTimestamp(row));
    if (!Number.isFinite(ts)) return false;
    if (min !== null && ts < min) return false;
    if (max !== null && ts > max) return false;
    return true;
  });
}
