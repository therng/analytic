import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pips panel is fixed to all-history, independent of the selected dashboard timeframe", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\/pips\?timeframe=all/);
  assert.equal(source.includes("/pips?timeframe=${timeframe}"), false);
});

test("trades Activity/Per-week/Holding stats are fixed to all-history, independent of the selected dashboard timeframe", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /tradesStatsAll[\s\S]{0,120}timeframe=all/);
});

test("pips heatmap uses explicit all-history timeframe", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /allPositions[\s\S]{0,180}timeframe=all/);
  assert.equal(source.includes("scope=allHistory"), false);
  assert.equal(source.includes("ignoreDashboardTimeframe=true"), false);
});

test("BotPnLPanel owns selected-timeframe history loading", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<BotPnLPanel\s+accountId=\{account\.id\}\s+timeframe=\{timeframe\}/,
  );
  assert.equal(source.includes("positions={positionsHistory"), false);
});

test("DD selector registers MAE/MFE after EXPECT and toggles it back to DD", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const DD_SUB_CYCLE = \["dd", "abs", "max", "win", "expect", "maeMfe"\] as const/,
  );
  assert.match(
    source,
    /"dd" \| "abs" \| "max" \| "win" \| "expect" \| "maeMfe"/,
  );
  assert.match(
    source,
    /setDdSubPanel\(ddSubPanel === "maeMfe" \? "dd" : "maeMfe"\)/,
  );
});

test("MAE/MFE uses balance detail without requesting the position summary", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /expandedKpi === "dd" && !\["abs", "maeMfe"\]\.includes\(ddSubPanel\)/,
  );
  assert.match(
    source,
    /ddSubPanel === "maeMfe" && \(\s*<MaeMfePanel balanceDetail=\{balanceDetail\} \/>/,
  );
  assert.equal(
    /ddSubPanel === "(?!maeMfe")[^"]+" && \(\s*<MaeMfePanel/.test(source),
    false,
  );
});

test("DD MAX is empty and quality metrics are routed into DD WIN PerformanceBars", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );
  const compactPanelStart = source.indexOf("const compactKpiPanel");
  const compactPanel = source.slice(
    compactPanelStart,
    source.indexOf("return (", compactPanelStart),
  );

  assert.equal(source.includes("PerformanceQualityPanel"), false);
  assert.equal(compactPanel.includes('ddSubPanel === "max"'), false);
  assert.match(
    compactPanel,
    /<PerformanceBars[\s\S]*sharpeRatio=\{positionsDetail\.data\?\.summary\.sharpeRatio\}[\s\S]*profitFactor=\{positionsDetail\.data\?\.summary\.profitFactor\}[\s\S]*recoveryFactor=\{positionsDetail\.data\?\.summary\.recoveryFactor\}/,
  );
});
