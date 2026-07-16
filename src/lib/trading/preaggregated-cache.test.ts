import { test } from "node:test";
import assert from "node:assert";
import {
  buildPipsSummaryRows,
  buildRealtime24HourBalanceCurve,
  parsePositionHistoryPageOptions,
  parseRequestTimeframe,
} from "./preaggregated-cache";
import { type DealRow } from "./preaggregated-cache";

// Helper to create a deal row
const createDeal = (
  time: string,
  balance: number | null,
  net: number,
  type: string = "trade",
): DealRow => ({
  time: new Date(time),
  type,
  profit: net,
  commission: 0,
  swap: 0,
  fee: 0,
  balanceAfter: balance,
});

test("buildRealtime24HourBalanceCurve fallback incremental", () => {
  // reportTime is the "now" anchor — must be after every deal below so the
  // clamp doesn't exclude deals that already happened today.
  const reportTime = new Date("2026-07-08T05:00:00Z");

  // 1. Deal with balanceAfter
  const deals1 = [createDeal("2026-07-08T01:00:00Z", 1050, 50)];
  const curve1 = buildRealtime24HourBalanceCurve(
    deals1,
    reportTime,
    1050,
    1000,
  );
  assert.strictEqual(curve1[1].balance, 1050);

  // 2. Deal without balanceAfter (incremental fallback)
  const deals2 = [
    createDeal("2026-07-08T01:00:00Z", null, 50), // No balanceAfter, should be 1050 (snapshot 1000 + 50)
  ];
  const curve2 = buildRealtime24HourBalanceCurve(
    deals2,
    reportTime,
    1050,
    1000,
  );
  assert.strictEqual(curve2[1].balance, 1050);

  // 3. Mixed deals
  const deals3 = [
    createDeal("2026-07-08T01:00:00Z", null, 50),
    createDeal("2026-07-08T02:00:00Z", 1200, 100), // Snap
  ];
  const curve3 = buildRealtime24HourBalanceCurve(
    deals3,
    reportTime,
    1200,
    1000,
  );
  assert.strictEqual(curve3[1].balance, 1050);
  assert.strictEqual(curve3[2].balance, 1200);
});

test("buildRealtime24HourBalanceCurve commission/swap included, fee excluded", () => {
  // reportTime is the "now" anchor — must be after the deal below.
  const reportTime = new Date("2026-07-08T05:00:00Z");
  const deals = [
    {
      time: new Date("2026-07-08T01:00:00Z"),
      type: "trade",
      profit: 100,
      commission: -10,
      swap: -5,
      fee: -2,
      balanceAfter: null, // should be 1000 + (100 - 10 - 5) = 1085; fee is not part of netPnl
    },
  ];
  const curve = buildRealtime24HourBalanceCurve(
    deals as any,
    reportTime,
    1085,
    1000,
  );
  assert.strictEqual(curve[1].balance, 1085);
});

test("buildRealtime24HourBalanceCurve no deals in 24h", () => {
  const reportTime = new Date("2026-07-08T00:00:00Z");
  const deals: DealRow[] = [];
  const curve = buildRealtime24HourBalanceCurve(deals, reportTime, 1000, 1000);
  assert.strictEqual(curve.length, 2);
  assert.strictEqual(curve[0].balance, 1000);
  assert.strictEqual(curve[1].balance, 1000);
});

test("buildPipsSummaryRows uses calendar-anchored periods and prefers stored position pips", () => {
  const reportTime = new Date("2026-07-15T12:00:00.000Z");
  const positions = [
    { closeTime: new Date("2025-12-21T20:00:00.000Z"), volume: 1, pips: 1000 }, // before this year — excluded from every row
    { closeTime: new Date("2026-04-01T08:00:00.000Z"), volume: 0.5, pips: 40 }, // this year only
    { closeTime: new Date("2026-07-06T08:00:00.000Z"), volume: 0.4, pips: 20 }, // this month only
    { closeTime: new Date("2026-07-12T20:00:00.000Z"), volume: 0.3, pips: 10 }, // this week only
    { closeTime: new Date("2026-07-14T08:00:00.000Z"), volume: 0.2, pips: -2 }, // yesterday
    { closeTime: new Date("2026-07-15T04:00:00.000Z"), volume: 0.1, pips: 5 }, // today
  ];

  const rows = buildPipsSummaryRows([], positions, reportTime);

  assert.deepStrictEqual(
    rows.map((row) => row.label),
    ["เมื่อวาน", "วันนี้", "สัปดาห์นี้", "เดือนนี้", "ปีนี้"],
  );

  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
  assert.strictEqual(byLabel["เมื่อวาน"].pips, -2);
  assert.strictEqual(byLabel["วันนี้"].pips, 5);
  assert.strictEqual(byLabel["สัปดาห์นี้"].pips, 13); // yesterday + today + this-week-only
  assert.strictEqual(byLabel["เดือนนี้"].pips, 33); // + this-month-only
  assert.strictEqual(byLabel["ปีนี้"].pips, 73); // + this-year-only, excludes the pre-year row
  assert.ok(Math.abs(byLabel["ปีนี้"].volume - 1.5) < 0.000001);
});

test("parsePositionHistoryPageOptions normalizes limits and handles explicit all timeframe", () => {
  // 1. Regular limit
  const normalOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=100"),
  );
  assert.strictEqual(normalOpts.limit, 100);

  // 2. Clamped limit (default is max 250)
  const clampedOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=500"),
  );
  assert.strictEqual(clampedOpts.limit, 250);

  // 3. Legacy allHistory scope no longer bypasses the timeframe contract
  const scopeOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=10000&scope=allHistory"),
  );
  assert.strictEqual(scopeOpts.limit, 250);

  // 4. Legacy ignoreDashboardTimeframe no longer bypasses the timeframe contract
  const ignoreOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=50000&ignoreDashboardTimeframe=true"),
  );
  assert.strictEqual(ignoreOpts.limit, 250);

  // 5. timeframe=all bypasses max 250 clamp
  const timeframeOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=99999&timeframe=all"),
  );
  assert.strictEqual(timeframeOpts.limit, 99999);
});

test("parseRequestTimeframe accepts every dashboard timeframe key", () => {
  const keys = ["1d", "1w", "1m", "3m", "6m", "1y", "all"] as const;

  for (const key of keys) {
    assert.strictEqual(parseRequestTimeframe(key), key);
  }

  assert.strictEqual(parseRequestTimeframe(null), "1d");
});

test("position history limits only bypass the clamp for explicit all-history requests", () => {
  const dashboardTimeframes = ["1d", "1w", "1m", "3m", "6m", "1y"] as const;

  for (const timeframe of dashboardTimeframes) {
    const opts = parsePositionHistoryPageOptions(
      new URLSearchParams(`limit=10000&timeframe=${timeframe}`),
    );
    assert.strictEqual(opts.limit, 250);
  }

  const allOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=10000&timeframe=all"),
  );
  assert.strictEqual(allOpts.limit, 10000);

  const legacyIgnoreOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=10000&ignoreDashboardTimeframe=true"),
  );
  assert.strictEqual(legacyIgnoreOpts.limit, 250);

  const legacyScopeOpts = parsePositionHistoryPageOptions(
    new URLSearchParams("limit=10000&scope=allHistory"),
  );
  assert.strictEqual(legacyScopeOpts.limit, 250);
});
