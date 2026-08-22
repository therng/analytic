// src/worker-v2/live-sync.ts
// Native bridge (bridge/) contract: one JSON envelope per account at
// mt5:account:{login}:live (literal braces — a Redis hash tag, see
// bridge/redis_transport.py's cluster_keys, not a template placeholder).
// account/orders/positions arrive atomically in a single envelope now, so
// the old separate live-hash/positions/heartbeat keys and their cross-check
// (expectedPositionCount vs a separately-published positions payload) are
// gone — there's nothing left to race.
import type { PrismaClient, TradingAccount } from "@prisma/client";
import type { AccountRegistry } from "./account-registry";
import { validateOpenPositionCandidate } from "./validators";
import {
  mapLiveToAccountSnapshot,
  mapPositionToOpenPosition,
  mapLiveAccountingSystem,
} from "./mappers";
import type { WorkerV2Status } from "./health";
import { abortableDelay } from "./background-loop";
import { mt5LiveKey as keyLive } from "../lib/mt5-redis-keys";

type BridgeLiveEnvelope = {
  schema?: unknown;
  message_type?: unknown;
  observed_at_utc?: unknown;
  payload_digest?: unknown;
  payload?: {
    account?: { raw?: Record<string, unknown>; state?: unknown };
    orders?: { rows?: unknown[]; state?: unknown };
    positions?: { rows?: unknown[]; state?: unknown };
  };
};

function parseLiveEnvelope(raw: string | null): BridgeLiveEnvelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BridgeLiveEnvelope;
    if (
      parsed.schema !== "mt5n.bridge.v1" ||
      parsed.message_type !== "live.snapshot"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isSuccessState(state: unknown): boolean {
  return state === "success_nonempty" || state === "success_empty";
}

/**
 * Tracks the content fingerprints that have already been durably applied by
 * this worker process. The live hash fingerprint skips AccountSnapshot upsert
 * when account values haven't changed (despite lastSeen always advancing).
 * The raw positions fingerprint is additionally tracked because a position
 * payload can be published independently of an account-value change.
 *
 * This is intentionally in-memory only. A worker restart performs one
 * idempotent reconciliation, while a steady bridge avoids rewriting the same
 * AccountSnapshot and deleting/reinserting the same OpenPosition rows every
 * live-sync interval.
 */
type AccountLiveSyncState = {
  liveHashFingerprint?: string;
  positionsFingerprint?: string;
  lastTouchedAt?: number;
};

export type LiveSyncState = Map<string, AccountLiveSyncState>;

function stateFor(
  state: LiveSyncState,
  accountNo: string,
): AccountLiveSyncState {
  let accountState = state.get(accountNo);
  if (!accountState) {
    accountState = {};
    state.set(accountNo, accountState);
  }
  return accountState;
}

// Bridge accounts with flat live values (no open positions, unchanged
// balance/equity — e.g. over a weekend) never hit the fingerprint-changed
// branch below, so TradingAccount.updatedAt would otherwise go stale and
// the account silently drops out of the dashboard's active-accounts window
// (see ACCOUNT_STALE_MS in src/lib/trading/account-data.ts). Touch it on
// this throttle instead, driven by heartbeat alone, so a live bridge always
// keeps its account visible regardless of whether the values changed.
const LIVENESS_TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export async function syncAccountLive(
  prisma: PrismaClient,
  redis: any,
  account: TradingAccount,
  status: WorkerV2Status,
  state: LiveSyncState = new Map(),
): Promise<void> {
  if (account.brokerUtcOffsetMinutes === null) return;

  const raw = await redis.get(keyLive(account.accountNo));
  const envelope = parseLiveEnvelope(raw);
  if (!envelope) return;
  const observedAtMs = Date.parse(String(envelope.observed_at_utc));
  if (!Number.isFinite(observedAtMs)) return;
  const lastSeen = Math.floor(observedAtMs / 1000);

  const accountState = stateFor(state, account.accountNo);

  const now = Date.now();
  if (
    accountState.lastTouchedAt === undefined ||
    now - accountState.lastTouchedAt >= LIVENESS_TOUCH_INTERVAL_MS
  ) {
    // Liveness only — write lastSeenAt, NOT updatedAt. updatedAt feeds the
    // aggregate version key; a pure liveness touch must not invalidate caches.
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: { lastSeenAt: new Date() },
    });
    accountState.lastTouchedAt = now;
  }

  const accountRaw = envelope.payload?.account?.raw;
  if (!accountRaw || !isSuccessState(envelope.payload?.account?.state)) {
    console.error(
      `[worker-v2] invalid live snapshot login=${account.accountNo} state=${String(envelope.payload?.account?.state)}`,
    );
    return;
  }

  // The whole envelope (account + orders + positions) is published
  // atomically now, so its payload_digest alone is a sufficient
  // idempotent-skip fingerprint — no separate positions cross-check needed.
  const envelopeFingerprint = String(envelope.payload_digest ?? "");
  if (accountState.liveHashFingerprint !== envelopeFingerprint) {
    const snapshot = mapLiveToAccountSnapshot(account.id, accountRaw, lastSeen);
    await prisma.accountSnapshot.upsert({
      where: { tradingAccountId: account.id },
      create: snapshot,
      update: snapshot,
    });
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: mapLiveAccountingSystem(accountRaw),
    });
    accountState.liveHashFingerprint = envelopeFingerprint;
    status.recordLiveSync(account.accountNo);
  }

  const positionsState = envelope.payload?.positions?.state;
  const positionsRows = envelope.payload?.positions?.rows;
  if (!isSuccessState(positionsState) || !Array.isArray(positionsRows)) {
    console.error(
      `[worker-v2] invalid positions payload login=${account.accountNo} state=${String(positionsState)}`,
    );
    return;
  }

  const positionsFingerprint = envelopeFingerprint;
  if (accountState.positionsFingerprint === positionsFingerprint) return;

  const offsetMinutes = account.brokerUtcOffsetMinutes;
  const reportDate = new Date(lastSeen * 1000);
  const mapped = [];
  for (const candidate of positionsRows) {
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

  const replacementOps = [
    prisma.openPosition.deleteMany({ where: { tradingAccountId: account.id } }),
  ];
  if (mapped.length > 0) {
    replacementOps.push(prisma.openPosition.createMany({ data: mapped }));
  }
  await prisma.$transaction(replacementOps);
  accountState.positionsFingerprint = positionsFingerprint;
  status.recordPositionSync(account.accountNo, mapped.length);
}

export async function runLiveSyncLoop(
  prisma: PrismaClient,
  redis: any,
  registry: AccountRegistry,
  status: WorkerV2Status,
  opts: { intervalMs: number; signal: AbortSignal },
): Promise<void> {
  const state: LiveSyncState = new Map();
  while (!opts.signal.aborted) {
    let failures = 0;
    for (const account of registry.values()) {
      try {
        await syncAccountLive(prisma, redis, account, status, state);
      } catch (error) {
        failures += 1;
        console.error(
          `[worker-v2] live sync failed login=${account.accountNo}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    status.recordComponentCycle(
      "live",
      failures === 0 ? undefined : new Error(`${failures} account sync(s) failed`),
    );
    await abortableDelay(opts.intervalMs, opts.signal);
  }
}
