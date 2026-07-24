import type { CursorPageInfo, PositionsResponse } from "@/lib/trading/types";
import { positionPips } from "@/lib/trading/analytics";
import type { PositionRow } from "../preaggregated-cache";

const DEFAULT_POSITION_HISTORY_LIMIT = 50;
const MAX_POSITION_HISTORY_LIMIT = 250;

export type PositionHistoryPageOptions = {
  includeHistory: boolean;
  limit: number;
  cursor: string | null;
};

type SerializedHistoryPosition = PositionsResponse["historyPositions"][number];

export function clampPositionHistoryLimit(value: number, allHistory = false) {
  if (!Number.isFinite(value)) {
    return DEFAULT_POSITION_HISTORY_LIMIT;
  }

  const maxLimit = allHistory ? 1000000 : MAX_POSITION_HISTORY_LIMIT;
  return Math.max(1, Math.min(maxLimit, Math.trunc(value)));
}

export function getPositionPips(position: PositionRow) {
  const storedPips = position.pips == null ? null : Number(position.pips);
  if (Number.isFinite(storedPips)) {
    return storedPips;
  }

  return positionPips(position);
}

export function parsePositionHistoryPageOptions(
  searchParams: URLSearchParams,
): PositionHistoryPageOptions {
  const includeHistory = searchParams.get("history") !== "0";
  const rawLimit = Number(
    searchParams.get("limit") ?? DEFAULT_POSITION_HISTORY_LIMIT,
  );
  const allHistory = searchParams.get("timeframe") === "all";

  return {
    includeHistory,
    limit: clampPositionHistoryLimit(rawLimit, allHistory),
    cursor: searchParams.get("cursor"),
  };
}

export function historyPositionTimestamp(position: SerializedHistoryPosition) {
  const timestamp = new Date(
    position.closedAt ?? position.openedAt ?? 0,
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function historyPositionSortId(position: SerializedHistoryPosition) {
  return position.positionId || "";
}

export function encodeHistoryCursor(position: SerializedHistoryPosition) {
  return `${historyPositionTimestamp(position)}:${encodeURIComponent(historyPositionSortId(position))}`;
}

export function decodeHistoryCursor(cursor: string | null) {
  if (!cursor) {
    return null;
  }

  const separatorIndex = cursor.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const timestamp = Number(cursor.slice(0, separatorIndex));
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  try {
    return {
      timestamp,
      positionId: decodeURIComponent(cursor.slice(separatorIndex + 1)),
    };
  } catch {
    return null;
  }
}

export function isAfterHistoryCursor(
  position: SerializedHistoryPosition,
  cursor: ReturnType<typeof decodeHistoryCursor>,
) {
  if (!cursor) {
    return true;
  }

  const timestamp = historyPositionTimestamp(position);
  if (timestamp < cursor.timestamp) {
    return true;
  }

  if (timestamp > cursor.timestamp) {
    return false;
  }

  return historyPositionSortId(position) < cursor.positionId;
}

export function paginatePositionsResponse(
  payload: PositionsResponse,
  options: PositionHistoryPageOptions,
): PositionsResponse {
  const total = payload.historyPositions.length;

  if (!options.includeHistory) {
    const historyPage: CursorPageInfo = {
      total,
      limit: 0,
      hasMore: total > 0,
      nextCursor: null,
    };

    return {
      ...payload,
      historyPositions: [],
      historyPage,
    };
  }

  const cursor = decodeHistoryCursor(options.cursor);
  const rowsAfterCursor = payload.historyPositions.filter((position) =>
    isAfterHistoryCursor(position, cursor),
  );
  const pageRows = rowsAfterCursor.slice(0, options.limit);
  const hasMore = rowsAfterCursor.length > pageRows.length;
  const lastRow = pageRows[pageRows.length - 1] ?? null;
  const historyPage: CursorPageInfo = {
    total,
    limit: options.limit,
    hasMore,
    nextCursor: hasMore && lastRow ? encodeHistoryCursor(lastRow) : null,
  };

  return {
    ...payload,
    historyPositions: pageRows,
    historyPage,
  };
}
