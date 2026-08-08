// src/worker-v2/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveSyncEnabled, waitForSchemaReady } from "./index";

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

function missingTableError(): Error & { code: string } {
  const error = new Error(
    "The table `public.Account` does not exist in the current database.",
  ) as Error & { code: string };
  error.code = "P2021";
  return error;
}

// Regression test for the boot-race fix: waitForSchemaReady must retry the
// *whole* startup thunk — provisionAccounts() followed by
// loadAccountRegistry() — not just the first call in it. Before the fix,
// only ensureBridgeAccounts() was wrapped and the very next unguarded
// loadAccountRegistry() call could hit the same P2021 race and crash the
// process (this is exactly what the container logs showed:
// "at loadAccountRegistry ... at async main").
test("waitForSchemaReady retries a P2021 raised by the second step of the thunk (registry load), not just the first", async () => {
  let attempts = 0;
  const result = await waitForSchemaReady(async () => {
    attempts += 1;
    // Simulate provisionAccounts() succeeding immediately (first call in the
    // thunk) while the very next statement — the registry load — is what
    // hits the table-not-ready race on the first couple of attempts.
    if (attempts < 3) throw missingTableError();
    return "registry-loaded";
  });
  assert.equal(result, "registry-loaded");
  assert.equal(attempts, 3);
});

test("waitForSchemaReady rethrows non-P2021 errors immediately without retrying", async () => {
  let attempts = 0;
  await assert.rejects(
    waitForSchemaReady(async () => {
      attempts += 1;
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(attempts, 1);
});
