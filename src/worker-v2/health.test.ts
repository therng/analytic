// src/worker-v2/health.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerV2Status } from "./health";

test("WorkerV2Status tracks per-stream processed/failed counts", () => {
  const status = new WorkerV2Status();
  status.recordDealProcessed("1001", "1-0");
  status.recordDealProcessed("1001", "2-0");
  status.recordFailure("deal", "1001", "bad ticket");
  const snap = status.snapshot();
  assert.equal(snap.streams.deals.processed, 2);
  assert.equal(snap.streams.deals.failed, 1);
});

test("WorkerV2Status tracks per-account last-processed markers", () => {
  const status = new WorkerV2Status();
  status.recordDealProcessed("1001", "5-0");
  status.recordOrderProcessed("1001", "9-0");
  status.recordLiveSync("1001");
  status.recordPositionSync("1001", 12);
  const snap = status.snapshot();
  assert.equal(snap.accounts["1001"].lastDeal, "5-0");
  assert.equal(snap.accounts["1001"].lastOrder, "9-0");
  assert.ok(snap.accounts["1001"].lastLiveSync);
  assert.equal(snap.accounts["1001"].openPositionCount, 12);
});

test("snapshot never contains credential-shaped keys", () => {
  const status = new WorkerV2Status();
  status.recordDealProcessed("1001", "1-0");
  const json = JSON.stringify(status.snapshot()).toLowerCase();
  assert.equal(json.includes("password"), false);
  assert.equal(json.includes("redis_url"), false);
  assert.equal(json.includes("database_url"), false);
});

test("queue depth starts null and updates after a sample", () => {
  const status = new WorkerV2Status();
  assert.deepEqual(status.snapshot().queue, {
    streams: 0,
    pendingTotal: 0,
    lengthTotal: 0,
    sampledAt: null,
  });
  status.recordQueueDepth({ streams: 5, pendingTotal: 3, lengthTotal: 120 });
  const snap = status.snapshot();
  assert.equal(snap.queue.streams, 5);
  assert.equal(snap.queue.pendingTotal, 3);
  assert.equal(snap.queue.lengthTotal, 120);
  assert.ok(snap.queue.sampledAt);
});

test("required components become stale without a successful cycle", () => {
  const status = new WorkerV2Status(1_000);
  status.configureComponent("equity", true, 60_000);
  assert.equal(status.snapshot(30_000).status, "starting");
  assert.equal(status.snapshot(62_000).status, "stale");
  assert.equal(status.snapshot(62_000).healthy, false);
});

test("failed cycles do not conceal a stale required component", () => {
  const status = new WorkerV2Status(1_000);
  status.configureComponent("deals", true, 10_000);
  status.recordComponentCycle("deals", undefined, 2_000);
  status.recordComponentCycle("deals", new Error("redis down"), 11_000);

  const snapshot = status.snapshot(13_000);
  assert.equal(snapshot.components.deals.status, "stale");
  assert.equal(snapshot.components.deals.consecutiveFailures, 1);
  assert.equal(snapshot.components.deals.lastError, "redis down");
});
