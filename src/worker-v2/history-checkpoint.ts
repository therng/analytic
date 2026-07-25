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

// Package 3b design decision (Task 1, finalized 2026-07-26): the third
// ("Positions") barrier is local and PostgreSQL-authoritative, never a wire
// message. Contract: for stream "deals", BridgeHistoryRecord.eventKey MUST
// equal the deal's dealNo exactly — this is what lets touched-position
// derivation be a pure (chunkId -> dealNo -> positionId) join, re-runnable
// identically after any restart, with no in-memory accumulation.
const POSITION_STATE_DIRECTIONS = new Set(["in", "out", "inout", "out_by"]);

export const RECONSTRUCTION_ALGORITHM_VERSION = 1;

export type PositionReconstructionOutcome =
  | { status: "closed" }
  | { status: "open" }
  | { status: "ambiguous-reopen"; reason?: string }
  | { status: "corrupted"; reason: string }
  | { status: "no-deals" };

export type ReconstructPositionFn = (
  tx: DbLike,
  positionId: string,
) => Promise<PositionReconstructionOutcome>;

export interface BlockingPositionOutcome {
  positionId: string;
  outcome: "corrupted" | "ambiguous-reopen";
  reason: string | null;
  dealIds: string[];
}

export interface ReconstructionState {
  schemaVersion: 1;
  algorithmVersion: number;
  attemptedAt: string;
  touchedPositionCount: number;
  resolvedPositionCount: number;
  blocking: BlockingPositionOutcome[];
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

// Exported so callers can cast a real PrismaClient at the wiring boundary
// (`prisma as unknown as DbLike`). Prisma's real $transaction is overloaded
// (array form + callback form) and TypeScript's overload-matching can't
// prove a real PrismaClient structurally satisfies this single-signature
// interface even though it does at runtime — same category of boundary cast
// as reconstruct-position-adapter.ts's PrismaClient cast.
export type DbLike = {
  $transaction<T>(callback: (tx: DbLike) => Promise<T>): Promise<T>;
  deal: {
    upsert(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<any[]>;
  };
  order: { upsert(args: unknown): Promise<unknown> };
  bridgeHistoryRecord: {
    findUnique(args: unknown): Promise<any>;
    findMany(args: unknown): Promise<any[]>;
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
 *
 * INVARIANT (caller contract, not runtime-enforced): `upsertDomainRow` MUST
 * perform all its writes through the `tx` argument it is given, never through
 * an outer/module-level Prisma client. This function's atomicity guarantee
 * (domain write + chunk counters + receipt all commit or all roll back
 * together) depends entirely on every write happening inside the same
 * `$transaction` callback — a write issued against an outer client would
 * commit immediately, independently, breaking that guarantee silently.
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

/**
 * Deterministically derive this chunk's touched positionIds from durable
 * state only: BridgeHistoryRecord(chunkId, stream="deals").eventKey (== dealNo
 * by contract) joined to Deal.positionId/direction. No in-memory state, no
 * dependency on record-processing order, no time-range comparison against
 * Deal.time (which is broker-offset-converted and not directly comparable to
 * the chunk's raw server-epoch window bounds). Returns positionId -> dealNos
 * (the "related deal identifiers" recorded on blocking outcomes).
 */
async function deriveTouchedPositions(
  tx: DbLike,
  accountId: string,
  chunkId: string,
): Promise<Map<string, string[]>> {
  const records = await tx.bridgeHistoryRecord.findMany({
    where: { chunkId, stream: "deals" },
    select: { eventKey: true },
  });
  const dealNos = records.map((r) => r.eventKey);
  const touched = new Map<string, string[]>();
  if (dealNos.length === 0) return touched;

  const deals = await tx.deal.findMany({
    where: { tradingAccountId: accountId, dealNo: { in: dealNos } },
    select: { dealNo: true, positionId: true, direction: true },
  });
  for (const d of deals) {
    if (!d.positionId || !POSITION_STATE_DIRECTIONS.has(d.direction ?? "")) continue;
    const list = touched.get(d.positionId) ?? [];
    list.push(d.dealNo);
    touched.set(d.positionId, list);
  }
  return touched;
}

/**
 * Reconcile position reconstruction for one chunk. Safe to call repeatedly
 * (idempotent, PostgreSQL-authoritative retry): positions already resolved
 * ("closed"/"open") in a prior stored `reconstructionState` are skipped;
 * every never-attempted or still-blocking position is (re)attempted. Because
 * `reconstructPosition` re-derives its answer from all currently-known deals
 * for that positionId, a position that was blocking due to bad/incomplete
 * data resolves automatically the next time this runs, once the data is
 * valid — no separate retry code path.
 *
 * Must be called from inside the same `$transaction` as the barrier stamp
 * that triggers it (see persistHistoryBarrier) — reconstruction outcomes and
 * the barrier timestamp they gate must commit together.
 */
export async function reconcileChunkPositions(
  tx: DbLike,
  accountId: string,
  chunkId: string,
  reconstructPosition: ReconstructPositionFn,
): Promise<ReconstructionState> {
  const touched = await deriveTouchedPositions(tx, accountId, chunkId);
  const chunk = await tx.bridgeHistoryChunk.findUnique({ where: { id: chunkId } });
  const previous: ReconstructionState | null = chunk?.reconstructionState ?? null;

  const previouslyResolved = new Set<string>();
  if (previous) {
    const blockingIds = new Set(previous.blocking.map((b) => b.positionId));
    for (const positionId of touched.keys()) {
      if (!blockingIds.has(positionId)) previouslyResolved.add(positionId);
    }
  }

  const toAttempt = [...touched.keys()].filter((id) => !previouslyResolved.has(id));
  const blocking: BlockingPositionOutcome[] = [];
  let resolvedCount = previouslyResolved.size;

  for (const positionId of toAttempt) {
    const result = await reconstructPosition(tx, positionId);
    if (result.status === "closed" || result.status === "open") {
      resolvedCount += 1;
    } else if (result.status === "no-deals") {
      throw new Error(
        `reconstruction invariant violation: positionId ${positionId} has no deals despite being derived from persisted chunk records`,
      );
    } else {
      blocking.push({
        positionId,
        outcome: result.status,
        reason: "reason" in result ? result.reason ?? null : null,
        dealIds: touched.get(positionId) ?? [],
      });
    }
  }

  const state: ReconstructionState = {
    schemaVersion: 1,
    algorithmVersion: RECONSTRUCTION_ALGORITHM_VERSION,
    attemptedAt: new Date().toISOString(),
    touchedPositionCount: touched.size,
    resolvedPositionCount: resolvedCount,
    blocking,
  };
  await tx.bridgeHistoryChunk.update({
    where: { id: chunkId },
    data: {
      reconstructionState: state,
      positionsBarrierAt: blocking.length === 0 ? new Date() : null,
    },
  });
  return state;
}

function barrierField(stream: HistoryStream, suffix: "At"): string {
  return stream === "deals" ? `dealsBarrier${suffix}` : `ordersBarrier${suffix}`;
}

/**
 * Persist a stream barrier (deals or orders), then — once both wire barriers
 * for this chunk are present — reconcile position reconstruction (the third,
 * local barrier) inside the same transaction, then advance the checkpoint
 * only if all three are now complete: dealsBarrierAt, ordersBarrierAt, and
 * positionsBarrierAt (which reconcileChunkPositions stamps only when zero
 * blocking outcomes remain). Idempotent: replaying an already-completed
 * chunk's barrier returns the current checkpoint (or null if superseded)
 * without re-advancing anything.
 */
export async function persistHistoryBarrier(
  client: DbLike,
  accountId: string,
  barrier: HistoryBarrierEnvelope,
  reconstructPosition: ReconstructPositionFn,
): Promise<DurableCheckpoint | null> {
  return client.$transaction(async (tx) => {
    const chunkId = durableHistoryChunkId(accountId, barrier.chunkId);
    const parentChunkId =
      barrier.parentChunkId == null ? barrier.parentChunkId : durableHistoryChunkId(accountId, barrier.parentChunkId);
    let chunk = await tx.bridgeHistoryChunk.findUnique({ where: { id: chunkId } });
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
          dealsExpectedCount: barrier.stream === "deals" ? barrier.recordCount : 0,
          ordersExpectedCount: barrier.stream === "orders" ? barrier.recordCount : 0,
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

    if (chunk.completedAt) {
      const checkpoint = await tx.bridgeHistoryCheckpoint.findUnique({ where: { tradingAccountId: accountId } });
      const isCurrentCheckpoint =
        checkpoint &&
        checkpoint.lastCompletedChunkId === barrier.chunkId &&
        String(checkpoint.completedThroughServerTime) === String(chunk.windowEndServerTime);
      return isCurrentCheckpoint ? checkpointToDurable(checkpoint) : null;
    }

    const streamField = recordFields(barrier.stream);
    const expected = Number(chunk[streamField.expected]);
    const applied = Number(chunk[streamField.count]);
    const digest = String(chunk[streamField.digest]);
    if (expected !== barrier.recordCount || applied !== expected || digest !== barrier.recordsSha256) {
      throw new Error(`history barrier count/digest mismatch for ${barrier.stream}`);
    }

    if (!chunk[barrierField(barrier.stream, "At")]) {
      chunk = await tx.bridgeHistoryChunk.update({
        where: { id: chunkId },
        data: { [barrierField(barrier.stream, "At")]: new Date() },
      });
    }

    if (chunk.dealsBarrierAt && chunk.ordersBarrierAt && !chunk.positionsBarrierAt) {
      await reconcileChunkPositions(tx, accountId, chunkId, reconstructPosition);
      chunk = await tx.bridgeHistoryChunk.findUnique({ where: { id: chunkId } });
    }

    if (!chunk.dealsBarrierAt || !chunk.ordersBarrierAt || !chunk.positionsBarrierAt) {
      return null;
    }

    const checkpoint = await tx.bridgeHistoryCheckpoint.findUnique({ where: { tradingAccountId: accountId } });
    if (!checkpoint) throw new Error("history barrier has no durable account checkpoint");
    const checkpointParentChunkId =
      checkpoint.lastCompletedChunkId == null
        ? checkpoint.lastCompletedChunkId
        : durableHistoryChunkId(accountId, checkpoint.lastCompletedChunkId);
    if (BigInt(chunk.windowStartServerTime) < BigInt(checkpoint.completedThroughServerTime)) return null;
    if (BigInt(chunk.windowStartServerTime) > BigInt(checkpoint.completedThroughServerTime)) {
      throw new Error("history coverage gap");
    }
    if ((checkpointParentChunkId ?? null) !== (chunk.parentChunkId ?? null)) {
      throw new Error("history checkpoint parent fork");
    }

    await tx.bridgeHistoryChunk.update({ where: { id: chunkId }, data: { completedAt: new Date() } });
    const updated = await tx.bridgeHistoryCheckpoint.update({
      where: { tradingAccountId: accountId },
      data: {
        phase: checkpoint.phase === "backfill" && chunk.reachedPresent ? "incremental" : checkpoint.phase,
        completedThroughServerTime: chunk.windowEndServerTime,
        dealsCursorTime: chunk.dealsCursorTime,
        dealsCursorTicket: chunk.dealsCursorTicket,
        ordersCursorTime: chunk.ordersCursorTime,
        ordersCursorTicket: chunk.ordersCursorTicket,
        lastCompletedChunkId: barrier.chunkId,
        backfillCompletedAt:
          checkpoint.phase === "backfill" && chunk.reachedPresent ? new Date() : checkpoint.backfillCompletedAt,
      },
    });
    return checkpointToDurable(updated);
  });
}
