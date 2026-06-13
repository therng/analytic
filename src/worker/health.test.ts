import assert from "node:assert/strict";
import test from "node:test";

import { WorkerHeartbeat } from "./health";

const STALE_MS = 1000;

test("reports 'starting' before the first poll, within the startup window", () => {
  const heartbeat = new WorkerHeartbeat(STALE_MS, 0);
  const snapshot = heartbeat.snapshot(500);
  assert.equal(snapshot.status, "starting");
  assert.equal(snapshot.healthy, true);
  assert.equal(snapshot.pollCount, 0);
});

test("goes 'stale' if no poll begins within the startup window", () => {
  const heartbeat = new WorkerHeartbeat(STALE_MS, 0);
  const snapshot = heartbeat.snapshot(STALE_MS + 1);
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.healthy, false);
});

test("a successful poll keeps the worker healthy and clears errors", () => {
  const heartbeat = new WorkerHeartbeat(STALE_MS, 0);
  heartbeat.markPollStart(100);
  heartbeat.markPollSuccess({ found: 2, ready: 2, deferred: 0, imported: 1, skipped: 1, failed: 0 }, 200);

  const snapshot = heartbeat.snapshot(300);
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.healthy, true);
  assert.equal(snapshot.lastPollOk, true);
  assert.equal(snapshot.consecutiveFailures, 0);
  assert.equal(snapshot.lastError, null);
  assert.equal(snapshot.pollCount, 1);
  assert.equal(snapshot.lastStats?.imported, 1);
});

test("an in-flight poll counts as recent activity", () => {
  const heartbeat = new WorkerHeartbeat(STALE_MS, 0);
  heartbeat.markPollSuccess(null, 100);
  // A new poll starts well after the previous one finished; it should still be
  // healthy because the start itself is recent activity.
  heartbeat.markPollStart(5000);
  const snapshot = heartbeat.snapshot(5500);
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.healthy, true);
});

test("failures surface as errors but do not flag the worker unhealthy on their own", () => {
  const heartbeat = new WorkerHeartbeat(STALE_MS, 0);
  heartbeat.markPollStart(100);
  heartbeat.markPollFailure(new Error("FTP unreachable"), 200);

  const snapshot = heartbeat.snapshot(300);
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.healthy, true);
  assert.equal(snapshot.lastPollOk, false);
  assert.equal(snapshot.consecutiveFailures, 1);
  assert.equal(snapshot.lastError, "FTP unreachable");
});

test("the loop going quiet after a poll is detected as stale", () => {
  const heartbeat = new WorkerHeartbeat(STALE_MS, 0);
  heartbeat.markPollStart(100);
  heartbeat.markPollSuccess(null, 200);

  const snapshot = heartbeat.snapshot(200 + STALE_MS + 1);
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.healthy, false);
});
