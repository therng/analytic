import { prisma } from "@/lib/prisma";
import type { CursorPageInfo } from "@/lib/trading/types";

export const DEFAULT_TRADE_HISTORY_LIMIT = 150;
export const MAX_TRADE_HISTORY_LIMIT = 250;

export interface TradeHistoryPageOptions {
  limit: number;
  cursor: string | null;
}

export interface TradeHistoryRow {
  positionId: string;
  symbol: string;
  type: string;
  volume: number;
  openedAt: string | null;
  closedAt: string;
  openPrice: number | null;
  closePrice: number | null;
  profit: number;
  sl: number | null;
  tp: number | null;
  swap: number | null;
  commission: number | null;
  pips: number | null;
  comment: string | null;
  magic: number | null;
}

export interface TradeHistoryPage {
  rows: TradeHistoryRow[];
  page: CursorPageInfo;
  syncState: string;
}

export type DecodedTradeHistoryCursor = {
  closeTime: Date;
  positionNo: string;
};

export function clampTradeHistoryLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TRADE_HISTORY_LIMIT;
  }
  return Math.max(1, Math.min(MAX_TRADE_HISTORY_LIMIT, Math.trunc(value)));
}

export function parseTradeHistoryPageOptions(
  searchParams: URLSearchParams,
): TradeHistoryPageOptions {
  const rawLimit = Number(
    searchParams.get("limit") ?? DEFAULT_TRADE_HISTORY_LIMIT,
  );
  return {
    limit: clampTradeHistoryLimit(rawLimit),
    cursor: searchParams.get("cursor"),
  };
}

export function encodeTradeHistoryCursor(
  closeTime: Date,
  positionNo: string,
): string {
  return `${closeTime.getTime()}:${encodeURIComponent(positionNo)}`;
}

export function decodeTradeHistoryCursor(
  cursor: string | null,
): DecodedTradeHistoryCursor | null {
  if (!cursor) {
    return null;
  }

  const separatorIndex = cursor.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const timestampMs = Number(cursor.slice(0, separatorIndex));
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  const closeTime = new Date(timestampMs);
  if (Number.isNaN(closeTime.getTime())) {
    return null;
  }

  const encodedPositionNo = cursor.slice(separatorIndex + 1);
  if (!encodedPositionNo) {
    return null;
  }

  try {
    return {
      closeTime,
      positionNo: decodeURIComponent(encodedPositionNo),
    };
  } catch {
    return null;
  }
}

/**
 * Keyset predicate for `ORDER BY closeTime DESC, positionNo DESC`: rows
 * strictly after the cursor row in that ordering.
 */
export function buildTradeHistoryWhere(
  accountId: string,
  cursor: DecodedTradeHistoryCursor | null,
) {
  const base = {
    tradingAccountId: accountId,
    closeTime: { not: null } as const,
  };

  if (!cursor) {
    return base;
  }

  return {
    ...base,
    OR: [
      { closeTime: { lt: cursor.closeTime } },
      {
        closeTime: cursor.closeTime,
        positionNo: { lt: cursor.positionNo },
      },
    ],
  };
}

async function resolveTradeHistorySyncState(
  accountId: string,
): Promise<string> {
  const checkpoint = await prisma.bridgeHistoryCheckpoint.findUnique({
    where: { tradingAccountId: accountId },
    select: { phase: true },
  });
  return checkpoint?.phase ?? "legacy";
}

export async function queryTradeHistoryPage(
  accountId: string,
  options: TradeHistoryPageOptions,
): Promise<TradeHistoryPage> {
  const cursor = decodeTradeHistoryCursor(options.cursor);
  const where = buildTradeHistoryWhere(accountId, cursor);

  const [total, rows, syncState] = await Promise.all([
    prisma.position.count({
      where: { tradingAccountId: accountId, closeTime: { not: null } },
    }),
    prisma.position.findMany({
      where,
      orderBy: [{ closeTime: "desc" }, { positionNo: "desc" }],
      take: options.limit + 1,
    }),
    resolveTradeHistorySyncState(accountId),
  ]);

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const lastRow = pageRows[pageRows.length - 1] ?? null;

  return {
    rows: pageRows.map((position) => ({
      positionId: position.positionNo,
      symbol: position.symbol,
      type: position.type,
      volume: position.volume,
      openedAt: position.openTime ? position.openTime.toISOString() : null,
      // closeTime is guaranteed non-null by the where clause above.
      closedAt: position.closeTime!.toISOString(),
      openPrice:
        position.openPrice != null ? Number(position.openPrice) : null,
      closePrice:
        position.closePrice != null ? Number(position.closePrice) : null,
      profit: Number(position.profit),
      sl: position.sl != null ? Number(position.sl) : null,
      tp: position.tp != null ? Number(position.tp) : null,
      swap: Number(position.swap),
      commission: Number(position.commission),
      pips: position.pips ?? null,
      comment: position.comment,
      magic: position.magic,
    })),
    page: {
      total,
      limit: options.limit,
      hasMore,
      nextCursor:
        hasMore && lastRow
          ? encodeTradeHistoryCursor(lastRow.closeTime!, lastRow.positionNo)
          : null,
    },
    syncState,
  };
}
