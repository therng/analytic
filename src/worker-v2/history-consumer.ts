// Consumes the native bridge's (bridge/) per-account history stream:
// mt5n:v1:stream:history:{login} (literal braces — a Redis hash tag, see
// bridge/redis_transport.py's cluster_keys, not a template placeholder).
//
// One stream per account carries all three message types the bridge emits:
// history.deal, history.order, history.window. Unlike the retired bridge_v2
// contract, backfill window/cursor progression is now decided and durably
// tracked entirely on the bridge side (its own SQLite journal + outbox/ACK)
// — this worker no longer owns or reconstructs that state machine. It only
// has to persist each deal/order idempotently; history.window is a
// boundary/audit marker with nothing for Postgres to do.
import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { resolveAccountByLogin } from "./account-registry";
import { validateDealRecord, validateOrderRecord } from "./validators";
import { mapDealToPrisma, mapOrderToPrisma } from "./mappers";
import { reconstructPositionIfClosed } from "./position-reconstructor";
import type { StreamEntry, EntryOutcome } from "./stream-consumer";
import { runConsumerLoop } from "./stream-consumer";
import type { WorkerV2Status } from "./health";
import { abortableDelay } from "./background-loop";

export function historyStreamKey(login: string): string {
  return `mt5n:v1:stream:history:{${login}}`;
}

type BridgeEnvelope = {
  schema?: unknown;
  message_type?: unknown;
  account?: { login?: unknown };
  payload?: { raw?: unknown };
};

function parseEnvelope(raw: string | undefined): BridgeEnvelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BridgeEnvelope;
    if (parsed.schema !== "mt5n.bridge.v1") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function makeHistoryHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    const envelope = parseEnvelope(entry.message.envelope);
    if (!envelope) {
      console.error(
        `[worker-v2] malformed history envelope redisId=${entry.id}`,
      );
      return "ack";
    }

    const messageType = envelope.message_type;
    if (messageType === "history.window") {
      return "ack";
    }
    if (messageType !== "history.deal" && messageType !== "history.order") {
      console.error(
        `[worker-v2] unexpected message_type on history stream redisId=${entry.id} type=${String(messageType)}`,
      );
      return "ack";
    }

    const login = envelope.account?.login;
    const account = resolveAccountByLogin(registry, login as string | number);
    if (!account) {
      console.error(
        `[worker-v2] unknown login for history event login=${String(login)} redisId=${entry.id}`,
      );
      return "leave-pending";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(
        `[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} redisId=${entry.id}`,
      );
      return "leave-pending";
    }

    const record = envelope.payload?.raw as Record<string, unknown> | undefined;

    if (messageType === "history.deal") {
      const validation = validateDealRecord(login, record, account.accountNo);
      if (!validation.ok) {
        console.error(
          `[worker-v2] malformed deal login=${account.accountNo} redisId=${entry.id} reason=${validation.reason}`,
        );
        return "ack";
      }
      const mapped = mapDealToPrisma(
        account.id,
        record as Record<string, unknown>,
        account.brokerUtcOffsetMinutes,
      );
      try {
        await prisma.$transaction(async (tx) => {
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
          if (mapped.positionId) {
            const result = await reconstructPositionIfClosed(
              tx as unknown as PrismaClient,
              account.id,
              account.accountNo,
              mapped.positionId,
            );
            if (
              result.status === "corrupted" ||
              result.status === "ambiguous-reopen"
            ) {
              throw new Error(
                `position reconstruction ${result.status} positionId=${mapped.positionId}`,
              );
            }
          }
        });
      } catch (error) {
        console.error(
          `[worker-v2] deal persistence failed login=${account.accountNo} redisId=${entry.id}:`,
          error instanceof Error ? error.message : error,
        );
        status.recordFailure("deal", account.accountNo, "db write failed");
        return "leave-pending";
      }
      status.recordDealProcessed(account.accountNo, entry.id);
      return "ack";
    }

    const validation = validateOrderRecord(login, record, account.accountNo);
    if (!validation.ok) {
      console.error(
        `[worker-v2] malformed order login=${account.accountNo} redisId=${entry.id} reason=${validation.reason}`,
      );
      return "ack";
    }
    const mapped = mapOrderToPrisma(
      account.id,
      record as Record<string, unknown>,
      account.brokerUtcOffsetMinutes,
    );
    try {
      await prisma.order.upsert({
        where: {
          tradingAccountId_orderTicket: {
            tradingAccountId: account.id,
            orderTicket: mapped.orderTicket as string,
          },
        },
        create: mapped,
        update: mapped,
      });
    } catch (error) {
      console.error(
        `[worker-v2] order persistence failed login=${account.accountNo} redisId=${entry.id}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("order", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordOrderProcessed(account.accountNo, entry.id);
    return "ack";
  };
}

// One native history stream per account (mt5n:v1:stream:history:{login}),
// unlike the retired contract's two shared global streams. Accounts appear
// over time (bridge-accounts.ts provisioning + account-registry refresh), so
// this fleet polls the shared registry and starts a dedicated consumer loop
// — its own duplicated Redis connection, since XREADGROUP BLOCK holds the
// socket — for each login it hasn't seen yet. Loops are never stopped for an
// account that disappears from the registry; TradingAccount rows aren't
// deprovisioned in this codebase.
export function runHistoryConsumerFleet(
  baseRedis: { duplicate(): any },
  registry: AccountRegistry,
  consumerName: string,
  handler: (entry: StreamEntry) => Promise<EntryOutcome>,
  opts: {
    batchSize: number;
    blockMs: number;
    idleReclaimMs: number;
    pollIntervalMs: number;
    signal: AbortSignal;
    onCycle?: (login: string, error?: unknown) => void;
  },
): Promise<void> {
  const active = new Set<string>();
  const loopPromises: Promise<void>[] = [];

  const startLoop = (login: string): void => {
    active.add(login);
    const redis = baseRedis.duplicate();
    const promise = (async () => {
      await redis.connect();
      try {
        await runConsumerLoop(
          redis,
          historyStreamKey(login),
          consumerName,
          handler,
          {
            batchSize: opts.batchSize,
            blockMs: opts.blockMs,
            idleReclaimMs: opts.idleReclaimMs,
            signal: opts.signal,
            onCycle: (error) => opts.onCycle?.(login, error),
          },
        );
      } finally {
        await redis.quit().catch(() => undefined);
      }
    })();
    loopPromises.push(promise);
  };

  return (async () => {
    while (!opts.signal.aborted) {
      for (const login of registry.keys()) {
        if (!active.has(login)) startLoop(login);
      }
      await abortableDelay(opts.pollIntervalMs, opts.signal);
    }
    await Promise.all(loopPromises);
  })();
}
