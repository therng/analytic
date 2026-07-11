import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pips panel is fixed to all-history, independent of the selected dashboard timeframe", async () => {
  const source = await readFile(new URL("./DashboardCard.tsx", import.meta.url), "utf8");

  assert.match(source, /\/pips\?timeframe=all/);
  assert.equal(
    source.includes("/pips?timeframe=${timeframe}"),
    false,
  );
});

test("trades Activity/Per-week/Holding stats are fixed to all-history, independent of the selected dashboard timeframe", async () => {
  const source = await readFile(new URL("./DashboardCard.tsx", import.meta.url), "utf8");

  assert.match(source, /tradesStatsAll[\s\S]{0,120}timeframe=all/);
});

test("pips heatmap only enables all-history bypass for the all timeframe", async () => {
  const source = await readFile(new URL("./DashboardCard.tsx", import.meta.url), "utf8");

  assert.match(source, /timeframe === "all"/);
  assert.match(source, /timeframe=all/);
  assert.equal(source.includes("scope=allHistory"), false);
  assert.equal(
    source.includes("ignoreDashboardTimeframe=true"),
    false,
  );
});
