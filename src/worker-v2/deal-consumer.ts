import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { resolveAccountByLogin } from "./account-registry";
import { validateDealRecord } from "./validators";
import { mapDealToPrisma } from "./mappers";
import type { StreamEntry, EntryOutcome } from "./stream-consumer";
import type { WorkerV2Status } from "./health";
import { reconstructPositionIfClosed } from "./position-reconstructor";

const POSITION_STATE_DIRECTIONS = new Set(["in", "out", "inout", "out_by"]);

export function makeDealHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    let payload: { login?: unknown; kind?: unknown; record?: unknown };
    try {
      payload = JSON.parse(entry.message.data);
    } catch {
      console.error(
        `[worker-v2] malformed deal payload redisId=${entry.id}: invalid JSON`,
      );
      return "ack";
    }
    if (payload.kind !== "deal") {
      console.error(
        `[worker-v2] unexpected kind on deals stream redisId=${entry.id} kind=${String(payload.kind)}`,
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
    const validation = validateDealRecord(
      payload.login,
      payload.record,
      account.accountNo,
    );
    if (!validation.ok) {
      const ticket = (payload.record as Record<string, unknown> | undefined)
        ?.ticket;
      console.error(
        `[worker-v2] malformed deal login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.record as Record<string, unknown>;
    const mapped = mapDealToPrisma(
      account.id,
      record,
      account.brokerUtcOffsetMinutes,
    );
    try {
      await prisma.deal.upsert({
        where: {
          tradingAccountId_dealNo: {
            tradingAccountId: account.id,
            dealNo: mapped.dealNo,
          },
        },
        create: mapped,
        update: mapped,
      });
    } catch (error) {
      console.error(
        `[worker-v2] Prisma write failed login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(record.ticket)}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("deal", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordDealProcessed(account.accountNo, entry.id);

    if (
      mapped.positionId &&
      POSITION_STATE_DIRECTIONS.has(mapped.direction ?? "")
    ) {
      try {
        const outcome = await reconstructPositionIfClosed(
          prisma,
          account.id,
          account.accountNo,
          mapped.positionId,
        );
        if (outcome.status === "ambiguous-reopen") {
          console.error(
            `[worker-v2] position reconstruction: position_id reused after full close (schema cannot represent two lifecycles under one MT5 position_id) ` +
              `login=${account.accountNo} positionId=${mapped.positionId} lastDealNo=${outcome.lastDealNo}`,
          );
        } else if (outcome.status === "corrupted") {
          console.error(
            `[worker-v2] position reconstruction: corrupted lifecycle (${outcome.reason}) ` +
              `login=${account.accountNo} positionId=${mapped.positionId} lastDealNo=${outcome.lastDealNo}`,
          );
        }
      } catch (error) {
        console.error(
          `[worker-v2] position reconstruction failed login=${account.accountNo} positionId=${mapped.positionId} dealTicket=${mapped.dealNo}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    return "ack";
  };
}
