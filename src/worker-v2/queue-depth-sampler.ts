// Periodically samples Redis backlog across all per-account native history
// streams (mt5:account:{login}:stream:history) and pushes the total into
// WorkerV2Status.recordQueueDepth. Deliberately sampled on its own interval
// rather than on every consume cycle in stream-consumer.ts's hot read path —
// XLEN/XPENDING are cheap individually but scale with account count, and the
// health snapshot only needs a periodic point-in-time view, not per-message
// accuracy.
import type { AccountRegistry } from "./account-registry";
import { historyStreamKey } from "./history-consumer";
import { WORKER_V2_GROUP } from "./stream-consumer";
import type { WorkerV2Status } from "./health";
import { abortableDelay } from "./background-loop";

export const DEFAULT_QUEUE_DEPTH_SAMPLE_MS = 30_000;

type QueueDepthRedis = {
  xLen(key: string): Promise<number>;
  xPending(key: string, group: string): Promise<{ pending: number } | null>;
};

export function queueDepthSampleIntervalMs(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): number {
  const raw = env.WORKER_V2_QUEUE_DEPTH_SAMPLE_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_QUEUE_DEPTH_SAMPLE_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      "WORKER_V2_QUEUE_DEPTH_SAMPLE_MS must be a positive integer",
    );
  }
  return value;
}

export async function sampleQueueDepthOnce(
  redis: QueueDepthRedis,
  registry: AccountRegistry,
  status: WorkerV2Status,
): Promise<void> {
  const logins = [...registry.keys()];
  if (logins.length === 0) return;

  // One batch of concurrent probes instead of 2 sequential RTTs per login —
  // with 5 accounts this cuts 10 round-trips to 1 wave.
  const samples = await Promise.all(
    logins.map(async (login) => {
      const streamKey = historyStreamKey(login);
      try {
        const [length, summary] = await Promise.all([
          redis.xLen(streamKey),
          // A stream with no consumer group yet (never consumed) rejects
          // XPENDING with NOGROUP — treat that as zero pending, not a sample
          // failure, since the stream itself is still readable for XLEN.
          redis.xPending(streamKey, WORKER_V2_GROUP).catch(() => null),
        ]);
        return { length: length ?? 0, pending: summary?.pending ?? 0 };
      } catch (error) {
        console.error(
          `[worker-v2] queue-depth sample error on ${streamKey}:`,
          error instanceof Error ? error.message : error,
        );
        return { length: 0, pending: 0 };
      }
    }),
  );

  const lengthTotal = samples.reduce((total, s) => total + s.length, 0);
  const pendingTotal = samples.reduce((total, s) => total + s.pending, 0);
  status.recordQueueDepth({
    streams: logins.length,
    pendingTotal,
    lengthTotal,
  });
}

export async function runQueueDepthSamplerLoop(
  redis: QueueDepthRedis,
  registry: AccountRegistry,
  status: WorkerV2Status,
  opts: { intervalMs: number; signal: AbortSignal },
): Promise<void> {
  while (!opts.signal.aborted) {
    await sampleQueueDepthOnce(redis, registry, status);
    await abortableDelay(opts.intervalMs, opts.signal);
  }
}
