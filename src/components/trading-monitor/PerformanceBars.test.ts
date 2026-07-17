import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PerformanceBars owns quality gauges and renders them before comparison bars", async () => {
  const source = await readFile(
    new URL("./PerformanceBars.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /label: "SHARPE"/);
  assert.match(source, /label: "PROFIT F\."/);
  assert.match(source, /label: "RECOVERY"/);

  const gaugesIndex = source.indexOf(
    'className="perf-quality-panel__gauges-row"',
  );
  const barsIndex = source.indexOf("{bars.map((config) => (");
  assert.notEqual(gaugesIndex, -1);
  assert.notEqual(barsIndex, -1);
  assert.ok(gaugesIndex < barsIndex);
});
