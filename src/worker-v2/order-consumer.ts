import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { resolveAccountByLogin } from "./account-registry";
import { validateOrderRecord } from "./validators";
import { mapOrderToPrisma } from "./mappers";
import type { StreamEntry, EntryOutcome } from "./stream-consumer";
import type { WorkerV2Status } from "./health";
import {
  persistHistoryRecord,
  persistHistoryBarrier,
  mirrorHistoryCheckpoint,
  type HistoryRecordEnvelope,
  type HistoryBarrierEnvelope,
  type DbLike,
  type RedisLike,
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
 * Package 3b: orders never touch position reconstruction directly, but this
 * handler still needs the same reconstructPosition adapter as deal-consumer —
 * whichever stream's barrier is the second to arrive for a chunk is the one
 * whose persistHistoryBarrier call triggers reconciliation (see
 * reconstruct-position-adapter.ts).
 */
export function makeOrderHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
  redis?: RedisLike,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    let payload: RawEnvelope;
    try {
      payload = JSON.parse(entry.message.data);
    } catch {
      console.error(
        `[worker-v2] malformed order payload redisId=${entry.id}: invalid JSON`,
      );
      return "ack";
    }
    if (payload.type !== "record" && payload.type !== "barrier") {
      console.error(
        `[worker-v2] unexpected envelope type on orders stream redisId=${entry.id} type=${String(payload.type)}`,
      );
      return "ack";
    }
    const account = resolveAccountByLogin(
      registry,
      payload.login as string | number,
    );
    if (!account) {
      console.error(
        `[worker-v2] unknown login for order login=${String(payload.login)} redisId=${entry.id}`,
      );
      return "leave-pending";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(
        `[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} stream=orders redisId=${entry.id}`,
      );
      return "leave-pending";
    }

    if (payload.type === "barrier") {
      const barrier: HistoryBarrierEnvelope = {
        stream: "orders",
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
      let checkpoint;
      try {
        checkpoint = await persistHistoryBarrier(
          prisma as unknown as DbLike,
          account.id,
          barrier,
          makeReconstructPosition(account.id, account.accountNo),
          redis,
          account.accountNo,
        );
      } catch (error) {
        console.error(
          `[worker-v2] orders barrier persistence failed login=${account.accountNo} chunkId=${barrier.chunkId}:`,
          error instanceof Error ? error.message : error,
        );
        return "leave-pending";
      }
      if (checkpoint && redis) {
        await mirrorHistoryCheckpoint(redis, account.accountNo, checkpoint);
      }
      return "ack";
    }

    const validation = validateOrderRecord(
      payload.login,
      payload.payload,
      account.accountNo,
    );
    if (!validation.ok) {
      const ticket = (payload.payload as Record<string, unknown> | undefined)
        ?.ticket;
      console.error(
        `[worker-v2] malformed order login=${account.accountNo} stream=orders redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.payload as Record<string, unknown>;
    const mapped = mapOrderToPrisma(
      account.id,
      record,
      account.brokerUtcOffsetMinutes,
    );

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
      await persistHistoryRecord(prisma as unknown as DbLike, account.id, "orders", envelope, async (tx) => {
        await tx.order.upsert({
          where: {
            tradingAccountId_orderTicket: {
              tradingAccountId: account.id,
              orderTicket: mapped.orderTicket,
            },
          },
          create: mapped,
          update: mapped,
        });
      });
    } catch (error) {
      console.error(
        `[worker-v2] history record persistence failed login=${account.accountNo} stream=orders redisId=${entry.id} ticket=${String(record.ticket)}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("order", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordOrderProcessed(account.accountNo, entry.id);
    return "ack";
  };
}
