// Regenerates the view-build contract fixture consumed by
// src/lib/trading/view-build-contract.test.ts.
//
// Run: node --import tsx scripts/generate-view-contract-fixture.ts
//
// The fixture pins buildTimeframeView output (all 7 view kinds, canonical
// JSON with sorted keys) for a deterministic synthetic source. Performance
// refactors of the build pipeline must keep this byte-identical.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { buildTimeframeView } from "../src/lib/trading/preaggregated-cache";
import type { Timeframe } from "../src/lib/trading/types";
import { buildContractSource, canonicalJson } from "../src/lib/trading/view-contract-source";

const OUT_PATH = path.join(
  process.cwd(),
  "src/lib/trading/view-build-contract.fixture.json",
);

const TIMEFRAMES: Timeframe[] = ["1d", "1w", "1m", "all"];

function hashOf(view: unknown): string {
  return createHash("sha256").update(canonicalJson(view)).digest("hex");
}

function main() {
  const source = buildContractSource();
  const views: Record<string, unknown> = {};
  for (const timeframe of TIMEFRAMES) {
    views[timeframe] = buildTimeframeView({ ...source, timeframe });
  }

  const payload = {
    note: "Canonical (sorted-key, Date->ISO) buildTimeframeView hashes. See view-contract-source.ts for the generator inputs.",
    viewHashes: Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, hashOf(views[tf])]),
    ),
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 1) + "\n");
  console.log(`wrote ${OUT_PATH}`);
}

main();
