import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the 1D equity series uses the shared purple equity token", async () => {
  const [css, designTokens] = await Promise.all([
    readFile(new URL("../../../app/globals.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../../../design-system/trading-monitor/MASTER.md",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(designTokens, /`--equity`\s+\|\s+`#8b7cf6`/);
  assert.match(css, /--equity:\s*#8b7cf6;/);
  assert.match(
    css,
    /\.sparkline-equity-line\s*\{[^}]*stroke:\s*var\(--equity\)/s,
  );
  assert.match(
    css,
    /\.sparkline-equity-live-dot\s*\{[^}]*fill:\s*var\(--equity\)/s,
  );
});

test("pips panel is fixed to all-history, independent of the selected dashboard timeframe", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\/pips\?timeframe=all/);
  assert.equal(source.includes("/pips?timeframe=${timeframe}"), false);
});

test("KPI value normalization preserves zero metrics", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /function kpiValue\([\s\S]*?return value \?\? null;/,
  );
  assert.equal(source.includes("return value ? value : null;"), false);
});

test("open positions KPI renders zero as empty without changing other KPI zero handling", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /value: formatCompactCount\(openCount \|\| null\)/);
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

test("DD selector cycles 5 sub-panels", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const DD_SUB_CYCLE = \["dd", "abs", "max", "win", "expect"\] as const/,
  );
  assert.match(source, /"dd" \| "abs" \| "max" \| "win" \| "expect"/);
  assert.equal(source.includes('"maeMfe"'), false);
});

test("MAX shows maximum balance drawdown amount without requesting the position summary", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /expandedKpi === "dd" && !\["abs", "max"\]\.includes\(ddSubPanel\)/,
  );
  assert.match(
    source,
    /ddSubPanel === "max" && \(\s*<TradeDistributionPanel balanceDetail=\{balanceDetail\} \/>/,
  );
  assert.match(
    source,
    /maxBalanceDrawdownMetric[\s\S]{0,120}max-balance-drawdown/,
  );
  assert.match(
    source,
    /label=\{maxBalanceDrawdownMetric\.label\}[\s\S]{0,260}summary\.maximalDrawdownAmount/,
  );
  assert.equal(source.includes('getDashboardMetric("mae-mfe")'), false);
  assert.equal(source.includes("MaeMfePanel"), false);
});

test("DD quality gauges are routed into DD WIN PerformanceBars", async () => {
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
  assert.match(
    compactPanel,
    /<PerformanceBars[\s\S]*sharpeRatio=\{positionsDetail\.data\?\.summary\.sharpeRatio\}[\s\S]*profitFactor=\{positionsDetail\.data\?\.summary\.profitFactor\}[\s\S]*recoveryFactor=\{positionsDetail\.data\?\.summary\.recoveryFactor\}/,
  );
});
