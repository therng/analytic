import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TradeDistributionPanel renders a three-mode MT5-style distribution chart with complete states", async () => {
  const source = await readFile(
    new URL("./TradeDistributionPanel.tsx", import.meta.url),
    "utf8",
  );

  // Step 1: browser-only chart boundary
  assert.match(
    source,
    /dynamic\(\(\) => import\("react-apexcharts"\), \{ ssr: false \}\)/,
  );

  // Step 2: tab state, three real button tabs, default mode MFE
  assert.match(source, /useState<TradeDistributionMode>\("mfe-profit"\)/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /<button/);
  assert.doesNotMatch(source, /<div[^>]*role="tab"/);
  assert.match(source, /label: "MFE"/);
  assert.match(source, /label: "MAE"/);
  assert.match(source, /label: "TIME"/);

  // Step 3: mixed scatter/line series types (regression/ideal disabled from tooltip)
  assert.match(source, /seriesEntry\.name === "Loss"/);
  assert.match(source, /seriesEntry\.name === "Regression"/);
  assert.match(source, /seriesEntry\.name === "Ideal 45°"/);
  assert.match(source, /"Regression" \|\| seriesEntry\.name === "Ideal 45°"/);
  assert.match(source, /result\.series\.some\(\(entry\) => entry\.name === "Ideal 45°"\)/);

  // Step 4: zero reference annotations
  assert.match(
    source,
    /xaxis:\s*mode === "mae-profit"\s*\?\s*\[\{ x: 0, borderColor: "rgba\(240,242,245,0\.20\)" \}\]\s*:\s*\[\]/,
  );
  assert.match(source, /yaxis: \[\{ y: 0, borderColor: "rgba\(240,242,245,0\.20\)" \}\]/);

  // Step 5: tooltip content
  assert.match(source, /point\.symbol/);
  assert.match(source, /point\.positionId/);
  assert.match(source, /formatSignedCurrency\(point\.netPnl, 2\)/);
  assert.match(source, /formatSignedCurrency\(point\.profit, 2\)/);
  assert.match(source, /formatSignedCurrency\(point\.swap, 2\)/);
  assert.match(source, /formatSignedCurrency\(point\.commission, 2\)/);
  assert.match(source, /formatBangkokDateTime\(point\.openTime\)/);
  assert.match(source, /formatBangkokDateTime\(point\.closeTime\)/);
  assert.match(source, /Net P\/L/);
  assert.match(source, /Swap/);
  assert.match(source, /Commission/);

  // Step 6: visible regression metadata (not hover-only)
  assert.match(source, /Slope \{result\.regression\.slope\.toFixed\(2\)\}/);
  assert.match(source, /R² \{result\.regression\.rSquared\.toFixed\(2\)\}/);
  assert.match(source, /n\{" "\}/);
  assert.match(source, /Ideal slope: 1\.00/);

  // Step 7: mode-specific empty states
  assert.match(source, /MFE unavailable/);
  assert.match(
    source,
    /No fully closed positions with MFE values exist in this timeframe\./,
  );
  assert.match(source, /MAE unavailable/);
  assert.match(
    source,
    /No fully closed positions with MAE values exist in this timeframe\./,
  );
  assert.match(source, /Holding time unavailable/);
  assert.match(
    source,
    /No fully closed positions have valid opening and closing timestamps\./,
  );
  assert.match(source, /skeleton-chart account-card__chart-skeleton/);
  assert.match(source, /tone="error"/);

  // Step 8: truncation disclosure (spans full timeframe, not "latest N")
  assert.match(
    source,
    /Showing \{formatWholeNumber\(detail\.plottedPositions\)\} sampled positions from\{" "\}/,
  );
  assert.match(source, /regression uses all valid positions\./);
  assert.doesNotMatch(source, /latest \{?formatWholeNumber/);

  // Step 9: mobile responsive overrides
  assert.match(source, /breakpoint: 480/);
  assert.match(source, /chart: \{ height: 260 \}/);
  assert.match(source, /markers: \{ size: markerSize\.slice\(0, seriesCount\)\.map\(\(\) => 4\) \}/);
});
