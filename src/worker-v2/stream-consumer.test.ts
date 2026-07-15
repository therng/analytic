import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureConsumerGroup,
  consumeOnce,
  reclaimPending,
  runConsumerLoop,
  WORKER_V2_GROUP,
} from "./stream-consumer";

function fakeRedis(overrides: Partial<any> = {}) {
  return {
    xGroupCreate: async () => {},
    xReadGroup: async () => null,
    xAck: async () => 1,
    xPendingRange: async () => [],
    xClaim: async () => [],
    ...overrides,
  };
}

test("ensureConsumerGroup swallows BUSYGROUP error", async () => {
  const redis = fakeRedis({
    xGroupCreate: async () => {
      throw new Error("BUSYGROUP Consumer Group name already exists");
    },
  });
  await assert.doesNotReject(() => ensureConsumerGroup(redis, "stream-key"));
});

test("ensureConsumerGroup rethrows non-BUSYGROUP errors", async () => {
  const redis = fakeRedis({
    xGroupCreate: async () => {
      throw new Error("connection refused");
    },
  });
  await assert.rejects(() => ensureConsumerGroup(redis, "stream-key"));
});

test("consumeOnce acks entries the handler resolves to ack, leaves failed infra entries pending", async () => {
  const acked: string[] = [];
  const redis = fakeRedis({
    xReadGroup: async () => [
      {
        name: "stream-key",
        messages: [
          { id: "1-0", message: { data: "{}" } },
          { id: "2-0", message: { data: "{}" } },
        ],
      },
    ],
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      return 1;
    },
  });
  const count = await consumeOnce(
    redis,
    "stream-key",
    "consumer-1",
    50,
    100,
    async (entry) => (entry.id === "1-0" ? "ack" : "leave-pending"),
  );
  assert.equal(count, 2);
  assert.deepEqual(acked, ["1-0"]);
});

test("consumeOnce returns 0 when xReadGroup times out (null)", async () => {
  const redis = fakeRedis({ xReadGroup: async () => null });
  const count = await consumeOnce(
    redis,
    "stream-key",
    "consumer-1",
    50,
    100,
    async () => "ack",
  );
  assert.equal(count, 0);
});

test("reclaimPending claims entries idle past threshold and re-dispatches through handler", async () => {
  const claimed: string[] = [];
  const acked: string[] = [];
  const redis = fakeRedis({
    xPendingRange: async () => [
      { id: "3-0", millisecondsSinceLastDelivery: 120_000 },
    ],
    xClaim: async (
      _key: string,
      _group: string,
      _consumer: string,
      _idle: number,
      ids: string[],
    ) => {
      claimed.push(...ids);
      return [{ id: "3-0", message: { data: "{}" } }];
    },
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      return 1;
    },
  });
  await reclaimPending(
    redis,
    "stream-key",
    "consumer-1",
    60_000,
    async () => "ack",
  );
  assert.deepEqual(claimed, ["3-0"]);
  assert.deepEqual(acked, ["3-0"]);
});

test("runConsumerLoop reclaims a pending entry mid-run, not only at startup", async () => {
  // Entry is NOT idle past threshold on the loop's first iteration, but IS
  // by the third — proving reclaim runs per-iteration, not just once before
  // the loop starts (a crashed consumer's orphaned entry must be picked up
  // once it ages past idleReclaimMs, without a process restart).
  const acked: string[] = [];
  let reclaimCalls = 0;
  const controller = new AbortController();
  const redis = fakeRedis({
    xReadGroup: async () => null,
    xPendingRange: async () => {
      reclaimCalls += 1;
      const idleMs = reclaimCalls < 3 ? 100 : 120_000;
      return [{ id: "orphan-1", millisecondsSinceLastDelivery: idleMs }];
    },
    xClaim: async (
      _key: string,
      _group: string,
      _consumer: string,
      _idle: number,
      ids: string[],
    ) => ids.map((id) => ({ id, message: { data: "{}" } })),
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      controller.abort();
      return 1;
    },
  });
  await runConsumerLoop(redis, "stream-key", "consumer-1", async () => "ack", {
    batchSize: 50,
    blockMs: 1,
    idleReclaimMs: 60_000,
    signal: controller.signal,
  });
  assert.ok(
    reclaimCalls >= 3,
    `expected at least 3 reclaim passes before the entry aged in, got ${reclaimCalls}`,
  );
  assert.deepEqual(acked, ["orphan-1"]);
});

test("WORKER_V2_GROUP is a stable name", () => {
  assert.equal(WORKER_V2_GROUP, "worker-v2");
});

test("reclaimPending paginates past 100 pending entries in one pass", async () => {
  const total = 150;
  const pending = Array.from({ length: total }, (_, i) => ({
    id: `${i + 1}-0`,
    millisecondsSinceLastDelivery: 999_999,
  }));
  const seenRanges: string[] = [];
  const compareStreamIds = (a: string, b: string) => {
    const [aMs, aSeq] = a.split("-").map(Number);
    const [bMs, bSeq] = b.split("-").map(Number);
    return aMs !== bMs ? aMs - bMs : aSeq - bSeq;
  };
  const redis = {
    // Mimics real XPENDING range semantics: returns entries with id >= start,
    // not an exact-id lookup (the cursor after a page is an id that need not
    // literally exist in the pending set).
    xPendingRange: async (
      _key: string,
      _group: string,
      start: string,
      end: string,
      count: number,
    ) => {
      seenRanges.push(start);
      const startIdx =
        start === "-"
          ? 0
          : pending.findIndex((p) => compareStreamIds(p.id, start) >= 0);
      if (startIdx === -1) return [];
      return pending.slice(startIdx, startIdx + count);
    },
    xClaim: async (
      _key: string,
      _group: string,
      _consumer: string,
      _idle: number,
      ids: string[],
    ) => ids.map((id) => ({ id })),
    xAck: async () => 1,
  };
  const claimedIds: string[] = [];
  await reclaimPending(
    redis,
    "stream-key",
    "consumer-1",
    1000,
    async (entry) => {
      claimedIds.push(entry.id);
      return "ack";
    },
  );
  assert.equal(claimedIds.length, total);
  assert.equal(seenRanges.length, 2); // page 1: ids 1..100, page 2: ids 101..150 (exclusive cursor after id 100)
});

test("reclaimPending continues past a pending entry that stays pending, so later entries still process", async () => {
  const pending = [
    { id: "1-0", millisecondsSinceLastDelivery: 999_999 },
    { id: "2-0", millisecondsSinceLastDelivery: 999_999 },
  ];
  const redis = {
    xPendingRange: async () => pending,
    xClaim: async (
      _k: string,
      _g: string,
      _c: string,
      _i: number,
      ids: string[],
    ) => ids.map((id) => (id === "1-0" ? null : { id })), // entry "1-0" fails to claim (still owned elsewhere)
    xAck: async () => 1,
  };
  const processed: string[] = [];
  await reclaimPending(
    redis,
    "stream-key",
    "consumer-1",
    1000,
    async (entry) => {
      processed.push(entry.id);
      return "ack";
    },
  );
  assert.deepEqual(processed, ["2-0"]);
});
