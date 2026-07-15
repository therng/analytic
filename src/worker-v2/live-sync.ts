// src/worker-v2/live-sync.ts
// Redis key builders mirror bridge_v2/config.py verbatim (no cross-language
// import possible — keep these two files in sync manually if the bridge's
// key scheme changes).
import type { PrismaClient, TradingAccount } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import {
  validateLiveHash,
  validatePositionsPayload,
  validateOpenPositionCandidate,
} from "./validators";
import { mapLiveToAccountSnapshot, mapPositionToOpenPosition } from "./mappers";
import { isFiniteNumeric } from "./decimal";
import type { WorkerV2Status } from "./health";

function keyLive(login: string): string {
  return `mt5:v2:account:${login}:live`;
}
function keyPositions(login: string): string {
  return `mt5:v2:account:${login}:positions`;
}
function keyHeartbeat(login: string): string {
  return `mt5:v2:bridge:${login}:heartbeat`;
}

export async function readHeartbeat(
  redis: any,
  accountNo: string,
): Promise<{ lastSeen: number; expectedPositionCount: number } | null> {
  const hash = await redis.hGetAll(keyHeartbeat(accountNo));
  if (!hash || !isFiniteNumeric(hash.lastSeen)) return null;
  const expectedPositionCount = isFiniteNumeric(hash.positions)
    ? Number(hash.positions)
    : 0;
  return { lastSeen: Number(hash.lastSeen), expectedPositionCount };
}

export async function syncAccountLive(
  prisma: PrismaClient,
  redis: any,
  account: TradingAccount,
  status: WorkerV2Status,
): Promise<void> {
  if (account.brokerUtcOffsetMinutes === null) return;

  const heartbeat = await readHeartbeat(redis, account.accountNo);
  if (heartbeat === null) return;
  const { lastSeen, expectedPositionCount } = heartbeat;

  const liveHash = await redis.hGetAll(keyLive(account.accountNo));
  const liveValidation = validateLiveHash(liveHash, account.accountNo);
  if (!liveValidation.ok) {
    console.error(
      `[worker-v2] invalid live hash login=${account.accountNo} reason=${liveValidation.reason}`,
    );
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
    console.error(
      `[worker-v2] invalid positions payload login=${account.accountNo} reason=${positionsValidation.reason}`,
    );
    return;
  }

  if (positionsValidation.positions.length !== expectedPositionCount) {
    console.error(
      `[worker-v2] positions count mismatch login=${account.accountNo} expected=${expectedPositionCount} actual=${positionsValidation.positions.length}`,
    );
    return;
  }

  const offsetMinutes = account.brokerUtcOffsetMinutes;
  const reportDate = new Date(lastSeen * 1000);
  const mapped = [];
  for (const candidate of positionsValidation.positions) {
    const check = validateOpenPositionCandidate(candidate);
    if (!check.ok) {
      console.error(
        `[worker-v2] aborting position replacement, malformed member login=${account.accountNo} reason=${check.reason}`,
      );
      return;
    }
    mapped.push(
      mapPositionToOpenPosition(
        account.id,
        candidate as Record<string, unknown>,
        offsetMinutes,
        reportDate,
      ),
    );
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
        console.error(
          `[worker-v2] live sync failed login=${account.accountNo}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
}
