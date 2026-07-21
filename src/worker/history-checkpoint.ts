import { Prisma } from "@prisma/client";
import {
  emptyRecordsSha256,
  type HistoryBarrier,
  type HistoryStream,
} from "./bridge-protocol";
import {
  mapDealPayloadToDeal,
  mapOrderPayloadToOrder,
  mapPositionClosedPayloadToPosition,
} from "./bridge-mapper";
import type {
  RawDealPayload,
  RawOrderPayload,
  RawPositionClosedPayload,
} from "./bridge-mapper";
import { nextRecordsSha256 } from "./bridge-protocol";
import { epochSecondsToDate } from "../lib/time";
export type { HistoryBarrier } from "./bridge-protocol";

export interface HistoryCheckpoint {
  accountId: string;
  phase: "backfill" | "incremental";
  completedThroughServerTime: string;
  dealsCursor: { time: string; ticket: string };
  ordersCursor: { time: string; ticket: string };
  reconstructionState: Record<string, unknown> | null;
  lastCompletedChunkId: string | null;
  backfillCompletedAt: string | null;
}

type ChunkState = {
  windowStartServerTime: string;
  windowEndServerTime: string;
  reachedPresent: boolean;
  barriers: Set<HistoryStream>;
  reconstructionState: Record<string, unknown> | null;
};

export type CheckpointState = {
  checkpoint: HistoryCheckpoint | null;
  chunks?: Map<string, ChunkState>;
};

const MIN_HISTORY_START_TS = "946684800";
export const EMPTY_RECORDS_SHA256 = emptyRecordsSha256();

export function durableHistoryChunkId(
  accountId: string,
  transportChunkId: string,
): string {
  return `${accountId}:${transportChunkId}`;
}

function utcIso(raw: unknown, offsetMinutes: number): string | null {
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? epochSecondsToDate(seconds, offsetMinutes).toISOString()
    : null;
}

/**
 * Keep raw MT5 UTC epochs for bridge reconstruction while persisting ISO audit
 * companions produced by the same converter used for domain rows.
 */
export function normalizeReconstructionState(
  value: Record<string, unknown> | null,
  brokerUtcOffsetMinutes: number,
): Record<string, unknown> | null {
  if (!value) return null;
  const result = structuredClone(value) as any;
  for (const deals of Object.values(result.pending ?? {}) as any[]) {
    if (!Array.isArray(deals)) continue;
    for (const deal of deals) {
      const converted = utcIso(deal?.time, brokerUtcOffsetMinutes);
      if (converted) deal.timeUtc = converted;
    }
  }
  for (const order of Object.values(result.orders ?? {}) as any[]) {
    if (!order || typeof order !== "object") continue;
    const setup = utcIso(
      order.time_setup ?? order.timeSetup,
      brokerUtcOffsetMinutes,
    );
    const done = utcIso(
      order.time_done ?? order.timeDone,
      brokerUtcOffsetMinutes,
    );
    if (setup) order.timeSetupUtc = setup;
    if (done) order.timeDoneUtc = done;
  }
  return result;
}

export function createInitialHistoryCheckpoint(
  accountId: string,
): HistoryCheckpoint {
  return {
    accountId,
    phase: "backfill",
    completedThroughServerTime: MIN_HISTORY_START_TS,
    dealsCursor: { time: MIN_HISTORY_START_TS, ticket: "0" },
    ordersCursor: { time: MIN_HISTORY_START_TS, ticket: "0" },
    reconstructionState: null,
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
  };
}

function chunksFor(state: CheckpointState) {
  if (!state.chunks) state.chunks = new Map();
  return state.chunks;
}

export async function applyHistoryBarrier(
  state: CheckpointState,
  barrier: HistoryBarrier,
): Promise<HistoryCheckpoint | null> {
  const checkpoint = state.checkpoint;
  if (!checkpoint)
    throw new Error("history barrier requires durable checkpoint");
  if (
    BigInt(barrier.windowStartServerTime) >
    BigInt(checkpoint.completedThroughServerTime)
  ) {
    throw new Error("history coverage gap");
  }
  if (
    BigInt(barrier.windowStartServerTime) <
    BigInt(checkpoint.completedThroughServerTime)
  )
    return checkpoint;

  const chunks = chunksFor(state);
  const existing = chunks.get(barrier.chunkId);
  if (
    existing &&
    (existing.windowStartServerTime !== barrier.windowStartServerTime ||
      existing.windowEndServerTime !== barrier.windowEndServerTime)
  ) {
    throw new Error("history chunk metadata fork");
  }
  const chunk = existing ?? {
    windowStartServerTime: barrier.windowStartServerTime,
    windowEndServerTime: barrier.windowEndServerTime,
    reachedPresent: barrier.reachedPresent,
    barriers: new Set<HistoryStream>(),
    reconstructionState: null,
  };
  if (barrier.stream === "position-closed")
    chunk.reconstructionState = barrier.reconstructionState;
  chunk.barriers.add(barrier.stream);
  chunks.set(barrier.chunkId, chunk);
  if (chunk.barriers.size < 3) return checkpoint;

  const next = { ...checkpoint };
  next.completedThroughServerTime = barrier.windowEndServerTime;
  next.dealsCursor = barrier.dealCursor;
  next.ordersCursor = barrier.orderCursor;
  next.lastCompletedChunkId = barrier.chunkId;
  next.reconstructionState = chunk.reconstructionState;
  if (chunk.reachedPresent) {
    next.phase = "incremental";
    next.backfillCompletedAt = new Date().toISOString();
  }
  state.checkpoint = next;
  return next;
}

type DbLike = {
  $transaction<T>(callback: (tx: DbLike) => Promise<T>): Promise<T>;
  deal: { upsert(args: unknown): Promise<unknown> };
  order: { upsert(args: unknown): Promise<unknown> };
  position: { upsert(args: unknown): Promise<unknown> };
  closedPosition: { upsert(args: unknown): Promise<unknown> };
  bridgeHistoryRecord: {
    findUnique(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
  };
  bridgeHistoryChunk: {
    findUnique(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
  bridgeHistoryCheckpoint: {
    findUnique(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
};

function countField(stream: HistoryStream, prefix: "expected" | "applied") {
  if (stream === "deals")
    return `deals${prefix[0].toUpperCase()}${prefix.slice(1)}Count`;
  if (stream === "orders")
    return `orders${prefix[0].toUpperCase()}${prefix.slice(1)}Count`;
  return `positions${prefix[0].toUpperCase()}${prefix.slice(1)}Count`;
}

function digestField(stream: HistoryStream, prefix: "applied") {
  if (stream === "deals")
    return `deals${prefix[0].toUpperCase()}${prefix.slice(1)}Digest`;
  if (stream === "orders")
    return `orders${prefix[0].toUpperCase()}${prefix.slice(1)}Digest`;
  return `positions${prefix[0].toUpperCase()}${prefix.slice(1)}Digest`;
}

function barrierField(stream: HistoryStream, suffix: "At" | "RedisId") {
  if (stream === "deals") return `dealsBarrier${suffix}`;
  if (stream === "orders") return `ordersBarrier${suffix}`;
  return `positionsBarrier${suffix}`;
}

export interface DurableCheckpoint {
  accountId: string;
  phase: "backfill" | "incremental";
  completedThroughServerTime: string;
  dealsCursor: { time: string; ticket: string };
  ordersCursor: { time: string; ticket: string };
  reconstructionState: Record<string, unknown> | null;
  lastCompletedChunkId: string | null;
  backfillCompletedAt: string | null;
  barrierRedisIds?: Partial<Record<HistoryStream, string>>;
}

function checkpointToDurable(row: any): DurableCheckpoint {
  if (!row || (row.phase !== "backfill" && row.phase !== "incremental"))
    throw new Error("invalid durable history checkpoint");
  if (row.phase === "incremental" && !row.backfillCompletedAt)
    throw new Error("incremental checkpoint missing completion timestamp");
  const required = [
    row.completedThroughServerTime,
    row.dealsCursorTime,
    row.dealsCursorTicket,
    row.ordersCursorTime,
    row.ordersCursorTicket,
  ];
  if (
    required.some(
      (value) => value === null || value === undefined || BigInt(value) < 0n,
    )
  )
    throw new Error("durable history checkpoint missing cursor");
  return {
    accountId: String(row.tradingAccountId),
    phase: row.phase,
    completedThroughServerTime: String(row.completedThroughServerTime),
    dealsCursor: {
      time: String(row.dealsCursorTime),
      ticket: String(row.dealsCursorTicket),
    },
    ordersCursor: {
      time: String(row.ordersCursorTime),
      ticket: String(row.ordersCursorTicket),
    },
    reconstructionState: row.reconstructionState ?? null,
    lastCompletedChunkId: row.lastCompletedChunkId ?? null,
    backfillCompletedAt: row.backfillCompletedAt
      ? new Date(row.backfillCompletedAt).toISOString()
      : null,
  };
}

function checkpointWithBarrierIds(
  checkpoint: any,
  chunk: any,
): DurableCheckpoint {
  return {
    ...checkpointToDurable(checkpoint),
    barrierRedisIds: {
      deals: chunk.dealsBarrierRedisId ?? undefined,
      orders: chunk.ordersBarrierRedisId ?? undefined,
      "position-closed": chunk.positionsBarrierRedisId ?? undefined,
    },
  };
}

export async function ensureHistoryCheckpoint(
  client: DbLike,
  accountId: string,
): Promise<DurableCheckpoint> {
  const row = await client.bridgeHistoryCheckpoint.findUnique({
    where: { tradingAccountId: accountId },
  });
  if (row) return checkpointToDurable(row);
  const created = await (client as any).bridgeHistoryCheckpoint.create({
    data: {
      tradingAccountId: accountId,
      phase: "backfill",
      coverageStartServerTime: BigInt(MIN_HISTORY_START_TS),
      completedThroughServerTime: BigInt(MIN_HISTORY_START_TS),
      dealsCursorTime: BigInt(MIN_HISTORY_START_TS),
      dealsCursorTicket: BigInt(0),
      ordersCursorTime: BigInt(MIN_HISTORY_START_TS),
      ordersCursorTicket: BigInt(0),
      reconstructionState: null,
    },
  });
  return checkpointToDurable(created);
}

function recordFields(stream: HistoryStream) {
  if (stream === "deals")
    return {
      count: "dealsAppliedCount",
      digest: "dealsAppliedDigest",
      expected: "dealsExpectedCount",
    };
  if (stream === "orders")
    return {
      count: "ordersAppliedCount",
      digest: "ordersAppliedDigest",
      expected: "ordersExpectedCount",
    };
  return {
    count: "positionsAppliedCount",
    digest: "positionsAppliedDigest",
    expected: "positionsExpectedCount",
  };
}

export async function persistHistoryRecord(
  client: DbLike,
  accountId: string,
  accountNo: string,
  stream: HistoryStream,
  envelope: {
    chunkId: string;
    parentChunkId: string | null;
    windowStartServerTime: string;
    windowEndServerTime: string;
    reachedPresent: boolean;
    dealCursor: { time: string; ticket: string };
    orderCursor: { time: string; ticket: string };
    ordinal: number;
    expectedCount: number;
    eventKey: string;
    payload: Record<string, unknown>;
    payloadSha256: string;
  },
  brokerUtcOffsetMinutes: number,
): Promise<Date | null> {
  return client.$transaction(async (tx) => {
    const chunkId = durableHistoryChunkId(accountId, envelope.chunkId);
    const parentChunkId =
      envelope.parentChunkId == null
        ? envelope.parentChunkId
        : durableHistoryChunkId(accountId, envelope.parentChunkId);
    let chunk = await tx.bridgeHistoryChunk.findUnique({
      where: { id: chunkId },
    });
    if (!chunk) {
      chunk = await tx.bridgeHistoryChunk.create({
        data: {
          id: chunkId,
          tradingAccountId: accountId,
          parentChunkId,
          windowStartServerTime: BigInt(envelope.windowStartServerTime),
          windowEndServerTime: BigInt(envelope.windowEndServerTime),
          dealsCursorTime: BigInt(envelope.dealCursor.time),
          dealsCursorTicket: BigInt(envelope.dealCursor.ticket),
          ordersCursorTime: BigInt(envelope.orderCursor.time),
          ordersCursorTicket: BigInt(envelope.orderCursor.ticket),
          reachedPresent: envelope.reachedPresent,
          dealsExpectedCount: stream === "deals" ? envelope.expectedCount : 0,
          ordersExpectedCount: stream === "orders" ? envelope.expectedCount : 0,
          positionsExpectedCount:
            stream === "position-closed" ? envelope.expectedCount : 0,
          dealsAppliedDigest: EMPTY_RECORDS_SHA256,
          ordersAppliedDigest: EMPTY_RECORDS_SHA256,
          positionsAppliedDigest: EMPTY_RECORDS_SHA256,
        },
      });
    }
    if (
      String(chunk.windowStartServerTime) !== envelope.windowStartServerTime ||
      String(chunk.windowEndServerTime) !== envelope.windowEndServerTime ||
      (chunk.parentChunkId ?? null) !== (parentChunkId ?? null) ||
      String(chunk.dealsCursorTime) !== envelope.dealCursor.time ||
      String(chunk.dealsCursorTicket) !== envelope.dealCursor.ticket ||
      String(chunk.ordersCursorTime) !== envelope.orderCursor.time ||
      String(chunk.ordersCursorTicket) !== envelope.orderCursor.ticket ||
      Boolean(chunk.reachedPresent) !== envelope.reachedPresent
    ) {
      throw new Error("history record metadata fork");
    }
    const fields = recordFields(stream);
    const applied = Number(chunk[fields.count]);
    let expected = Number(chunk[fields.expected]);
    if (expected === 0 && applied === 0 && envelope.expectedCount > 0) {
      await tx.bridgeHistoryChunk.update({
        where: { id: chunkId },
        data: { [fields.expected]: envelope.expectedCount },
      });
      expected = envelope.expectedCount;
    }
    if (expected !== envelope.expectedCount)
      throw new Error(`history record count metadata mismatch for ${stream}`);
    const receipt = await tx.bridgeHistoryRecord.findUnique({
      where: {
        chunkId_stream_ordinal: { chunkId, stream, ordinal: envelope.ordinal },
      },
    });
    if (receipt) {
      if (
        receipt.eventKey !== envelope.eventKey ||
        receipt.payloadSha256 !== envelope.payloadSha256
      )
        throw new Error("history record replay digest conflict");
      return null;
    }
    if (envelope.ordinal < applied)
      throw new Error("history record receipt missing for applied ordinal");
    if (envelope.ordinal > applied)
      throw new Error(`history record ordinal gap for ${stream}`);

    let reportDate: Date | null = null;
    if (stream === "deals") {
      const row = mapDealPayloadToDeal(
        accountId,
        envelope.payload as unknown as RawDealPayload,
        brokerUtcOffsetMinutes,
      );
      await tx.deal.upsert({
        where: {
          tradingAccountId_dealNo: {
            tradingAccountId: accountId,
            dealNo: row.dealNo,
          },
        },
        create: row,
        update: row,
      });
      reportDate =
        row.reportDate instanceof Date
          ? row.reportDate
          : new Date(row.reportDate);
    } else if (stream === "orders") {
      const row = mapOrderPayloadToOrder(
        accountId,
        envelope.payload as unknown as RawOrderPayload,
        brokerUtcOffsetMinutes,
      );
      await tx.order.upsert({
        where: {
          tradingAccountId_orderTicket: {
            tradingAccountId: accountId,
            orderTicket: row.orderTicket,
          },
        },
        create: row,
        update: row,
      });
    } else {
      const row = mapPositionClosedPayloadToPosition(
        accountId,
        envelope.payload as unknown as RawPositionClosedPayload,
        brokerUtcOffsetMinutes,
      );
      await tx.position.upsert({
        where: {
          tradingAccountId_positionNo: {
            tradingAccountId: accountId,
            positionNo: row.positionNo,
          },
        },
        create: row,
        update: row,
      });
      await tx.closedPosition.upsert({
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
      reportDate =
        row.reportDate instanceof Date
          ? row.reportDate
          : new Date(row.reportDate);
    }
    await tx.bridgeHistoryChunk.update({
      where: { id: chunkId },
      data: {
        [fields.count]: applied + 1,
        [fields.digest]: nextRecordsSha256(
          String(chunk[fields.digest]),
          envelope.payloadSha256,
        ),
      },
    });
    await tx.bridgeHistoryRecord.create({
      data: {
        chunkId,
        stream,
        ordinal: envelope.ordinal,
        eventKey: envelope.eventKey,
        payloadSha256: envelope.payloadSha256,
      },
    });
    return reportDate;
  });
}

export async function persistHistoryBarrier(
  client: DbLike,
  accountId: string,
  barrier: HistoryBarrier,
  brokerUtcOffsetMinutes: number,
  redisEntryId?: string,
): Promise<DurableCheckpoint | null> {
  return client.$transaction(async (tx) => {
    const chunkId = durableHistoryChunkId(accountId, barrier.chunkId);
    const parentChunkId =
      barrier.parentChunkId == null
        ? barrier.parentChunkId
        : durableHistoryChunkId(accountId, barrier.parentChunkId);
    let chunk = await tx.bridgeHistoryChunk.findUnique({
      where: { id: chunkId },
    });
    if (!chunk) {
      chunk = await tx.bridgeHistoryChunk.create({
        data: {
          id: chunkId,
          tradingAccountId: accountId,
          parentChunkId,
          windowStartServerTime: BigInt(barrier.windowStartServerTime),
          windowEndServerTime: BigInt(barrier.windowEndServerTime),
          dealsCursorTime: BigInt(barrier.dealCursor.time),
          dealsCursorTicket: BigInt(barrier.dealCursor.ticket),
          ordersCursorTime: BigInt(barrier.orderCursor.time),
          ordersCursorTicket: BigInt(barrier.orderCursor.ticket),
          reachedPresent: barrier.reachedPresent,
          dealsExpectedCount:
            barrier.stream === "deals" ? barrier.recordCount : 0,
          ordersExpectedCount:
            barrier.stream === "orders" ? barrier.recordCount : 0,
          positionsExpectedCount:
            barrier.stream === "position-closed" ? barrier.recordCount : 0,
          dealsAppliedDigest: EMPTY_RECORDS_SHA256,
          ordersAppliedDigest: EMPTY_RECORDS_SHA256,
          positionsAppliedDigest: EMPTY_RECORDS_SHA256,
        },
      });
    }
    if (
      String(chunk.windowStartServerTime) !== barrier.windowStartServerTime ||
      String(chunk.windowEndServerTime) !== barrier.windowEndServerTime ||
      (chunk.parentChunkId ?? null) !== (parentChunkId ?? null) ||
      String(chunk.dealsCursorTime) !== barrier.dealCursor.time ||
      String(chunk.dealsCursorTicket) !== barrier.dealCursor.ticket ||
      String(chunk.ordersCursorTime) !== barrier.orderCursor.time ||
      String(chunk.ordersCursorTicket) !== barrier.orderCursor.ticket ||
      Boolean(chunk.reachedPresent) !== barrier.reachedPresent
    ) {
      throw new Error("history barrier metadata fork");
    }
    const expected = Number(chunk[countField(barrier.stream, "expected")]);
    const applied = Number(chunk[countField(barrier.stream, "applied")]);
    const digest = String(chunk[digestField(barrier.stream, "applied")]);
    if (
      expected !== barrier.recordCount ||
      applied !== expected ||
      digest !== barrier.recordsSha256
    ) {
      throw new Error(
        `history barrier count/digest mismatch for ${barrier.stream}`,
      );
    }
    const barrierData: Record<string, unknown> = {
      [barrierField(barrier.stream, "At")]: new Date(),
      [barrierField(barrier.stream, "RedisId")]: redisEntryId ?? null,
    };
    if (barrier.stream === "position-closed") {
      barrierData.reconstructionState = normalizeReconstructionState(
        barrier.reconstructionState,
        brokerUtcOffsetMinutes,
      );
    }
    await tx.bridgeHistoryChunk.update({
      where: { id: chunkId },
      data: barrierData,
    });

    chunk = await tx.bridgeHistoryChunk.findUnique({ where: { id: chunkId } });
    if (
      !chunk ||
      !chunk.dealsBarrierAt ||
      !chunk.ordersBarrierAt ||
      !chunk.positionsBarrierAt
    )
      return null;
    const checkpoint = await tx.bridgeHistoryCheckpoint.findUnique({
      where: { tradingAccountId: accountId },
    });
    if (!checkpoint)
      throw new Error("history barrier has no durable account checkpoint");
    const checkpointParentChunkId =
      checkpoint.lastCompletedChunkId == null
        ? checkpoint.lastCompletedChunkId
        : durableHistoryChunkId(accountId, checkpoint.lastCompletedChunkId);
    if (chunk.completedAt) {
      const isCurrentCheckpoint =
        checkpoint.lastCompletedChunkId === barrier.chunkId &&
        String(checkpoint.completedThroughServerTime) ===
          String(chunk.windowEndServerTime);
      return isCurrentCheckpoint
        ? checkpointWithBarrierIds(checkpoint, chunk)
        : null;
    }
    if (
      BigInt(chunk.windowStartServerTime) <
      BigInt(checkpoint.completedThroughServerTime)
    )
      return null;
    if (
      BigInt(chunk.windowStartServerTime) >
      BigInt(checkpoint.completedThroughServerTime)
    )
      throw new Error("history coverage gap");
    if ((checkpointParentChunkId ?? null) !== (chunk.parentChunkId ?? null))
      throw new Error("history checkpoint parent fork");
    await tx.bridgeHistoryChunk.update({
      where: { id: chunkId },
      data: { completedAt: new Date() },
    });
    const updated = await tx.bridgeHistoryCheckpoint.update({
      where: { tradingAccountId: accountId },
      data: {
        phase:
          checkpoint.phase === "backfill" && chunk.reachedPresent
            ? "incremental"
            : checkpoint.phase,
        completedThroughServerTime: chunk.windowEndServerTime,
        dealsCursorTime: chunk.dealsCursorTime,
        dealsCursorTicket: chunk.dealsCursorTicket,
        ordersCursorTime: chunk.ordersCursorTime,
        ordersCursorTicket: chunk.ordersCursorTicket,
        reconstructionState: chunk.reconstructionState ?? null,
        lastCompletedChunkId: barrier.chunkId,
        backfillCompletedAt:
          checkpoint.phase === "backfill" && chunk.reachedPresent
            ? new Date()
            : checkpoint.backfillCompletedAt,
      },
    });
    return checkpointWithBarrierIds(updated, chunk);
  });
}

export async function mirrorHistoryCheckpoint(
  redis: any,
  accountNo: string,
  checkpoint: DurableCheckpoint,
): Promise<void> {
  const ackKey = `mt5:bridge:history-ack:${accountNo}`;
  const cursorKey = `mt5:bridge:history-cursor:${accountNo}`;
  const ackPayload = JSON.stringify({ version: 1, ready: true, ...checkpoint });
  const cursorPayload = JSON.stringify({
    deals: checkpoint.dealsCursor,
    orders: checkpoint.ordersCursor,
  });
  await redis
    .multi()
    .set(ackKey, ackPayload)
    .set(cursorKey, cursorPayload)
    .exec();
  if (checkpoint.barrierRedisIds && typeof redis.xTrim === "function") {
    const streamKeys: Record<HistoryStream, string> = {
      deals: `mt5:account:${accountNo}:deals-stream`,
      orders: `mt5:account:${accountNo}:orders-stream`,
      "position-closed": `mt5:account:${accountNo}:position-closed-stream`,
    };
    for (const stream of Object.keys(
      checkpoint.barrierRedisIds,
    ) as HistoryStream[]) {
      const id = checkpoint.barrierRedisIds[stream];
      if (id) await redis.xTrim(streamKeys[stream], "MINID", id);
    }
  }
}
