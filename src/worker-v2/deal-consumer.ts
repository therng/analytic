import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { resolveAccountByLogin } from "./account-registry";
import { validateDealRecord } from "./validators";
import { mapDealToPrisma } from "./mappers";
import type { StreamEntry, EntryOutcome } from "./stream-consumer";
import type { WorkerV2Status } from "./health";
import {
  persistHistoryRecord,
  persistHistoryBarrier,
  type HistoryRecordEnvelope,
  type HistoryBarrierEnvelope,
  type DbLike,
} from "./history-checkpoint";
import { makeReconstructPosition } from "./reconstruct-position-adapter";

type RawEnvelope = {
  type?: unknown;
  login?: unknown;
  chunkId?: unknown;
  parentChunkId?: unknown;
  windowStartServerTime?: unknown;
  windowEndServerTime?: unknown;
  reachedPresent?: unknown;
  dealCursor?: unknown;
  orderCursor?: unknown;
  ordinal?: unknown;
  expectedCount?: unknown;
  eventKey?: unknown;
  payload?: unknown;
  payloadSha256?: unknown;
  recordCount?: unknown;
  recordsSha256?: unknown;
};

/**
 * Package 3b: this handler owns only the durable history stream
 * (mt5:v2:history:deals). Position reconstruction now happens exclusively
 * inside persistHistoryBarrier's chunk-level reconciliation (once per chunk,
 * inside the same transaction as the barrier stamp) — the old per-deal
 * immediate reconstruction call is intentionally removed: it ran through the
 * outer `prisma` client, not the record transaction, which would have
 * violated the "domain write -> reconstruction outcome -> chunk counters ->
 * receipt -> commit" atomicity this module now guarantees.
 */
export function makeDealHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    let payload: RawEnvelope;
    try {
      payload = JSON.parse(entry.message.data);
    } catch {
      console.error(
        `[worker-v2] malformed deal payload redisId=${entry.id}: invalid JSON`,
      );
      return "ack";
    }
    if (payload.type !== "record" && payload.type !== "barrier") {
      console.error(
        `[worker-v2] unexpected envelope type on deals stream redisId=${entry.id} type=${String(payload.type)}`,
      );
      return "ack";
    }
    const account = resolveAccountByLogin(
      registry,
      payload.login as string | number,
    );
    if (!account) {
      console.error(
        `[worker-v2] unknown login for deal login=${String(payload.login)} redisId=${entry.id}`,
      );
      return "ack";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(
        `[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} stream=deals redisId=${entry.id}`,
      );
      return "leave-pending";
    }

    if (payload.type === "barrier") {
      const barrier: HistoryBarrierEnvelope = {
        stream: "deals",
        chunkId: String(payload.chunkId),
        parentChunkId: payload.parentChunkId == null ? null : String(payload.parentChunkId),
        windowStartServerTime: String(payload.windowStartServerTime),
        windowEndServerTime: String(payload.windowEndServerTime),
        reachedPresent: Boolean(payload.reachedPresent),
        dealCursor: payload.dealCursor as { time: string; ticket: string },
        orderCursor: payload.orderCursor as { time: string; ticket: string },
        recordCount: Number(payload.recordCount),
        recordsSha256: String(payload.recordsSha256),
      };
      try {
        // Any throw here (metadata fork, count/digest mismatch, ordinal gap
        // upstream) must leave the message pending, never ack — acking would
        // permanently drop a barrier this account's checkpoint still needs.
        await persistHistoryBarrier(
          prisma as unknown as DbLike,
          account.id,
          barrier,
          makeReconstructPosition(account.id, account.accountNo),
        );
      } catch (error) {
        console.error(
          `[worker-v2] deals barrier persistence failed login=${account.accountNo} chunkId=${barrier.chunkId}:`,
          error instanceof Error ? error.message : error,
        );
        return "leave-pending";
      }
      return "ack";
    }

    const validation = validateDealRecord(
      payload.login,
      payload.payload,
      account.accountNo,
    );
    if (!validation.ok) {
      const ticket = (payload.payload as Record<string, unknown> | undefined)
        ?.ticket;
      console.error(
        `[worker-v2] malformed deal login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.payload as Record<string, unknown>;
    const mapped = mapDealToPrisma(
      account.id,
      record,
      account.brokerUtcOffsetMinutes,
    );

    // Package 3b contract (plan doc §1a): eventKey MUST equal dealNo — this is
    // what makes touched-position derivation a pure DB join. A mismatch means
    // the producer violated the contract; fail closed (leave-pending) rather
    // than silently letting reconcileChunkPositions miss this deal's position.
    if (String(payload.eventKey) !== mapped.dealNo) {
      console.error(
        `[worker-v2] eventKey/dealNo contract violation login=${account.accountNo} eventKey=${String(payload.eventKey)} dealNo=${mapped.dealNo} redisId=${entry.id}`,
      );
      return "leave-pending";
    }

    const envelope: HistoryRecordEnvelope = {
      chunkId: String(payload.chunkId),
      parentChunkId: payload.parentChunkId == null ? null : String(payload.parentChunkId),
      windowStartServerTime: String(payload.windowStartServerTime),
      windowEndServerTime: String(payload.windowEndServerTime),
      reachedPresent: Boolean(payload.reachedPresent),
      dealCursor: payload.dealCursor as { time: string; ticket: string },
      orderCursor: payload.orderCursor as { time: string; ticket: string },
      ordinal: Number(payload.ordinal),
      expectedCount: Number(payload.expectedCount),
      eventKey: String(payload.eventKey),
      payloadSha256: String(payload.payloadSha256),
    };

    try {
      await persistHistoryRecord(prisma as unknown as DbLike, account.id, "deals", envelope, async (tx) => {
        await tx.deal.upsert({
          where: {
            tradingAccountId_dealNo: {
              tradingAccountId: account.id,
              dealNo: mapped.dealNo,
            },
          },
          create: mapped,
          update: mapped,
        });
      });
    } catch (error) {
      console.error(
        `[worker-v2] history record persistence failed login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(record.ticket)}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("deal", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordDealProcessed(account.accountNo, entry.id);
    return "ack";
  };
}
