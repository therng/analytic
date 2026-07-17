import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getRedisSocialClient } from "../lib/redis-social";
import { recomputeAccountReportResult } from "../lib/trading/calculate-report-results";
import { ensureBridgeAccounts } from "./bridge-accounts";
import {
  mapDealPayloadToDeal,
  mapOrderPayloadToOrder,
  mapPositionClosedPayloadToPosition,
  type RawDealPayload,
  type RawOrderPayload,
  type RawPositionClosedPayload,
} from "./bridge-mapper";
import { parseBarrierEnvelope, parseRecordEnvelope, type HistoryStream } from "./bridge-protocol";
import {
  ensureHistoryCheckpoint,
  mirrorHistoryCheckpoint,
  persistHistoryBarrier,
  persistHistoryRecord,
} from "./history-checkpoint";

export type StreamKind = HistoryStream;

const CONSUMER_GROUP = "worker";
const CONSUMER_NAME = "worker-1";
const BLOCK_MS = 5000;
const CLAIM_IDLE_MS = 60_000;

function streamKey(accountNo: string, kind: StreamKind): string {
  if (kind === "deals") return `mt5:account:${accountNo}:deals-stream`;
  if (kind === "orders") return `mt5:account:${accountNo}:orders-stream`;
  return `mt5:account:${accountNo}:position-closed-stream`;
}

type PrismaLike = {
  // Method syntax (not arrow-property syntax) is intentional: it enables
  // bivariant parameter checking so the real PrismaClient — whose upsert
  // methods take specific generated arg types — is assignable to PrismaLike
  // when drainStream calls processStreamEntry(prisma, ...). The unit tests
  // still inject a structurally-compatible fake.
  deal: { upsert(args: unknown): Promise<unknown> };
  order: { upsert(args: unknown): Promise<unknown> };
  position: { upsert(args: unknown): Promise<unknown> };
  closedPosition: { upsert(args: unknown): Promise<unknown> };
  bridgeHistoryCheckpoint?: {
    findUnique(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
  };
  bridgeHistoryChunk?: {
    findUnique(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
  $transaction?<T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T>;
};

export async function processStreamEntry(
  client: PrismaLike,
  kind: StreamKind,
  tradingAccountId: string,
  rawJson: string,
  recompute: (
    accountId: string,
    sourceReportDate?: Date | null,
  ) => Promise<unknown> = recomputeAccountReportResult,
  recomputeMode: "immediate" | "defer" = "immediate",
  accountNo?: string,
  brokerUtcOffsetMinutes: number | null = null,
  onDurableCheckpoint: (checkpoint: any) => Promise<void> | void = () =>
    undefined,
  redisEntryId?: string,
): Promise<Date | null> {
  if (brokerUtcOffsetMinutes == null) {
    throw new Error(
      `Refusing to persist ${kind} entry for account ${accountNo ?? tradingAccountId}: ` +
        "no brokerUtcOffsetMinutes configured (TradingAccount.brokerUtcOffsetMinutes is null). " +
        "Configure the broker's UTC offset for this account before it can be synced.",
    );
  }

  const raw = JSON.parse(rawJson);

  if (raw && raw.type === "record") {
    if (!accountNo || !client.$transaction || !client.bridgeHistoryChunk)
      throw new Error(
        "automatic history record requires account and Prisma transaction",
      );
    const envelope = parseRecordEnvelope(rawJson);
    if (envelope.accountNo !== accountNo || envelope.stream !== kind)
      throw new Error("automatic history record account/stream mismatch");
    return await persistHistoryRecord(
      client as never,
      tradingAccountId,
      accountNo,
      kind,
      envelope,
      brokerUtcOffsetMinutes,
    );
  }

  if (raw && raw.type === "barrier") {
    if (
      !accountNo ||
      !client.$transaction ||
      !client.bridgeHistoryChunk ||
      !client.bridgeHistoryCheckpoint
    )
      throw new Error(
        "automatic history barrier requires account and Prisma transaction",
      );
    const barrier = parseBarrierEnvelope(rawJson);
    if (barrier.accountNo !== accountNo || barrier.stream !== kind)
      throw new Error("automatic history barrier account/stream mismatch");
    const checkpoint = await persistHistoryBarrier(
      client as never,
      tradingAccountId,
      barrier,
      brokerUtcOffsetMinutes,
      redisEntryId,
    );
    if (checkpoint) await onDurableCheckpoint(checkpoint);
    return null;
  }

  if (kind === "deals") {
    const row = mapDealPayloadToDeal(
      tradingAccountId,
      raw as RawDealPayload,
      brokerUtcOffsetMinutes,
    );
    await client.deal.upsert({
      where: {
        tradingAccountId_dealNo: { tradingAccountId, dealNo: row.dealNo },
      },
      create: row,
      update: row,
    });
    const reportDate =
      row.reportDate instanceof Date
        ? row.reportDate
        : new Date(row.reportDate);
    if (recomputeMode === "immediate") {
      await recompute(tradingAccountId, reportDate);
    }
    return reportDate;
  }

  if (kind === "orders") {
    const row = mapOrderPayloadToOrder(
      tradingAccountId,
      raw as RawOrderPayload,
      brokerUtcOffsetMinutes,
    );
    await client.order.upsert({
      where: {
        tradingAccountId_orderTicket: {
          tradingAccountId,
          orderTicket: row.orderTicket,
        },
      },
      create: row,
      update: row,
    });
    return null;
  }

  const row = mapPositionClosedPayloadToPosition(
    tradingAccountId,
    raw as RawPositionClosedPayload,
    brokerUtcOffsetMinutes,
  );
  await client.position.upsert({
    where: {
      tradingAccountId_positionNo: {
        tradingAccountId,
        positionNo: row.positionNo,
      },
    },
    create: row,
    update: row,
  });

  if (accountNo) {
    await client.closedPosition.upsert({
      where: {
        account_number_position_id: {
          account_number: accountNo,
          position_id: row.positionNo,
        },
      },
      create: {
        account_number: accountNo,
        position_id: row.positionNo,
        symbol: row.symbol,
        type: row.type,
        volume: row.volume,
        open_time: row.openTime ?? new Date(),
        open_price: row.openPrice ?? 0,
        close_time: row.closeTime ?? new Date(),
        close_price: row.closePrice ?? 0,
        sl: row.sl,
        tp: row.tp,
        commission: row.commission,
        swap: row.swap,
        profit: row.profit,
        net_pnl: new Prisma.Decimal(String(row.profit ?? 0))
          .plus(String(row.swap ?? 0))
          .plus(String(row.commission ?? 0)),
        comment: row.comment,
        magic: row.magic ?? null,
        reason: null,
      },
      update: {
        symbol: row.symbol,
        type: row.type,
        volume: row.volume,
        open_time: row.openTime ?? new Date(),
        open_price: row.openPrice ?? 0,
        close_time: row.closeTime ?? new Date(),
        close_price: row.closePrice ?? 0,
        sl: row.sl,
        tp: row.tp,
        commission: row.commission,
        swap: row.swap,
        profit: row.profit,
        net_pnl: new Prisma.Decimal(String(row.profit ?? 0))
          .plus(String(row.swap ?? 0))
          .plus(String(row.commission ?? 0)),
        comment: row.comment,
        magic: row.magic ?? null,
      },
    });
  }

  const reportDate =
    row.reportDate instanceof Date ? row.reportDate : new Date(row.reportDate);
  if (recomputeMode === "immediate") {
    await recompute(tradingAccountId, reportDate);
  }
  return reportDate;
}

function latestReportDate(left: Date | null, right: Date | null) {
  if (!right) return left;
  if (!left || right > left) return right;
  return left;
}

async function ensureGroup(
  redis: Awaited<ReturnType<typeof getRedisSocialClient>>,
  key: string,
) {
  try {
    await redis.xGroupCreate(key, CONSUMER_GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP"))
      throw error;
  }
}

async function drainStream(
  redis: Awaited<ReturnType<typeof getRedisSocialClient>>,
  accountNo: string,
  tradingAccountId: string,
  kind: StreamKind,
  brokerUtcOffsetMinutes: number | null,
) {
  const key = streamKey(accountNo, kind);
  await ensureGroup(redis, key);

  const response = await redis.xReadGroup(
    CONSUMER_GROUP,
    CONSUMER_NAME,
    [{ key, id: ">" }],
    { COUNT: 50, BLOCK: BLOCK_MS },
  );

  let recomputeReportDate: Date | null = null;

  const processAndAck = async (
    entry: { id: string; message: Record<string, string> },
    errorLabel: string,
  ) => {
    try {
      const reportDate = await processStreamEntry(
        prisma,
        kind,
        tradingAccountId,
        entry.message.data,
        recomputeAccountReportResult,
        "defer",
        accountNo,
        brokerUtcOffsetMinutes,
        async (checkpoint) =>
          mirrorHistoryCheckpoint(redis, accountNo, checkpoint),
        entry.id,
      );
      await redis.xAck(key, CONSUMER_GROUP, entry.id);
      return reportDate;
    } catch (error) {
      console.error(
        `[bridge-consumer] ${errorLabel} ${kind} entry ${entry.id} for ${accountNo}:`,
        error,
      );
      return null;
    }
  };

  if (response) {
    for (const stream of response) {
      for (const entry of stream.messages) {
        const reportDate = await processAndAck(entry, "Failed to process");
        recomputeReportDate = latestReportDate(recomputeReportDate, reportDate);
      }
    }
  }

  // Reclaim entries left pending too long (e.g. a prior consumer crashed
  // mid-processing) so they are retried instead of stuck forever.
  const pending = await redis.xPendingRange(key, CONSUMER_GROUP, "-", "+", 50);
  for (const p of pending) {
    if (p.millisecondsSinceLastDelivery < CLAIM_IDLE_MS) continue;
    const claimed = await redis.xClaim(
      key,
      CONSUMER_GROUP,
      CONSUMER_NAME,
      CLAIM_IDLE_MS,
      [p.id],
    );
    for (const entry of claimed) {
      if (!entry) continue;
      const reportDate = await processAndAck(
        entry,
        "Failed to reprocess claimed",
      );
      recomputeReportDate = latestReportDate(recomputeReportDate, reportDate);
    }
  }

  if (recomputeReportDate) {
    await recomputeAccountReportResult(tradingAccountId, recomputeReportDate);
  }
}

export function startBridgeConsumer(): () => void {
  let stopped = false;

  async function loop() {
    const redis = await getRedisSocialClient();
    while (!stopped) {
      try {
        await ensureBridgeAccounts();
        const accounts = await prisma.tradingAccount.findMany({
          select: { id: true, accountNo: true, brokerUtcOffsetMinutes: true },
        });
        for (const account of accounts) {
          if (stopped) break;
          const durableCheckpoint = await ensureHistoryCheckpoint(
            prisma as never,
            account.id,
          );
          await mirrorHistoryCheckpoint(
            redis,
            account.accountNo,
            durableCheckpoint,
          );
          await drainStream(
            redis,
            account.accountNo,
            account.id,
            "deals",
            account.brokerUtcOffsetMinutes,
          );
          await drainStream(
            redis,
            account.accountNo,
            account.id,
            "orders",
            account.brokerUtcOffsetMinutes,
          );
          await drainStream(
            redis,
            account.accountNo,
            account.id,
            "position-closed",
            account.brokerUtcOffsetMinutes,
          );
        }
      } catch (error) {
        console.error("[bridge-consumer] loop error:", error);
      }
    }
  }

  loop().catch((error) =>
    console.error("[bridge-consumer] fatal error:", error),
  );

  return () => {
    stopped = true;
  };
}
