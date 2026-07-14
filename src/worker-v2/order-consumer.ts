import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { resolveAccountByLogin } from "./account-registry";
import { validateOrderRecord } from "./validators";
import { mapOrderToPrisma } from "./mappers";
import type { StreamEntry, EntryOutcome } from "./stream-consumer";
import type { WorkerV2Status } from "./health";

export function makeOrderHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    let payload: { login?: unknown; kind?: unknown; record?: unknown };
    try {
      payload = JSON.parse(entry.message.data);
    } catch {
      console.error(`[worker-v2] malformed order payload redisId=${entry.id}: invalid JSON`);
      return "ack";
    }
    if (payload.kind !== "order") {
      console.error(`[worker-v2] unexpected kind on orders stream redisId=${entry.id} kind=${String(payload.kind)}`);
      return "ack";
    }
    const account = resolveAccountByLogin(registry, payload.login as string | number);
    if (!account) {
      console.error(`[worker-v2] unknown login for order login=${String(payload.login)} redisId=${entry.id}`);
      return "ack";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(`[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} stream=orders redisId=${entry.id}`);
      return "leave-pending";
    }
    const validation = validateOrderRecord(payload.login, payload.record, account.accountNo);
    if (!validation.ok) {
      const ticket = (payload.record as Record<string, unknown> | undefined)?.ticket;
      console.error(
        `[worker-v2] malformed order login=${account.accountNo} stream=orders redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.record as Record<string, unknown>;
    const mapped = mapOrderToPrisma(account.id, record, account.brokerUtcOffsetMinutes);
    try {
      await prisma.order.upsert({
        where: { tradingAccountId_orderTicket: { tradingAccountId: account.id, orderTicket: mapped.orderTicket } },
        create: mapped,
        update: mapped,
      });
    } catch (error) {
      console.error(
        `[worker-v2] Prisma write failed login=${account.accountNo} stream=orders redisId=${entry.id} ticket=${String(record.ticket)}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("order", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordOrderProcessed(account.accountNo, entry.id);
    return "ack";
  };
}
