import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureConsumerGroup, consumeOnce, reclaimPending, WORKER_V2_GROUP } from "./stream-consumer.ts";

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
  const count = await consumeOnce(redis, "stream-key", "consumer-1", 50, 100, async (entry) =>
    entry.id === "1-0" ? "ack" : "leave-pending",
  );
  assert.equal(count, 2);
  assert.deepEqual(acked, ["1-0"]);
});

test("consumeOnce returns 0 when xReadGroup times out (null)", async () => {
  const redis = fakeRedis({ xReadGroup: async () => null });
  const count = await consumeOnce(redis, "stream-key", "consumer-1", 50, 100, async () => "ack");
  assert.equal(count, 0);
});

test("reclaimPending claims entries idle past threshold and re-dispatches through handler", async () => {
  const claimed: string[] = [];
  const acked: string[] = [];
  const redis = fakeRedis({
    xPendingRange: async () => [{ id: "3-0", millisecondsSinceLastDelivery: 120_000 }],
    xClaim: async (_key: string, _group: string, _consumer: string, _idle: number, ids: string[]) => {
      claimed.push(...ids);
      return [{ id: "3-0", message: { data: "{}" } }];
    },
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      return 1;
    },
  });
  await reclaimPending(redis, "stream-key", "consumer-1", 60_000, async () => "ack");
  assert.deepEqual(claimed, ["3-0"]);
  assert.deepEqual(acked, ["3-0"]);
});

test("WORKER_V2_GROUP is a stable name", () => {
  assert.equal(WORKER_V2_GROUP, "worker-v2");
});
