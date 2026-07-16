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
