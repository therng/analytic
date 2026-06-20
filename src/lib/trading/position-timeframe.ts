import { filterBySince, getSinceDate } from "./analytics";
import type { Timeframe } from "./types";

export function filterHistoryPositionsByTimeframe<T extends { closedAt?: Date | string | null }>(
  positions: T[],
  timeframe: Timeframe,
  now = new Date(),
): T[] {
  const since = getSinceDate(timeframe, now);
  return filterBySince(positions, (position) => position.closedAt, since);
}
