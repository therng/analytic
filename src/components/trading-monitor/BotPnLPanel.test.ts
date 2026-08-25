import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BotPnLPanel renders the chart from the server summary, not a mount-time pagination loop", async () => {
  const source = await readFile(
    new URL("./BotPnLPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("getSinceDate"), false);
  assert.match(source, /accountId: string/);
  // The chart/table read summary.botPerformance from a cached history=0
  // request (~KB) — the full-position pagination loop is drill-down only.
  assert.match(source, /summary\.botPerformance/);
  assert.match(source, /history=0/);
  assert.match(source, /MAX_SHEET_FETCH_PAGES/);
  // The sheet's raw-row fetch stays cursor-paginated, page-capped, and runs
  // only when a bot sheet is open.
  assert.match(source, /if \(!selectedBot\) return;/);
  assert.match(source, /new URLSearchParams\(\{[\s\S]*timeframe/);
  assert.match(source, /params\.set\("cursor", cursor\)/);
  assert.match(source, /historyPage\?\.nextCursor/);
  assert.match(source, /do \{[\s\S]*\} while \(cursor && pages < MAX_SHEET_FETCH_PAGES\)/);
  // Client-side re-aggregation of every row is gone.
  assert.equal(source.includes("aggregate(positions)"), false);
  assert.equal(
    source.includes(
      'positions: PositionsResponse["historyPositions"] | null | undefined',
    ),
    false,
  );
});

test("BotPnLPanel locks pull-to-refresh while the trade-history sheet is active", async () => {
  const source = await readFile(
    new URL("./BotPnLPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /lockPullToRefresh|unlockPullToRefresh/);
  assert.match(
    source,
    /if \(!selectedBot\) return;\s*\n\s*lockPullToRefresh\(\);\s*\n\s*return \(\) => unlockPullToRefresh\(\);/,
  );
});

test("BotPnLPanel only renders the Y-axis endpoints", async () => {
  const source = await readFile(
    new URL("./BotPnLPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /yaxis:\s*\{[\s\S]*?tickAmount:\s*1,/);
});
