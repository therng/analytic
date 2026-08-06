// src/worker-v2/queue-depth-sampler.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  queueDepthSampleIntervalMs,
  sampleQueueDepthOnce,
} from "./queue-depth-sampler";
import { WorkerV2Status } from "./health";

function fakeRegistry(logins: string[]): { keys(): string[] } {
  return { keys: () => logins };
}

test("queueDepthSampleIntervalMs defaults to 30s", () => {
  assert.equal(queueDepthSampleIntervalMs({}), 30_000);
});

test("queueDepthSampleIntervalMs rejects non-positive values", () => {
  assert.throws(() =>
    queueDepthSampleIntervalMs({ WORKER_V2_QUEUE_DEPTH_SAMPLE_MS: "0" }),
  );
});

test("sampleQueueDepthOnce sums length/pending across accounts", async () => {
  const status = new WorkerV2Status();
  const calls: string[] = [];
  const redis = {
    xLen: async (key: string) => {
      calls.push(`xLen:${key}`);
      return key.includes("1001") ? 10 : 4;
    },
    xPending: async (key: string) => {
      calls.push(`xPending:${key}`);
      return key.includes("1001") ? { pending: 2 } : { pending: 0 };
    },
  };
  await sampleQueueDepthOnce(
    redis,
    fakeRegistry(["1001", "1002"]) as never,
    status,
  );
  const snap = status.snapshot();
  assert.equal(snap.queue.streams, 2);
  assert.equal(snap.queue.lengthTotal, 14);
  assert.equal(snap.queue.pendingTotal, 2);
  assert.ok(snap.queue.sampledAt);
});

test("sampleQueueDepthOnce treats NOGROUP xPending rejection as zero pending", async () => {
  const status = new WorkerV2Status();
  const redis = {
    xLen: async () => 3,
    xPending: async () => {
      throw new Error("NOGROUP No such key or consumer group");
    },
  };
  await sampleQueueDepthOnce(redis, fakeRegistry(["1001"]) as never, status);
  const snap = status.snapshot();
  assert.equal(snap.queue.lengthTotal, 3);
  assert.equal(snap.queue.pendingTotal, 0);
});
