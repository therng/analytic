import { test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  buildTimeframeViews,
  shutdownViewBuildWorker,
} from "@/lib/trading/view-build-worker";
import { buildTimeframeView } from "@/lib/trading/preaggregated-cache";
import { buildContractSource, canonicalJson } from "@/lib/trading/view-contract-source";

// End-to-end protocol test against the REAL worker bundle
// (dist/view-build-worker.js). Skipped when the bundle is absent (fresh
// checkout / CI without build:view-worker) — the inline fallback is covered
// by the contract + dedupe tests.
const workerBundleExists = existsSync(
  path.join(process.cwd(), "dist", "view-build-worker.js"),
);

test(
  "worker round-trip returns views identical to the inline build",
  { skip: !workerBundleExists },
  async () => {
    const source = buildContractSource();
    const timeframes = ["1d", "1w", "1m", "all"] as const;

    // First call transfers the source under sourceId "e2e-v1".
    const first = await buildTimeframeViews(
      source,
      [...timeframes],
      "e2e-v1",
    );
    // Second call reuses the worker-cached source (no sourceJson) and adds a
    // timeframe — proves the sourceId session path.
    const second = await buildTimeframeViews(source, ["1d"], "e2e-v1");

    for (const timeframe of timeframes) {
      const inline = buildTimeframeView({ ...source, timeframe });
      const viaWorker = first[timeframe];
      assert.ok(viaWorker, `worker must return a view for ${timeframe}`);
      assert.equal(
        canonicalJson(viaWorker),
        canonicalJson(inline),
        `worker view for ${timeframe} must match the inline build`,
      );
    }
    assert.equal(
      canonicalJson(second["1d"]),
      canonicalJson(first["1d"]),
      "cached-source rebuild must be identical",
    );
  },
);

// A live Worker keeps the event loop spinning — tear it down so the test
// runner can exit. (Runs even when the test above is skipped.)
test("teardown worker", { skip: !workerBundleExists }, async () => {
  shutdownViewBuildWorker();
});
