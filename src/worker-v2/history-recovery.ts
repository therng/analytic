import {
  Prisma,
  type PrismaClient,
  type TradingAccount,
} from "@prisma/client";
import {
  mirrorHistoryCheckpoint,
  type DurableCheckpoint,
  type RedisLike,
} from "./history-checkpoint";
import { WORKER_V2_GROUP } from "./stream-consumer";

export const HISTORY_START = 1735689600n;
const STREAMS = ["mt5:v2:history:deals", "mt5:v2:history:orders"] as const;
const SCAN_PAGE_SIZE = 500;
const MAX_SCAN_PAGES = 100;

export type RedisRecoveryClient = RedisLike & {
  xRange(
    stream: string,
    start: string,
    end: string,
    options: { COUNT: number },
  ): Promise<Array<{ id: string; message: Record<string, string> }>>;
  xAck(stream: string, group: string, ids: string[]): Promise<number>;
  xDel(stream: string, ids: string[]): Promise<number>;
};

export type RecoveryAccount = TradingAccount & {
  bridgeHistoryCheckpoint?: any | null;
  _count?: { bridgeHistoryChunks?: number };
};

function isInitialCheckpoint(row: any): boolean {
  return (
    BigInt(row.completedThroughServerTime) === HISTORY_START &&
    row.lastCompletedChunkId == null
  );
}

export function needsAutomaticHistoryRecovery(row: any | null): boolean {
  if (!row) return true;
  return (
    BigInt(row.completedThroughServerTime) < HISTORY_START ||
    isInitialCheckpoint(row)
  );
}

export function isEmptyPre2025Window(account: RecoveryAccount): boolean {
  return isEmptyPre2025Checkpoint(
    account.bridgeHistoryCheckpoint ?? null,
    account._count?.bridgeHistoryChunks ?? 0,
  );
}

function isEmptyPre2025Checkpoint(
  checkpoint: any | null,
  bridgeHistoryChunks: number,
): boolean {
  return (
    checkpoint !== null &&
    BigInt(checkpoint.completedThroughServerTime) < HISTORY_START &&
    checkpoint.lastCompletedChunkId == null &&
    bridgeHistoryChunks === 0
  );
}

function initialCheckpointData(accountId: string) {
  return {
    tradingAccountId: accountId,
    phase: "backfill",
    coverageStartServerTime: HISTORY_START,
    completedThroughServerTime: HISTORY_START,
    dealsCursorTime: HISTORY_START,
    dealsCursorTicket: 0n,
    ordersCursorTime: HISTORY_START,
    ordersCursorTicket: 0n,
    reconstructionState: Prisma.JsonNull,
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
  };
}

function toDurableCheckpoint(row: any): DurableCheckpoint {
  return {
    accountId: String(row.tradingAccountId),
    phase: "backfill",
    completedThroughServerTime: String(row.completedThroughServerTime),
    dealsCursor: {
      time: String(row.dealsCursorTime),
      ticket: String(row.dealsCursorTicket),
    },
    ordersCursor: {
      time: String(row.ordersCursorTime),
      ticket: String(row.ordersCursorTicket),
    },
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
  };
}

function messageLogin(entry: {
  message: Record<string, string>;
}): string | null {
  try {
    const payload = JSON.parse(entry.message.data);
    return payload.login == null ? null : String(payload.login);
  } catch {
    return null;
  }
}

async function scanAccountStreamEntries(
  redis: RedisRecoveryClient,
  accountNo: string,
  onEntries: (stream: string, ids: string[]) => Promise<void>,
): Promise<number> {
  let matched = 0;
  for (const stream of STREAMS) {
    let cursor = "-";
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const entries = await redis.xRange(stream, cursor, "+", {
        COUNT: SCAN_PAGE_SIZE,
      });
      if (entries.length === 0) break;

      const ids = entries
        .filter((entry) => messageLogin(entry) === accountNo)
        .map((entry) => entry.id);
      if (ids.length > 0) {
        matched += ids.length;
        await onEntries(stream, ids);
      }

      if (entries.length < SCAN_PAGE_SIZE) break;
      cursor = `(${entries[entries.length - 1].id}`;
      if (page === MAX_SCAN_PAGES - 1) {
        throw new Error(
          `history recovery scan exceeded ${MAX_SCAN_PAGES * SCAN_PAGE_SIZE} entries on ${stream}`,
        );
      }
    }
  }
  return matched;
}

export async function countAccountStreamEntries(
  redis: RedisRecoveryClient,
  accountNo: string,
): Promise<number> {
  return scanAccountStreamEntries(redis, accountNo, async () => {});
}

async function purgeAccountStreamEntries(
  redis: RedisRecoveryClient,
  accountNo: string,
): Promise<number> {
  let removed = 0;
  await scanAccountStreamEntries(redis, accountNo, async (stream, ids) => {
    try {
      await redis.xAck(stream, WORKER_V2_GROUP, ids);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("NOGROUP")
      ) {
        throw error;
      }
    }
    removed += await redis.xDel(stream, ids);
  });
  return removed;
}

async function resetPostgresHistory(
  prisma: PrismaClient,
  accountId: string,
  force: boolean,
): Promise<DurableCheckpoint | null> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.bridgeHistoryCheckpoint.findUnique({
      where: { tradingAccountId: accountId },
    });
    if (force) {
      const chunks = await tx.bridgeHistoryChunk.count({
        where: { tradingAccountId: accountId },
      });
      if (!isEmptyPre2025Checkpoint(existing, chunks)) {
        throw new Error("not an empty pre-2025 window");
      }
    }
    if (!force && !needsAutomaticHistoryRecovery(existing)) return null;

    await tx.bridgeHistoryChunk.deleteMany({
      where: { tradingAccountId: accountId },
    });
    const data = initialCheckpointData(accountId);
    const row = existing
      ? await tx.bridgeHistoryCheckpoint.update({
          where: { tradingAccountId: accountId },
          data,
        })
      : await tx.bridgeHistoryCheckpoint.create({ data });
    return toDurableCheckpoint(row);
  });
}

export async function recoverInitialHistoryState(
  prisma: PrismaClient,
  redis: RedisRecoveryClient,
  accounts: Iterable<RecoveryAccount>,
  options: {
    force?: boolean;
    clearWatermark?: boolean;
  } = {},
): Promise<number> {
  let repaired = 0;
  for (const account of accounts) {
    const checkpoint = await resetPostgresHistory(
      prisma,
      account.id,
      options.force ?? false,
    );
    if (!checkpoint) continue;

    const removed = await purgeAccountStreamEntries(redis, account.accountNo);
    await redis.del(`mt5:v2:history:${account.accountNo}:ack`);
    await redis.del(`mt5:v2:history:${account.accountNo}:pending-window`);
    await redis.del(`mt5:v2:history:${account.accountNo}:cursor`);
    if (options.clearWatermark) {
      await redis.del(`mt5:v2:history:${account.accountNo}:watermark`);
    }
    await mirrorHistoryCheckpoint(redis, account.accountNo, checkpoint);
    repaired += 1;
    console.info(
      `[worker-v2] automatic history recovery login=${account.accountNo} start=${HISTORY_START} removedStreamEntries=${removed}`,
    );
  }
  return repaired;
}
