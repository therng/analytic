// src/worker-v2/index.ts
import { PrismaClient } from "@prisma/client";
import { getRedisSocialClient } from "../lib/redis-social";
import { loadAccountRegistry } from "./account-registry";
import { buildConsumerName, runConsumerLoop } from "./stream-consumer";
import { makeDealHandler } from "./deal-consumer";
import { makeOrderHandler } from "./order-consumer";
import { runLiveSyncLoop } from "./live-sync";
import { WorkerV2Status, startWorkerV2HealthServer } from "./health";

const STREAM_DEALS = "mt5:v2:history:deals";
const STREAM_ORDERS = "mt5:v2:history:orders";

export function isLiveSyncEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.WORKER_V2_ENABLE_LIVE_SYNC === "true";
}

const BATCH_SIZE = Number(process.env.WORKER_V2_BATCH_SIZE ?? 50);
const BLOCK_MS = Number(process.env.WORKER_V2_BLOCK_MS ?? 5000);
const IDLE_RECLAIM_MS = Number(process.env.WORKER_V2_IDLE_RECLAIM_MS ?? 60_000);
const LIVE_SYNC_INTERVAL_MS = Number(process.env.WORKER_V2_LIVE_SYNC_INTERVAL_MS ?? 2000);
const HEALTH_PORT = Number(process.env.WORKER_V2_HEALTH_PORT ?? 9200);
const ACCOUNT_REFRESH_MS = Number(process.env.WORKER_V2_ACCOUNT_REFRESH_MS ?? 60_000);
const LIVE_SYNC_ENABLED = isLiveSyncEnabled(process.env);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  // Each loop gets its own connection: runConsumerLoop's XREADGROUP calls
  // block the connection for up to blockMs, which would otherwise starve
  // the other stream consumer and the live-sync poller sharing one socket.
  const baseRedis = await getRedisSocialClient();
  const dealsRedis = baseRedis.duplicate();
  const ordersRedis = baseRedis.duplicate();
  const liveSyncRedis = baseRedis.duplicate();
  await Promise.all([dealsRedis.connect(), ordersRedis.connect(), liveSyncRedis.connect()]);
  const status = new WorkerV2Status();
  const controller = new AbortController();

  const registry = await loadAccountRegistry(prisma);
  const refreshTimer = setInterval(() => {
    loadAccountRegistry(prisma)
      .then((next) => {
        registry.clear();
        for (const [key, value] of next) {
          registry.set(key, value);
        }
      })
      .catch((error) => console.error("[worker-v2] account registry refresh failed:", error));
  }, ACCOUNT_REFRESH_MS);

  const consumerName = buildConsumerName();
  const dealHandler = makeDealHandler(prisma, registry, status);
  const orderHandler = makeOrderHandler(prisma, registry, status);

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
    clearInterval(refreshTimer);

    const results = await Promise.allSettled([
      dealsRedis.quit(),
      ordersRedis.quit(),
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
    runConsumerLoop(dealsRedis, STREAM_DEALS, consumerName, dealHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
      signal: controller.signal,
    }),
    runConsumerLoop(ordersRedis, STREAM_ORDERS, consumerName, orderHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
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
    console.info("[worker-v2] live-sync disabled (WORKER_V2_ENABLE_LIVE_SYNC != 'true'); AccountSnapshot/OpenPosition writes are not active");
  }

  await Promise.all(loops);

  await shutdown("normal-completion");
}

// Guards against running the full worker (real Redis/Prisma/health-server
// side effects) when this module is merely imported — e.g. by index.test.ts
// to reach the pure isLiveSyncEnabled export. `require` is only defined in
// the CJS bundle produced by build:worker-v2 (matches the existing
// require.main === module entrypoint guard in src/worker/index.ts); it is
// undefined when tsx loads this file as ESM for tests, so the check safely
// skips there instead of throwing.
if (typeof require !== "undefined" && require.main === module) {
  main().catch((error) => {
    console.error("[worker-v2] fatal error:", error);
    process.exit(1);
  });
}
