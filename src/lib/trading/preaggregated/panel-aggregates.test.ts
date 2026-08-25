import { test } from "node:test";
import assert from "node:assert";

import {
  buildBotPerformance,
  buildDailyPnl,
} from "@/lib/trading/preaggregated/panel-aggregates";
import { MANUAL_BOT_LABEL, getBotLabel } from "@/lib/trading/bots";
import type { PositionsResponse } from "@/lib/trading/types";

type HistoryPosition = NonNullable<PositionsResponse["historyPositions"]>[number];

function row(
  overrides: Partial<HistoryPosition>,
): HistoryPosition {
  return {
    positionId: "p-1",
    symbol: "XAUUSD",
    type: "buy",
    volume: 0.5,
    openedAt: null,
    closedAt: null,
    openPrice: null,
    closePrice: null,
    marketPrice: null,
    profit: 0,
    sl: null,
    tp: null,
    swap: 0,
    commission: 0,
    pips: null,
    comment: null,
    exitReason: null,
    slHit: false,
    tpHit: false,
    ...overrides,
  } as HistoryPosition;
}

// Labels come from getBotLabel itself (registry matchers evolve); what this
// module owns is the grouping + aggregation over those labels.
const GRID_LABEL = getBotLabel("EA-Grid Buy");

test("buildBotPerformance groups enriched rows by bot label with the chart's exact net formula", () => {
  const positions = [
    row({ comment: "EA-Grid Buy", profit: 100, swap: -1, commission: -2 }),
    row({ comment: "EA-Grid Sell", profit: 50, swap: 0, commission: 0 }),
    row({ comment: "manual trade", profit: -30, swap: 0, commission: -1 }),
    row({ comment: null, profit: 10, swap: 0, commission: 0 }),
  ];

  const stats = buildBotPerformance(positions);

  // net = profit + swap + commission per row, grouped by getBotLabel(comment)
  assert.notEqual(GRID_LABEL, MANUAL_BOT_LABEL);

  const byLabel = new Map(stats.map((stat) => [stat.label, stat]));
  const grid = byLabel.get(GRID_LABEL);
  assert.ok(grid, "known matcher label grouped");
  if (!grid) return;
  assert.equal(grid.count, 2);
  assert.equal(grid.grossProfit, 97 + 50);
  assert.equal(grid.wins, 2);
  assert.equal(grid.losses, 0);
  assert.equal(Number(grid.netPnl.toFixed(6)), 147);

  // "manual trade" and null land in DIFFERENT buckets (token fallback vs the
  // explicit Manual label) — both aggregate independently.
  const tokenManual = byLabel.get(getBotLabel("manual trade"));
  assert.ok(tokenManual, "token-fallback comments group separately");
  if (tokenManual) {
    assert.equal(tokenManual.count, 1);
    assert.equal(tokenManual.losses, 1);
    assert.equal(tokenManual.grossLoss, -31);
  }
  const nullComment = byLabel.get(MANUAL_BOT_LABEL);
  assert.ok(nullComment, "null comments collapse to the Manual label");
  if (nullComment) {
    assert.equal(nullComment.count, 1);
    assert.equal(nullComment.grossProfit, 10);
  }

  // Sorted by net P/L descending — the chart's bar order.
  assert.deepEqual(
    stats.map((stat) => stat.label),
    [...stats.map((stat) => stat.label)].sort(
      (a, b) =>
        (byLabel.get(b)?.netPnl ?? 0) - (byLabel.get(a)?.netPnl ?? 0),
    ),
  );
});

test("buildDailyPnl aggregates Bangkok-day buckets from closed rows only", () => {
  const positions = [
    // 2026-08-25 18:05Z = 2026-08-26 01:05 Bangkok — buckets to the 26th
    row({ closedAt: new Date("2026-08-25T18:05:00Z"), profit: 40, swap: -2, commission: -3 }),
    // Both mid-day UTC rows stay on the 25th Bangkok
    row({ closedAt: new Date("2026-08-25T10:00:00Z"), profit: -10 }),
    row({ closedAt: new Date("2026-08-25T10:30:00Z"), profit: 5 }),
    row({ closedAt: null, profit: 999 }),
  ];

  const days = buildDailyPnl(positions);
  const byKey = new Map(days.map((day) => [day.dateKey, day]));

  assert.equal(days.length, 2);
  assert.equal(byKey.get("2026-08-25")?.count, 2);
  assert.equal(byKey.get("2026-08-25")?.pnl, -10 + 5);
  assert.equal(byKey.get("2026-08-26")?.pnl, 35);
  assert.equal(byKey.get("2026-08-26")?.count, 1);
});
