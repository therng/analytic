import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TradeHistoryPanel does not render MAE/MFE detail rows", async () => {
  const source = await readFile(
    new URL("./TradeHistoryPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /MAE P\/L/);
  assert.doesNotMatch(source, /MFE P\/L/);
  assert.doesNotMatch(source, /position\.mae/);
  assert.doesNotMatch(source, /position\.mfe/);
});

test("expanded trade comments wrap instead of clipping", async () => {
  const css = await readFile(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.trade-history-row__detail--comment\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?\}/,
  );
  assert.match(
    css,
    /\.trade-history-row__val--comment\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?text-overflow:\s*clip;[\s\S]*?\}/,
  );
  assert.doesNotMatch(
    css.match(/\.trade-history-row__val--comment\s*\{[\s\S]*?\}/)?.[0] ?? "",
    /white-space:\s*nowrap|overflow:\s*hidden|text-overflow:\s*ellipsis/,
  );
});

test("TradeHistoryPanel page-1 comes from card-level cached props, not a panel fetch", async () => {
  const source = await readFile(
    new URL("./TradeHistoryPanel.tsx", import.meta.url),
    "utf8",
  );

  // Page-1 payload arrives via props from DashboardCard's useApiResource
  // (LRU-cached, in-flight deduped) — the panel must not fetch it itself.
  assert.match(source, /page:\s*PositionsResponse \| null;/);
  assert.match(source, /page\?\.historyPositions \?\? \[\]/);
  // Only cursor-paged "Load more" requests originate inside the panel.
  const fetchCalls = source.match(/fetch\(/g) ?? [];
  assert.equal(fetchCalls.length, 1);
  assert.match(source, /params\.set\("cursor", nextCursor\)|cursor: nextCursor/);
});

test("TradeHistoryPanel renders skeleton and inline error states for page-1", async () => {
  const source = await readFile(
    new URL("./TradeHistoryPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /aria-busy="true"/);
  assert.match(source, /trade-history-skeleton-row/);
  assert.match(source, /tone="error"/);
});

test("trade history rows are render-windowed via content-visibility", async () => {
  const css = await readFile(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );

  const rowBlock =
    css.match(
      /\.dashboard-section > \.account-card \.trade-history-row\s*\{[\s\S]*?\}/,
    )?.[0] ?? "";
  assert.match(rowBlock, /content-visibility:\s*auto;/);
  assert.match(rowBlock, /contain-intrinsic-size:\s*auto 52px;/);
});

test("DashboardCard caches trades page-1 and prefetches it before first tap", async () => {
  const source = await readFile(
    new URL("./card/DashboardCard.tsx", import.meta.url),
    "utf8",
  );

  // Page-1 flows through useApiResource so repeat taps hit the LRU cache.
  assert.match(
    source,
    /const tradesHistory = useApiResource<PositionsResponse>\(\s*expandedKpi === "trades"\s*\?\s*`\/api\/accounts\/\$\{account\.id\}\/positions\?timeframe=\$\{timeframe\}&limit=\$\{TRADES_HISTORY_PAGE_LIMIT\}`/,
  );
  // Mount-time warm for the default timeframe + lifetime summary chips.
  assert.match(source, /timeframe=1d&limit=\$\{TRADES_HISTORY_PAGE_LIMIT\}/);
  assert.match(source, /timeframe=all&history=0/);
  // Timeframe intent warms the next timeframe's page-1 payload too.
  const intentStart = source.indexOf("const prefetchTimeframe");
  const intentEnd = source.indexOf("},", intentStart);
  const intentBody = source.slice(intentStart, intentEnd);
  assert.match(intentBody, /timeframe=\$\{value\}&limit=\$\{TRADES_HISTORY_PAGE_LIMIT\}/);
  // Panel receives the cached payload as props.
  assert.match(source, /page=\{tradesHistory\.data\}/);
});
