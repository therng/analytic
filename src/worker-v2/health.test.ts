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
