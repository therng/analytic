import { test } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  buildTimeframeViews,
  patchWorkerEquitySource,
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

test(
  "equity patch re-keys the worker session without a source re-transfer",
  { skip: !workerBundleExists },
  async () => {
    const source = buildContractSource();
    await buildTimeframeViews(source, ["1d"], "e2e-patch-v1");

    // Simulate an equity tick: append one snapshot row (new intraday
    // deposit-load high) and re-key the session under a new sourceId.
    const latest = source.equitySnapshots[source.equitySnapshots.length - 1]!;
    const patchedSnapshots = [
      ...source.equitySnapshots,
      {
        ts: new Date(latest.ts.getTime() + 60_000),
        equity: latest.equity + 1.5,
        margin: latest.margin,
        depositLoad: 99,
        maxDepositLoad: null,
      },
    ];

    const patched = await patchWorkerEquitySource(
      "e2e-patch-v1",
      "e2e-patch-v2",
      patchedSnapshots,
    );
    assert.equal(patched, true, "session re-key must be acknowledged");

    // Build under the NEW sourceId with NO source payload — only possible
    // because the patched session (parsed source + precompute) survived.
    const rebuilt = await buildTimeframeViews(
      { ...source, equitySnapshots: patchedSnapshots },
      ["1d"],
      "e2e-patch-v2",
    );
    assert.ok(rebuilt["1d"]);
    assert.equal(
      canonicalJson(rebuilt["1d"]),
      canonicalJson(
        buildTimeframeView({
          ...source,
          equitySnapshots: patchedSnapshots,
          timeframe: "1d",
        }),
      ),
      "patched-session build must match the inline build from the patched source",
    );

    // Missed patch (evicted session) resolves false and the next build falls
    // back to a full source send — never a hard failure.
    const missed = await patchWorkerEquitySource(
      "e2e-patch-never-existed",
      "e2e-patch-v3",
      patchedSnapshots,
    );
    assert.equal(missed, false);
    const fallback = await buildTimeframeViews(
      { ...source, equitySnapshots: patchedSnapshots },
      ["1w"],
      "e2e-patch-v3",
    );
    assert.ok(fallback["1w"], "full-source resend fallback must succeed");
  },
);

// A live Worker keeps the event loop spinning — tear it down so the test
// runner can exit. (Runs even when the test above is skipped.)
test("teardown worker", { skip: !workerBundleExists }, async () => {
  shutdownViewBuildWorker();
});
