import { hostname } from "node:os";

export const WORKER_V2_GROUP = "worker-v2";

export type StreamEntry = { id: string; message: Record<string, string> };
export type EntryOutcome = "ack" | "leave-pending";
export type EntryHandler = (entry: StreamEntry) => Promise<EntryOutcome>;

export function buildConsumerName(): string {
  return `worker-v2-${process.pid}-${hostname()}`;
}

export async function ensureConsumerGroup(
  redis: any,
  streamKey: string,
): Promise<void> {
  try {
    await redis.xGroupCreate(streamKey, WORKER_V2_GROUP, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP"))
      throw error;
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

const RECLAIM_PAGE_SIZE = 100;
const RECLAIM_MAX_PAGES = 10;

export async function reclaimPending(
  redis: any,
  streamKey: string,
  consumerName: string,
  idleMs: number,
  handler: EntryHandler,
): Promise<void> {
  let cursor = "-";
  for (let page = 0; page < RECLAIM_MAX_PAGES; page += 1) {
    const pending = await redis.xPendingRange(
      streamKey,
      WORKER_V2_GROUP,
      cursor,
      "+",
      RECLAIM_PAGE_SIZE,
    );
    if (!pending || pending.length === 0) return;

    for (const entry of pending) {
      if (entry.millisecondsSinceLastDelivery < idleMs) continue;
      const claimed = await redis.xClaim(
        streamKey,
        WORKER_V2_GROUP,
        consumerName,
        idleMs,
        [entry.id],
      );
      for (const claimedEntry of claimed) {
        if (!claimedEntry) continue;
        const outcome = await handler(claimedEntry);
        if (outcome === "ack") {
          await redis.xAck(streamKey, WORKER_V2_GROUP, claimedEntry.id);
        }
      }
    }

    if (pending.length < RECLAIM_PAGE_SIZE) return;
    // Exclusive next-ID cursor: bump the sequence component of the last-seen
    // ID by 1. MT5-style stream IDs are `<ms>-<seq>`; naively appending "-1"
    // to the whole ID string (e.g. "123-4-1") would be malformed and would
    // not advance past ties on the same millisecond.
    const lastId = pending[pending.length - 1].id as string;
    const [ms, seq] = lastId.split("-");
    cursor = `${ms}-${Number(seq) + 1}`;
  }
}

export async function runConsumerLoop(
  redis: any,
  streamKey: string,
  consumerName: string,
  handler: EntryHandler,
  opts: {
    batchSize: number;
    blockMs: number;
    idleReclaimMs: number;
    signal: AbortSignal;
  },
): Promise<void> {
  await ensureConsumerGroup(redis, streamKey);

  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 30_000;
  while (!opts.signal.aborted) {
    try {
      // Reclaim once per iteration (not just at startup) so an entry left
      // pending by a crashed consumer is picked up once it ages past
      // idleReclaimMs, without requiring a restart to notice it.
      await reclaimPending(
        redis,
        streamKey,
        consumerName,
        opts.idleReclaimMs,
        handler,
      );
      await consumeOnce(
        redis,
        streamKey,
        consumerName,
        opts.batchSize,
        opts.blockMs,
        handler,
      );
      backoffMs = 1000;
    } catch (error) {
      console.error(
        `[worker-v2] stream loop error on ${streamKey}:`,
        error instanceof Error ? error.message : error,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}
