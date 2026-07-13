import { hostname } from "node:os";

export const WORKER_V2_GROUP = "worker-v2";

export type StreamEntry = { id: string; message: Record<string, string> };
export type EntryOutcome = "ack" | "leave-pending";
export type EntryHandler = (entry: StreamEntry) => Promise<EntryOutcome>;

export function buildConsumerName(): string {
  return `worker-v2-${process.pid}-${hostname()}`;
}

export async function ensureConsumerGroup(redis: any, streamKey: string): Promise<void> {
  try {
    await redis.xGroupCreate(streamKey, WORKER_V2_GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
  }
}

export async function consumeOnce(
  redis: any,
  streamKey: string,
  consumerName: string,
  batchSize: number,
  blockMs: number,
  handler: EntryHandler,
): Promise<number> {
  const response = await redis.xReadGroup(
    WORKER_V2_GROUP,
    consumerName,
    [{ key: streamKey, id: ">" }],
    { COUNT: batchSize, BLOCK: blockMs },
  );
  if (!response) return 0;
  let count = 0;
  for (const stream of response) {
    for (const entry of stream.messages) {
      count += 1;
      const outcome = await handler(entry);
      if (outcome === "ack") {
        await redis.xAck(streamKey, WORKER_V2_GROUP, entry.id);
      }
    }
  }
  return count;
}

export async function reclaimPending(
  redis: any,
  streamKey: string,
  consumerName: string,
  idleMs: number,
  handler: EntryHandler,
): Promise<void> {
  const pending = await redis.xPendingRange(streamKey, WORKER_V2_GROUP, "-", "+", 100);
  for (const entry of pending) {
    if (entry.millisecondsSinceLastDelivery < idleMs) continue;
    const claimed = await redis.xClaim(streamKey, WORKER_V2_GROUP, consumerName, idleMs, [entry.id]);
    for (const claimedEntry of claimed) {
      const outcome = await handler(claimedEntry);
      if (outcome === "ack") {
        await redis.xAck(streamKey, WORKER_V2_GROUP, claimedEntry.id);
      }
    }
  }
}

export async function runConsumerLoop(
  redis: any,
  streamKey: string,
  consumerName: string,
  handler: EntryHandler,
  opts: { batchSize: number; blockMs: number; idleReclaimMs: number; signal: AbortSignal },
): Promise<void> {
  await ensureConsumerGroup(redis, streamKey);
  await reclaimPending(redis, streamKey, consumerName, opts.idleReclaimMs, handler);

  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 30_000;
  while (!opts.signal.aborted) {
    try {
      await consumeOnce(redis, streamKey, consumerName, opts.batchSize, opts.blockMs, handler);
      backoffMs = 1000;
    } catch (error) {
      console.error(`[worker-v2] stream loop error on ${streamKey}:`, error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}
