// src/worker-v2/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveSyncEnabled } from "./index";

test("isLiveSyncEnabled defaults to true when unset", () => {
  assert.equal(isLiveSyncEnabled({}), true);
});

test("isLiveSyncEnabled supports an explicit rollback switch", () => {
  assert.equal(
    isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "false" }),
    false,
  );
});

test("isLiveSyncEnabled accepts true and rejects invalid values", () => {
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "true" }), true);
  assert.throws(
    () => isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "1" }),
    /must be true or false/,
  );
});
