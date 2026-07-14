import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveSyncEnabled } from "./index.ts";

test("isLiveSyncEnabled defaults to false when unset", () => {
  assert.equal(isLiveSyncEnabled({}), false);
});

test("isLiveSyncEnabled is false for any value other than the literal string 'true'", () => {
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "1" }), false);
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "TRUE" }), false);
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "" }), false);
});

test("isLiveSyncEnabled is true only for the literal string 'true'", () => {
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "true" }), true);
});
