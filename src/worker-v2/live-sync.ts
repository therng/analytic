// src/worker-v2/live-sync.ts
// Redis key builders mirror bridge_v2/config.py verbatim (no cross-language
// import possible — keep these two files in sync manually if the bridge's
// key scheme changes).
import type { PrismaClient, TradingAccount } from "@prisma/client";
import type { AccountRegistry } from "./account-registry.ts";
import { validateLiveHash, validatePositionsPayload, validateOpenPositionCandidate } from "./validators.ts";
import { mapLiveToAccountSnapshot, mapPositionToOpenPosition } from "./mappers.ts";
import { isFiniteNumeric } from "./decimal.ts";
import type { WorkerV2Status } from "./health.ts";

function keyLive(login: string): string {
  return `mt5:v2:account:${login}:live`;
}
function keyPositions(login: string): string {
  return `mt5:v2:account:${login}:positions`;
}
function keyHeartbeat(login: string): string {
  return `mt5:v2:bridge:${login}:heartbeat`;
}

export async function readHeartbeat(redis: any, accountNo: string): Promise<number | null> {
  const hash = await redis.hGetAll(keyHeartbeat(accountNo));
  if (!hash || !isFiniteNumeric(hash.lastSeen)) return null;
  return Number(hash.lastSeen);
}

export async function syncAccountLive(
  prisma: PrismaClient,
  redis: any,
  account: TradingAccount,
  status: WorkerV2Status,
): Promise<void> {
  const lastSeen = await readHeartbeat(redis, account.accountNo);
  if (lastSeen === null) return;

  const liveHash = await redis.hGetAll(keyLive(account.accountNo));
  const liveValidation = validateLiveHash(liveHash, account.accountNo);
  if (!liveValidation.ok) {
    console.error(`[worker-v2] invalid live hash login=${account.accountNo} reason=${liveValidation.reason}`);
    return;
  }

  const snapshot = mapLiveToAccountSnapshot(account.id, liveHash, lastSeen);
  await prisma.accountSnapshot.upsert({
    where: { tradingAccountId: account.id },
    create: snapshot,
    update: snapshot,
  });
  status.recordLiveSync(account.accountNo);

  const positionsRaw = await redis.get(keyPositions(account.accountNo));
  const positionsValidation = validatePositionsPayload(positionsRaw);
  if (!positionsValidation.ok) {
    console.error(`[worker-v2] invalid positions payload login=${account.accountNo} reason=${positionsValidation.reason}`);
    return;
  }

  const offsetMinutes = account.brokerUtcOffsetMinutes as number;
  const reportDate = new Date(lastSeen * 1000);
  const mapped = [];
  for (const candidate of positionsValidation.positions) {
    const check = validateOpenPositionCandidate(candidate);
    if (!check.ok) {
      console.error(`[worker-v2] dropping malformed open position login=${account.accountNo} reason=${check.reason}`);
      continue;
    }
    mapped.push(mapPositionToOpenPosition(account.id, candidate as Record<string, unknown>, offsetMinutes, reportDate));
  }

  await prisma.$transaction([
    prisma.openPosition.deleteMany({ where: { tradingAccountId: account.id } }),
    prisma.openPosition.createMany({ data: mapped }),
  ]);
  status.recordPositionSync(account.accountNo, mapped.length);
}

export async function runLiveSyncLoop(
  prisma: PrismaClient,
  redis: any,
  registry: AccountRegistry,
  status: WorkerV2Status,
  opts: { intervalMs: number; signal: AbortSignal },
): Promise<void> {
  while (!opts.signal.aborted) {
    for (const account of registry.values()) {
      try {
        await syncAccountLive(prisma, redis, account, status);
      } catch (error) {
        console.error(`[worker-v2] live sync failed login=${account.accountNo}:`, error instanceof Error ? error.message : error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
}
