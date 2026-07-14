import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { resolveAccountByLogin } from "./account-registry";
import { validateDealRecord } from "./validators";
import { mapDealToPrisma } from "./mappers";
import type { StreamEntry, EntryOutcome } from "./stream-consumer";
import type { WorkerV2Status } from "./health";

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
      console.error(`[worker-v2] malformed deal payload redisId=${entry.id}: invalid JSON`);
      return "ack";
    }
    if (payload.kind !== "deal") {
      console.error(`[worker-v2] unexpected kind on deals stream redisId=${entry.id} kind=${String(payload.kind)}`);
      return "ack";
    }
    const account = resolveAccountByLogin(registry, payload.login as string | number);
    if (!account) {
      console.error(`[worker-v2] unknown login for deal login=${String(payload.login)} redisId=${entry.id}`);
      return "ack";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(`[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} stream=deals redisId=${entry.id}`);
      return "leave-pending";
    }
    const validation = validateDealRecord(payload.login, payload.record, account.accountNo);
    if (!validation.ok) {
      const ticket = (payload.record as Record<string, unknown> | undefined)?.ticket;
      console.error(
        `[worker-v2] malformed deal login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.record as Record<string, unknown>;
    const mapped = mapDealToPrisma(account.id, record, account.brokerUtcOffsetMinutes);
    try {
      await prisma.deal.upsert({
        where: { tradingAccountId_dealNo: { tradingAccountId: account.id, dealNo: mapped.dealNo } },
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
    return "ack";
  };
}
