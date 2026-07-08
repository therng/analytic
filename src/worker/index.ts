import { prisma } from "../lib/prisma";
import { startBridgeConsumer } from "./bridge-consumer";
import { startEquitySampler } from "./equity-sampler";
import { runSymbolConsumer } from "./symbol-consumer";
import { runAggregation } from "./aggregate-performance";
import { startHealthServer, WorkerHeartbeat } from "./health";

const prismaClient = prisma as any;

const WORKER_POLL_MS = Number.parseInt(process.env.WORKER_POLL_MS || "150000", 10);
const HEALTH_PORT = Number.parseInt(process.env.WORKER_HEALTH_PORT || "9100", 10);
// Allow one in-flight poll plus a margin before declaring the loop stale.
const HEALTH_STALE_MS = Number.parseInt(
  process.env.WORKER_HEALTH_STALE_MS || String(WORKER_POLL_MS * 2 + 60_000),
  10,
);

async function runWorker() {
  console.log("Starting bridge worker...");

  startEquitySampler();
  startBridgeConsumer();
  void runSymbolConsumer().catch((error) => {
    console.error("[symbol-consumer] Fatal crash:", error);
  });

  const heartbeat = new WorkerHeartbeat(HEALTH_STALE_MS);
  if (HEALTH_PORT > 0) {
    startHealthServer(heartbeat, HEALTH_PORT);
  }
  console.log("Bridge/Redis worker mode enabled.");

  while (true) {
    heartbeat.markPollStart();
    try {
      await runAggregation();
      heartbeat.markPollSuccess({ found: 0, ready: 0, deferred: 0, imported: 0, skipped: 0, failed: 0 });
    } catch (error) {
      heartbeat.markPollFailure(error);
      console.error("Worker heartbeat cycle failed:", error);
    }

    console.log(`Waiting ${WORKER_POLL_MS / 1000} seconds before next heartbeat...`);
    await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_MS));
  }
}

if (require.main === module) {
  void runWorker()
    .catch((error) => {
      console.error("Worker crashed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prismaClient.$disconnect();
    });
}
