// src/worker-v2/index.ts
import { PrismaClient } from "@prisma/client";
import { getRedisSocialClient } from "../lib/redis-social";
import {
  loadAccountRegistry,
  runAccountRegistryRefreshLoop,
} from "./account-registry";
import { buildConsumerName } from "./stream-consumer";
import { makeHistoryHandler, runHistoryConsumerFleet } from "./history-consumer";
import { runLiveSyncLoop } from "./live-sync";
import { WorkerV2Status, startWorkerV2HealthServer } from "./health";
import { ensureBridgeAccounts } from "./bridge-accounts";
import {
  equityRetentionDays,
  equitySampleIntervalMs,
  runEquitySamplerLoop,
} from "./equity-sampler";
import {
  economicEventsPollIntervalMs,
  runEconomicEventsLoop,
} from "./economic-events-poller";
import {
  queueDepthSampleIntervalMs,
  runQueueDepthSamplerLoop,
} from "./queue-depth-sampler";

export function isLiveSyncEnabled(env: Partial<NodeJS.ProcessEnv>): boolean {
  const raw = env.WORKER_V2_ENABLE_LIVE_SYNC;
  if (raw == null || raw === "") return true;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error("WORKER_V2_ENABLE_LIVE_SYNC must be true or false");
}

const BATCH_SIZE = Number(process.env.WORKER_V2_BATCH_SIZE ?? 50);
const BLOCK_MS = Number(process.env.WORKER_V2_BLOCK_MS ?? 5000);
const IDLE_RECLAIM_MS = Number(process.env.WORKER_V2_IDLE_RECLAIM_MS ?? 60_000);
const LIVE_SYNC_INTERVAL_MS = Number(
  process.env.WORKER_V2_LIVE_SYNC_INTERVAL_MS ?? 2000,
);
const HEALTH_PORT = Number(process.env.WORKER_V2_HEALTH_PORT ?? 9200);
const ACCOUNT_REFRESH_MS = Number(
  process.env.WORKER_V2_ACCOUNT_REFRESH_MS ?? 60_000,
);
const EQUITY_SAMPLE_MS = equitySampleIntervalMs();
const EQUITY_RETENTION_DAYS = equityRetentionDays();
const ECONOMIC_EVENTS_POLL_MS = economicEventsPollIntervalMs();
const QUEUE_DEPTH_SAMPLE_MS = queueDepthSampleIntervalMs();

const LIVE_SYNC_ENABLED = isLiveSyncEnabled(process.env);

const SCHEMA_WAIT_MAX_MS = Number(
  process.env.WORKER_V2_SCHEMA_WAIT_MAX_MS ?? 120_000,
);

function isMissingTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2021"
  );
}

// The web container's RUN_DB_MIGRATIONS runs concurrently with worker-v2's
// own startup; on a fresh deploy or db reset there is no ordering guarantee
// between "migrations finished" and "worker-v2 queries Account". Retrying
// only P2021 (table does not exist) means every other startup error still
// fails fast as before, but a migration race waits instead of exiting and
// leaving history ingestion dead until something notices and restarts it.
//
// This wraps a whole startup thunk, not just one query: provisionAccounts()
// (ensureBridgeAccounts) and loadAccountRegistry() both touch Account and
// land inside the exact same boot-time race window. Retrying only the first
// call and leaving the second unguarded reintroduces the P2021 crash it was
// meant to fix — that was the actual regression (see the fatal at
// loadAccountRegistry in the container logs). Both calls are idempotent
// (upsert + findMany), so retrying the pair together is safe.
export async function waitForSchemaReady<T>(fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let delayMs = 500;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isMissingTableError(error) || Date.now() - startedAt >= SCHEMA_WAIT_MAX_MS) {
        throw error;
      }
      console.warn(
        `[worker-v2] Account table not ready yet, retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 10_000);
    }
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  // Each stream consumer loop gets its own connection: XREADGROUP's BLOCK
  // holds the socket, which would otherwise starve every other account's
  // loop and the live-sync poller sharing one connection. The native history
  // fleet (one stream per account) duplicates baseRedis itself, per account.
  const baseRedis = await getRedisSocialClient();
  const liveSyncRedis = baseRedis.duplicate();
  await liveSyncRedis.connect();
  const status = new WorkerV2Status();
  const controller = new AbortController();

  const provisionAccounts = () =>
    ensureBridgeAccounts({ db: prisma as never });
  const registry = await waitForSchemaReady(async () => {
    await provisionAccounts();
    return loadAccountRegistry(prisma);
  });
  if (registry.size === 0) {
    console.warn(
      "[worker-v2] account registry is empty after startup — no mt5:account:*:live keys in Redis for ensureBridgeAccounts to provision from, so the deals/orders history-stream fleet has no accounts to consume. This is expected with no bridge connected; it is not a crash. It will self-heal once the bridge publishes a live snapshot and the next account-registry refresh (WORKER_V2_ACCOUNT_REFRESH_MS) picks it up.",
    );
  }
  const consumerName = buildConsumerName();
  const historyHandler = makeHistoryHandler(prisma, registry, status);

  const streamStaleAfterMs = Math.max(60_000, BLOCK_MS * 3);
  status.configureComponent("deals", true, streamStaleAfterMs);
  status.configureComponent("orders", true, streamStaleAfterMs);
  status.configureComponent(
    "live",
    LIVE_SYNC_ENABLED,
    LIVE_SYNC_INTERVAL_MS * 3 + 10_000,
  );
  status.configureComponent("equity", true, EQUITY_SAMPLE_MS * 3);
  status.configureComponent(
    "calendar",
    true,
    ECONOMIC_EVENTS_POLL_MS * 2 + 60_000,
  );
  const healthServer = startWorkerV2HealthServer(status, HEALTH_PORT);

  // Idempotent: signals can fire more than once, and the normal-completion
  // path below also calls this. Promise.allSettled so one
  // connection failing to close doesn't skip closing the others — aborting
  // the loops alone isn't enough to let the process exit, since the open
  // Redis sockets and the health server's listening socket both keep the
  // event loop alive on their own.
  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.info(`[worker-v2] received ${signal}, shutting down`);
    controller.abort();

    const results = await Promise.allSettled([
      liveSyncRedis.quit(),
      baseRedis.quit(),
      new Promise<void>((resolve) => healthServer.close(() => resolve())),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[worker-v2] error during shutdown:", result.reason);
      }
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      console.error("[worker-v2] error disconnecting prisma:", error);
    }
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  const loops: Promise<void>[] = [
    runHistoryConsumerFleet(baseRedis, registry, consumerName, historyHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
      pollIntervalMs: 5000,
      signal: controller.signal,
      // Both deal and order records for an account share one native stream,
      // so a single per-account cycle marks both components; recordDealProcessed/
      // recordOrderProcessed (called per-message inside the handler) already
      // give message-type-specific accounting.
      onCycle: (_login, error) => {
        status.recordComponentCycle("deals", error);
        status.recordComponentCycle("orders", error);
      },
    }),
    runEquitySamplerLoop({
      intervalMs: EQUITY_SAMPLE_MS,
      retentionDays: EQUITY_RETENTION_DAYS,
      signal: controller.signal,
      db: prisma as never,
      ensureAccounts: async () => undefined,
      onCycle: (stats) =>
        status.recordComponentCycle(
          "equity",
          stats.failed === 0
            ? undefined
            : new Error(`${stats.failed} account sample(s) failed`),
        ),
    }),
    runEconomicEventsLoop({
      intervalMs: ECONOMIC_EVENTS_POLL_MS,
      signal: controller.signal,
      db: prisma as never,
      onCycle: (stats) =>
        status.recordComponentCycle(
          "calendar",
          stats.fetched && stats.failed === 0
            ? undefined
            : new Error(
                stats.fetched
                  ? `${stats.failed} event upsert(s) failed`
                  : "calendar fetch failed",
              ),
        ),
    }),
    runAccountRegistryRefreshLoop(prisma, registry, {
      intervalMs: ACCOUNT_REFRESH_MS,
      signal: controller.signal,
      provisionAccounts,
    }),
    // baseRedis is safe to reuse here: runHistoryConsumerFleet only calls
    // .duplicate() on it per account, it never issues blocking commands
    // itself, so XLEN/XPENDING sampling on it doesn't contend with a
    // BLOCK-holding socket.
    runQueueDepthSamplerLoop(baseRedis, registry, status, {
      intervalMs: QUEUE_DEPTH_SAMPLE_MS,
      signal: controller.signal,
    }),
  ];
  if (LIVE_SYNC_ENABLED) {
    loops.push(
      runLiveSyncLoop(prisma, liveSyncRedis, registry, status, {
        intervalMs: LIVE_SYNC_INTERVAL_MS,
        signal: controller.signal,
      }),
    );
  } else {
    console.info(
      "[worker-v2] live-sync disabled by WORKER_V2_ENABLE_LIVE_SYNC=false; AccountSnapshot/OpenPosition writes are not active",
    );
  }

  await Promise.all(loops);

  await shutdown("normal-completion");
}

// require.main === module is unreliable under tsx's CJS-loader hook (and
// under node's test runner, which requires this file transitively via
// index.test.ts for isLiveSyncEnabled) — it can be true even when this
// module was only imported, not invoked directly, silently starting a real
// worker instance against production Redis/Postgres during test runs.
// Checking the actual invoked script path is unambiguous.
const invokedPath = process.argv[1] ?? "";
const isMainModule =
  invokedPath.endsWith("/worker-v2/index.ts") ||
  invokedPath.endsWith("/dist/worker-v2.js");

if (isMainModule) {
  main().catch((error) => {
    console.error("[worker-v2] fatal error:", error);
    process.exit(1);
  });
}
