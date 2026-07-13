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

const BATCH_SIZE = Number(process.env.WORKER_V2_BATCH_SIZE ?? 50);
const BLOCK_MS = Number(process.env.WORKER_V2_BLOCK_MS ?? 5000);
const IDLE_RECLAIM_MS = Number(process.env.WORKER_V2_IDLE_RECLAIM_MS ?? 60_000);
const LIVE_SYNC_INTERVAL_MS = Number(process.env.WORKER_V2_LIVE_SYNC_INTERVAL_MS ?? 2000);
const HEALTH_PORT = Number(process.env.WORKER_V2_HEALTH_PORT ?? 9200);
const ACCOUNT_REFRESH_MS = Number(process.env.WORKER_V2_ACCOUNT_REFRESH_MS ?? 60_000);

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

  startWorkerV2HealthServer(status, HEALTH_PORT);

  const shutdown = () => {
    controller.abort();
    clearInterval(refreshTimer);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await Promise.all([
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
    runLiveSyncLoop(prisma, liveSyncRedis, registry, status, {
      intervalMs: LIVE_SYNC_INTERVAL_MS,
      signal: controller.signal,
    }),
  ]);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[worker-v2] fatal error:", error);
  process.exit(1);
});
