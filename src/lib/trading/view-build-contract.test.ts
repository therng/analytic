import { test } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildTimeframeView } from "@/lib/trading/preaggregated-cache";
import type { Timeframe } from "@/lib/trading/types";
import {
  buildContractSource,
  canonicalJson,
} from "@/lib/trading/view-contract-source";

// Contract: buildTimeframeView output must stay byte-stable (canonical form)
// across performance refactors of the build pipeline. If this test fails
// after an intentional behavior change, regenerate the fixture:
//   node --import tsx scripts/generate-view-contract-fixture.ts
// and eyeball the diff — it must contain only the intended change.
const FIXTURE_PATH = path.join(
  process.cwd(),
  "src/lib/trading/view-build-contract.fixture.json",
);

type Fixture = { viewHashes: Record<string, string> };

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
}

function hashOf(view: unknown): string {
  return createHash("sha256").update(canonicalJson(view)).digest("hex");
}

test("buildTimeframeView output is stable against the committed contract fixture", () => {
  const fixture = loadFixture();
  const source = buildContractSource();

  for (const [timeframe, expectedHash] of Object.entries(fixture.viewHashes)) {
    const view = buildTimeframeView({ ...source, timeframe: timeframe as Timeframe });
    assert.equal(
      hashOf(view),
      expectedHash,
      `view for timeframe ${timeframe} diverged from the contract fixture — if intentional, regenerate via scripts/generate-view-contract-fixture.ts`,
    );
  }
});

test("contract source exercises every scoped timeframe window", () => {
  const source = buildContractSource();
  const views = {
    "1d": buildTimeframeView({ ...source, timeframe: "1d" }),
    "1w": buildTimeframeView({ ...source, timeframe: "1w" }),
    "1m": buildTimeframeView({ ...source, timeframe: "1m" }),
    all: buildTimeframeView({ ...source, timeframe: "all" }),
  } as const;

  const tradesIn = (tf: keyof typeof views) =>
    views[tf].positions.summary.totalTrades;

  // Sanity: the fixture's scoped windows actually contain different slices.
  assert.ok(tradesIn("1d") < tradesIn("1w"), "1d must scope tighter than 1w");
  assert.ok(tradesIn("1w") < tradesIn("1m"), "1w must scope tighter than 1m");
  assert.ok(tradesIn("1m") < tradesIn("all"), "1m must scope tighter than all");
  assert.equal(tradesIn("all"), source.positions.length);
});
