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

test("six comparison bars stay paired after the leading gauge row", async () => {
  const css = await readFile(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );
  const trailingBarSelector = css.match(
    /\.perf-quality-panel--bars > \.comparison-bar:last-child:nth-child\((odd|even)\)\s*\{\s*grid-column: 1 \/ -1;/,
  );

  assert.notEqual(trailingBarSelector, null);
  const spansFullWidth = (childPosition: number) =>
    trailingBarSelector?.[1] ===
    (childPosition % 2 === 0 ? "even" : "odd");

  assert.equal(spansFullWidth(1 + 6), false);
  assert.equal(spansFullWidth(1 + 5), true);
});

test("moved quality gauges can shrink inside the three-column row", async () => {
  const css = await readFile(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.perf-quality-panel__gauges-row > \.quality-gauge\s*\{\s*min-width: 0;\s*\}/,
  );
});

test("resource wrapper forwards quality metrics from the positions summary", async () => {
  const source = await readFile(
    new URL("./PerformanceBars.tsx", import.meta.url),
    "utf8",
  );
  const resourceImpl = source.slice(
    source.indexOf("function PerformanceBarsResourceImpl"),
    source.indexOf("export const PerformanceBars", source.indexOf("function PerformanceBarsResourceImpl")),
  );

  assert.match(
    resourceImpl,
    /sharpeRatio=\{positionsDetail\.data\?\.summary\.sharpeRatio\}/,
  );
  assert.match(
    resourceImpl,
    /profitFactor=\{positionsDetail\.data\?\.summary\.profitFactor\}/,
  );
  assert.match(
    resourceImpl,
    /recoveryFactor=\{positionsDetail\.data\?\.summary\.recoveryFactor\}/,
  );
});

test("design-sync metadata no longer tracks the deleted quality panel", async () => {
  const [entry, configSource, notes] = await Promise.all([
    readFile(new URL("../../../.design-sync/ds-entry.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../.design-sync/config.json", import.meta.url), "utf8"),
    readFile(new URL("../../../.design-sync/NOTES.md", import.meta.url), "utf8"),
  ]);
  const config = JSON.parse(configSource) as {
    componentSrcMap: Record<string, string>;
  };

  assert.doesNotMatch(entry, /PerformanceQualityPanel/);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      config.componentSrcMap,
      "PerformanceQualityPanel",
    ),
    false,
  );
  assert.equal(
    Object.values(config.componentSrcMap).some((path) =>
      path.includes("PerformanceQualityPanel"),
    ),
    false,
  );
  assert.match(
    entry,
    /from "\.\.\/src\/components\/trading-monitor\/MonitorShared";/,
  );
  for (const component of [
    "TimeframeStrip",
    "InlineState",
    "SparklineChart",
    "TradingMonitorSharedStyles",
  ]) {
    assert.equal(
      config.componentSrcMap[component],
      "src/components/trading-monitor/MonitorShared.tsx",
    );
  }
  assert.match(notes, /All 24 components are pinned in `config\.json`\./);
});

test("tapGauge ownership comment names only current owners", async () => {
  const animations = await readFile(
    new URL("../../lib/animations.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(animations, /PerformanceQualityPanel/);
  assert.match(
    animations,
    /\/\/ Gauge \/ comparison bar tap — PerformanceBars/,
  );
});
