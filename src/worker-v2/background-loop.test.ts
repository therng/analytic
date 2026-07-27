import assert from "node:assert/strict";
import test from "node:test";
import { abortableDelay } from "./background-loop";

test("abortableDelay resolves promptly when shutdown is requested", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const pending = abortableDelay(60_000, controller.signal);
  controller.abort();
  await pending;
  assert.ok(Date.now() - startedAt < 1_000);
});
