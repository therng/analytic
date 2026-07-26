import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BotPnLPanel fetches every page for the selected timeframe", async () => {
  const source = await readFile(
    new URL("./BotPnLPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes("getSinceDate"), false);
  assert.match(source, /accountId: string/);
  assert.match(source, /new URLSearchParams\(\{[\s\S]*timeframe/);
  assert.match(source, /params\.set\("cursor", cursor\)/);
  assert.match(source, /historyPage\?\.nextCursor/);
  assert.match(source, /do \{[\s\S]*\} while \(cursor\)/);
  assert.match(source, /aggregate\(positions\)/);
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

  assert.match(source, /yaxis:\\s*\\{\\s*\\n\\s*tickAmount: 1,/);
});
