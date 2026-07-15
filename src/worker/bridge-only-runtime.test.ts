import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("worker runtime is bridge-only with no manual HTML import entrypoint", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const workerSource = readFileSync("src/worker/index.ts", "utf8");

  assert.equal(packageJson.scripts?.["worker:local"], undefined);
  assert.doesNotMatch(
    workerSource,
    /parseReport|LOCAL_REPORT_DIR|WORKER_RUN_ONCE|WORKER_FORCE_REIMPORT/,
  );
});
