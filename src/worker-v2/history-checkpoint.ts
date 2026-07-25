// Durable history checkpoint for Worker V2 — ported from src/worker/history-checkpoint.ts
// (legacy bridge protocol) and adapted for worker-v2's two wire streams (deals, orders).
//
// Package 3b design decision (docs/superpowers/plans/2026-07-25-worker-v2-package-3b-
// durable-history-checkpoint-plan.md, Task 1): legacy's three-stream barrier model
// (deals, orders, position-closed) doesn't map onto worker-v2, which has no wire
// position-closed stream — closed positions are derived inline by
// position-reconstructor.ts. The "third barrier" here is stamped locally by
// ensureReconstructionBarrier once deals+orders barriers land, not by an incoming
// wire message. It reuses the existing positionsBarrierAt column so no schema change
// is needed.
import { createHash } from "node:crypto";

export type HistoryStream = "deals" | "orders";

export type RawCursor = { time: string; ticket: string };

export interface HistoryRecordEnvelope {
  chunkId: string;
  parentChunkId: string | null;
  windowStartServerTime: string;
  windowEndServerTime: string;
  reachedPresent: boolean;
  dealCursor: RawCursor;
  orderCursor: RawCursor;
  ordinal: number;
  expectedCount: number;
  eventKey: string;
  payloadSha256: string;
}

export interface HistoryBarrierEnvelope {
  stream: HistoryStream;
  chunkId: string;
  parentChunkId: string | null;
  windowStartServerTime: string;
  windowEndServerTime: string;
  reachedPresent: boolean;
  dealCursor: RawCursor;
  orderCursor: RawCursor;
  recordCount: number;
  recordsSha256: string;
}

const MIN_HISTORY_START_TS = "946684800"; // 2000-01-01T00:00:00Z

export const EMPTY_RECORDS_SHA256 = createHash("sha256").update("").digest("hex");

export function nextRecordsSha256(previous: string, payloadSha256: string): string {
  return createHash("sha256").update(previous + payloadSha256).digest("hex");
}

export function durableHistoryChunkId(accountId: string, transportChunkId: string): string {
  return `${accountId}:${transportChunkId}`;
}

export interface DurableCheckpoint {
  accountId: string;
  phase: "backfill" | "incremental";
  completedThroughServerTime: string;
  dealsCursor: RawCursor;
  ordersCursor: RawCursor;
  lastCompletedChunkId: string | null;
  backfillCompletedAt: string | null;
}

function checkpointToDurable(row: any): DurableCheckpoint {
  if (!row || (row.phase !== "backfill" && row.phase !== "incremental")) {
    throw new Error("invalid durable history checkpoint");
  }
  if (row.phase === "incremental" && !row.backfillCompletedAt) {
    throw new Error("incremental checkpoint missing completion timestamp");
  }
  const required = [
    row.completedThroughServerTime,
    row.dealsCursorTime,
    row.dealsCursorTicket,
    row.ordersCursorTime,
    row.ordersCursorTicket,
  ];
  if (required.some((value) => value === null || value === undefined || BigInt(value) < 0n)) {
    throw new Error("durable history checkpoint missing cursor");
  }
  return {
    accountId: String(row.tradingAccountId),
    phase: row.phase,
    completedThroughServerTime: String(row.completedThroughServerTime),
    dealsCursor: { time: String(row.dealsCursorTime), ticket: String(row.dealsCursorTicket) },
    ordersCursor: { time: String(row.ordersCursorTime), ticket: String(row.ordersCursorTicket) },
    lastCompletedChunkId: row.lastCompletedChunkId ?? null,
    backfillCompletedAt: row.backfillCompletedAt
      ? new Date(row.backfillCompletedAt).toISOString()
      : null,
  };
}

type DbLike = {
  $transaction<T>(callback: (tx: DbLike) => Promise<T>): Promise<T>;
  deal: { upsert(args: unknown): Promise<unknown> };
  order: { upsert(args: unknown): Promise<unknown> };
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
    create(args: unknown): Promise<any>;
    update(args: unknown): Promise<any>;
  };
};

export async function ensureHistoryCheckpoint(
  client: DbLike,
  accountId: string,
): Promise<DurableCheckpoint> {
  const row = await client.bridgeHistoryCheckpoint.findUnique({
    where: { tradingAccountId: accountId },
  });
  if (row) return checkpointToDurable(row);
  const created = await client.bridgeHistoryCheckpoint.create({
    data: {
      tradingAccountId: accountId,
      phase: "backfill",
      coverageStartServerTime: BigInt(MIN_HISTORY_START_TS),
      completedThroughServerTime: BigInt(MIN_HISTORY_START_TS),
      dealsCursorTime: BigInt(MIN_HISTORY_START_TS),
      dealsCursorTicket: BigInt(0),
      ordersCursorTime: BigInt(MIN_HISTORY_START_TS),
      ordersCursorTicket: BigInt(0),
    },
  });
  return checkpointToDurable(created);
}

function recordFields(stream: HistoryStream) {
  if (stream === "deals") {
    return { count: "dealsAppliedCount", digest: "dealsAppliedDigest", expected: "dealsExpectedCount" };
  }
  return { count: "ordersAppliedCount", digest: "ordersAppliedDigest", expected: "ordersExpectedCount" };
}

/**
 * Persist one deal/order record inside its chunk, transactionally, with the
 * domain-row upsert. Idempotent: exact replay of an already-applied
 * (chunkId, stream, ordinal) is a no-op; digest mismatch at the same ordinal
 * throws rather than overwriting.
 *
 * `upsertDomainRow` performs the caller's existing Deal/Order upsert (mapping
 * + validation stay in deal-consumer.ts/order-consumer.ts) — this function
 * only owns chunk/record bookkeeping so it doesn't need to know mapper details.
 */
export async function persistHistoryRecord(
  client: DbLike,
  accountId: string,
  stream: HistoryStream,
  envelope: HistoryRecordEnvelope,
  upsertDomainRow: (tx: DbLike) => Promise<void>,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const chunkId = durableHistoryChunkId(accountId, envelope.chunkId);
    const parentChunkId =
      envelope.parentChunkId == null ? envelope.parentChunkId : durableHistoryChunkId(accountId, envelope.parentChunkId);
    let chunk = await tx.bridgeHistoryChunk.findUnique({ where: { id: chunkId } });
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
    if (expected !== envelope.expectedCount) {
      throw new Error(`history record count metadata mismatch for ${stream}`);
    }

    const receipt = await tx.bridgeHistoryRecord.findUnique({
      where: { chunkId_stream_ordinal: { chunkId, stream, ordinal: envelope.ordinal } },
    });
    if (receipt) {
      if (receipt.eventKey !== envelope.eventKey || receipt.payloadSha256 !== envelope.payloadSha256) {
        throw new Error("history record replay digest conflict");
      }
      return;
    }
    if (envelope.ordinal < applied) {
      throw new Error("history record receipt missing for applied ordinal");
    }
    if (envelope.ordinal > applied) {
      throw new Error(`history record ordinal gap for ${stream}`);
    }

    await upsertDomainRow(tx);

    await tx.bridgeHistoryChunk.update({
      where: { id: chunkId },
      data: {
        [fields.count]: applied + 1,
        [fields.digest]: nextRecordsSha256(String(chunk[fields.digest]), envelope.payloadSha256),
      },
    });
    await tx.bridgeHistoryRecord.create({
      data: { chunkId, stream, ordinal: envelope.ordinal, eventKey: envelope.eventKey, payloadSha256: envelope.payloadSha256 },
    });
  });
}
