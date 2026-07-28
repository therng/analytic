import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBalanceCurve,
  buildDailyProfitSeries,
  buildUnitDrawdownCurve,
  computeAbsoluteDrawdown,
  computeAHPR,
  computeAlgoTradingByComment,
  computeAverageStreaks,
  computeBalanceDrawdown,
  computeConsecutiveRunAmounts,
  computeGHPR,
  computeYearGrowth,
  computeHoldingPeriodReturns,
  computeZScore,
  getAccountStatus,
  getSinceDate,
  isTradingDeal,
  summarizeHoldingTime,
  summarizeTrades,
} from "./analytics";

test("getAccountStatus marks fresh snapshots (within 7 min) active", () => {
  const now = new Date("2026-04-15T18:00:00.000Z");
  const freshSnapshot = new Date(now.getTime() - 5 * 60_000); // 5 minutes ago (one MT5 cycle)

  const originalNow = Date.now;
  Date.now = () => now.getTime();

  try {
    assert.equal(getAccountStatus(freshSnapshot), "Active");
  } finally {
    Date.now = originalNow;
  }
});

test("getAccountStatus marks stale snapshots (over 7 min) inactive", () => {
  const now = new Date("2026-04-15T18:00:00.000Z");
  const staleSnapshot = new Date(now.getTime() - 10 * 60_000); // 10 minutes ago (missed two cycles)

  const originalNow = Date.now;
  Date.now = () => now.getTime();

  try {
    assert.equal(getAccountStatus(staleSnapshot), "Inactive");
  } finally {
    Date.now = originalNow;
  }
});

test("getSinceDate uses real-UTC Bangkok midnight boundaries for 1d", () => {
  // 2026-04-15T05:00:00Z is 2026-04-15 12:00 Bangkok (UTC+7); Bangkok
  // midnight for that day is 2026-04-14T17:00:00Z (real UTC, no table-time
  // indirection — Deal/Position timestamps are true UTC after the
  // broker-timezone refactor).
  const reportTime = new Date("2026-04-15T05:00:00.000Z");
  const since = getSinceDate("1d", reportTime);

  assert.ok(since instanceof Date);
  assert.equal(since?.toISOString(), "2026-04-14T17:00:00.000Z");
});

test("computeYearGrowth uses Bangkok year boundaries, independent of host timezone", () => {
  const growth = computeYearGrowth(
    [
      {
        time: new Date("2025-12-31T16:00:00.000Z"),
        type: "deposit",
        profit: 1000,
        balanceAfter: 1000,
      },
      {
        // 2026-01-01 07:30 Bangkok: inside the Bangkok 2026 year.
        time: new Date("2026-01-01T00:30:00.000Z"),
        type: "buy",
        profit: 10,
        balanceAfter: 1010,
      },
    ],
    2026,
  );

  assert.ok(Math.abs(growth - 1) < 1e-9);
});

test("computeAbsoluteDrawdown uses MT5 initial deposit minus minimum balance", () => {
  assert.equal(computeAbsoluteDrawdown(12_000, 11_500), 500);
  assert.equal(computeAbsoluteDrawdown(12_000, 12_500), 0);
});

test("computeBalanceDrawdown reports absolute drawdown from the balance curve", () => {
  const deals = [
    {
      time: new Date("2026-01-01T01:00:00.000Z"),
      profit: 10_000,
      swap: 0,
      commission: 0,
      type: "deposit",
      comment: null,
    },
    {
      time: new Date("2026-01-02T01:00:00.000Z"),
      profit: -500,
      swap: 0,
      commission: 0,
      type: "sell",
      comment: null,
    },
    {
      time: new Date("2026-01-03T01:00:00.000Z"),
      profit: 2_000,
      swap: 0,
      commission: 0,
      type: "deposit",
      comment: null,
    },
    {
      time: new Date("2026-01-04T01:00:00.000Z"),
      profit: -250,
      swap: 0,
      commission: 0,
      type: "buy",
      comment: null,
    },
  ] as any[];

  const drawdown = computeBalanceDrawdown(deals);

  assert.equal(drawdown.initialDeposit, 10_000);
  assert.equal(drawdown.minimalBalance, 9_500);
  assert.equal(drawdown.absoluteAmount, 500);
});

test("buildUnitDrawdownCurve includes trade deals with empty-string type and null comment", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-01-31T23:59:59.000Z");

  // A deposit (type="deposit") followed by one trade with type="" and no comment
  const deals = [
    {
      time: new Date("2026-01-01T01:00:00.000Z"),
      profit: 10_000,
      swap: 0,
      commission: 0,
      type: "deposit",
      comment: null,
    },
    {
      time: new Date("2026-01-10T08:00:00.000Z"),
      profit: 500,
      swap: -2,
      commission: -3,
      type: "",
      comment: null,
    },
  ] as any[];

  const result = buildUnitDrawdownCurve(deals, start, end);

  // The deposit creates the baseline and the trade at Jan 10 adds net 495
  // to the running balance (10_000 + 495 = 10_495).
  assert.equal(
    result.length,
    2,
    "deposit baseline and trade deal must appear in balance curve",
  );
  assert.equal(result[0].equity, 10_000);
  assert.equal(result[1].equity, 10_495);
});

test("isTradingDeal follows MT5 symbol plus direction classification", () => {
  assert.equal(
    isTradingDeal({ type: "", symbol: "EURUSD", direction: "out" }),
    true,
  );
  assert.equal(
    isTradingDeal({ type: "balance", symbol: null, direction: null }),
    false,
  );
});

test("trade summaries include MT5 deals with blank type but symbol and direction", () => {
  const deals = [
    {
      time: new Date("2026-01-01T01:00:00.000Z"),
      profit: 10_000,
      swap: 0,
      commission: 0,
      type: "balance",
      symbol: null,
      direction: null,
      comment: "Initial deposit",
    },
    {
      time: new Date("2026-01-02T01:00:00.000Z"),
      profit: 500,
      swap: -2,
      commission: -3,
      type: "",
      symbol: "EURUSD",
      direction: "out",
      comment: null,
    },
  ] as any[];

  const summary = summarizeTrades(deals);

  assert.equal(summary.trades, 1);
  assert.equal(summary.netProfit, 495);
});

test("daily profit series includes MT5 deals with blank type but symbol and direction", () => {
  const deals = [
    {
      time: new Date("2026-01-02T01:00:00.000Z"),
      profit: 500,
      swap: -2,
      commission: -3,
      type: "",
      symbol: "EURUSD",
      direction: "out",
      comment: null,
    },
    {
      time: new Date("2026-01-02T02:00:00.000Z"),
      profit: 1_000,
      swap: 0,
      commission: 0,
      type: "balance",
      symbol: null,
      direction: null,
      comment: "Deposit",
    },
  ] as any[];

  const result = buildDailyProfitSeries(
    deals,
    1,
    new Date("2026-01-02T12:00:00.000Z"),
  );

  assert.equal(result[0].profit, 495);
});

test("buildBalanceCurve reconstructs points from deltas when bridge deals have no balance", () => {
  const deals = [
    {
      time: new Date("2026-01-01T01:00:00.000Z"),
      profit: 10_000,
      swap: 0,
      commission: 0,
      type: "deposit",
      comment: null,
    },
    {
      time: new Date("2026-01-02T01:00:00.000Z"),
      profit: 500,
      swap: -2,
      commission: -3,
      type: "buy",
      comment: null,
    },
    {
      time: new Date("2026-01-03T01:00:00.000Z"),
      profit: -100,
      swap: 0,
      commission: -1,
      type: "sell",
      comment: null,
    },
  ] as any[];

  const result = buildBalanceCurve(deals);

  assert.equal(result.length, 3);
  assert.equal(result[0].balance, 10_000);
  assert.equal(result[1].balance, 10_495);
  assert.equal(result[2].balance, 10_394);
});

test("buildBalanceCurve seeds baseline from deals before `since` when the deposit falls outside a scoped window", () => {
  const deals = [
    {
      time: new Date("2026-01-01T01:00:00.000Z"), // opening deposit, outside window
      profit: 10_000,
      swap: 0,
      commission: 0,
      type: "deposit",
      comment: null,
    },
    {
      time: new Date("2026-01-02T01:00:00.000Z"), // outside window
      profit: 500,
      swap: 0,
      commission: 0,
      type: "buy",
      comment: null,
    },
    {
      time: new Date("2026-01-10T01:00:00.000Z"), // inside a 1-week window
      profit: -100,
      swap: 0,
      commission: 0,
      type: "sell",
      comment: null,
    },
  ] as any[];

  const since = new Date("2026-01-09T00:00:00.000Z");
  const result = buildBalanceCurve(deals, since);

  assert.equal(result.length, 1);
  assert.equal(result[0].balance, 10_400);
});

test("computeZScore matches the Ralph Vince/MT5 runs-test formula on a known sequence", () => {
  // W=3, L=2, N=5, runs=3 (W,W,L,L,W) -> P=12, Z = (5*2.5-12)/sqrt(12*7/4)
  const z = computeZScore([10, 20, -5, -3, 15]);
  assert.ok(z !== null);
  assert.ok(Math.abs(z! - 0.10910894511799618) < 1e-9);
});

test("computeZScore counts a break-even trade (0) as a win, per MT5 convention", () => {
  // W=3 (incl. the 0), L=2, N=5, runs=3 (W,W,L,L,W) -- same as above with the
  // first win replaced by a break-even.
  const z = computeZScore([0, 20, -5, -3, 15]);
  assert.ok(z !== null);
  assert.ok(Math.abs(z! - 0.10910894511799618) < 1e-9);
});

test("computeZScore returns null when all trades are wins or all are losses", () => {
  assert.equal(computeZScore([5, 10, 15]), null);
  assert.equal(computeZScore([-5, -10, -15]), null);
});

test("computeZScore returns null with fewer than 2 trades", () => {
  assert.equal(computeZScore([]), null);
  assert.equal(computeZScore([10]), null);
});

test("summarizeHoldingTime computes min/max/avg in seconds, skipping invalid rows", () => {
  const summary = summarizeHoldingTime([
    { openTime: "2026-01-01T00:00:00.000Z", closeTime: "2026-01-01T01:00:00.000Z" },
    { openTime: "2026-01-01T00:00:00.000Z", closeTime: "2026-01-01T00:10:00.000Z" },
    { openTime: null, closeTime: "2026-01-01T00:05:00.000Z" },
  ]);
  assert.equal(summary.minHoldingSeconds, 600);
  assert.equal(summary.maxHoldingSeconds, 3600);
  assert.equal(summary.avgHoldingSeconds, 2100);
});

test("summarizeHoldingTime returns nulls when no row has valid open/close times", () => {
  const summary = summarizeHoldingTime([{ openTime: null, closeTime: null }]);
  assert.equal(summary.minHoldingSeconds, null);
  assert.equal(summary.maxHoldingSeconds, null);
  assert.equal(summary.avgHoldingSeconds, null);
});

test("computeHoldingPeriodReturns extracts per-trade % returns, excluding balance operations", () => {
  const points = [
    { balance: 10_000, eventDelta: 10_000, eventType: "deposit" },
    { balance: 10_500, eventDelta: 500, eventType: "buy" },
    { balance: 10_395, eventDelta: -105, eventType: "sell" },
  ];
  const returns = computeHoldingPeriodReturns(points);
  assert.deepEqual(returns, [0.05, -0.01]);
  assert.equal(computeAHPR(returns), 2);
  const expectedGhpr = (Math.sqrt(1.05 * 0.99) - 1) * 100;
  assert.ok(Math.abs(computeGHPR(returns)! - expectedGhpr) < 1e-9);
});

test("computeAHPR and computeGHPR return null for an empty returns array", () => {
  assert.equal(computeAHPR([]), null);
  assert.equal(computeGHPR([]), null);
});

test("computeAlgoTradingByComment groups algo positions and excludes manual or empty comments", () => {
  const result = computeAlgoTradingByComment([
    { comment: "EA-Grid-v3", profit: 100, commission: -2, swap: -1 },
    { comment: "EA-Grid-v3", profit: -30, commission: -2, swap: 0 },
    { comment: "EA-Scalper", profit: 50, commission: -1, swap: 0 },
    { comment: "manual", profit: 20, commission: -1, swap: 0 },
    { comment: "", profit: 5, commission: 0, swap: 0 },
  ]);

  assert.deepEqual(result, [
    {
      comment: "EA-Grid-v3",
      count: 2,
      winRate: 50,
      netProfit: 65,
      percentOfTotal: (2 / 3) * 100,
    },
    {
      comment: "EA-Scalper",
      count: 1,
      winRate: 100,
      netProfit: 49,
      percentOfTotal: (1 / 3) * 100,
    },
  ]);
  assert.deepEqual(computeAlgoTradingByComment([]), []);
});

test("computeConsecutiveRunAmounts selects the max-amount streak, not the longest-length streak", () => {
  const values = [
    // Streak A: 5 wins, $10 each = $50 total, length 5 (longest by count)
    10, 10, 10, 10, 10,
    // loss breaks the streak
    -5,
    // Streak B: 2 wins, $100 each = $200 total, length 2 (largest by amount)
    100, 100,
  ];
  const result = computeConsecutiveRunAmounts(values);
  // Amount-based selection must pick streak B ($200), not streak A ($50),
  // even though streak A is longer in trade count.
  assert.equal(result.maxConsecutiveProfitAmount, 200);
});

test("computeConsecutiveRunAmounts reports the trade count of the max-amount streak, not the longest-length streak", () => {
  const values = [
    // Streak A: 5 wins, $10 each = $50 total, length 5 (longest by count)
    10, 10, 10, 10, 10,
    // loss breaks the streak
    -5,
    // Streak B: 2 wins, $100 each = $200 total, length 2 (largest by amount)
    100, 100,
  ];
  const result = computeConsecutiveRunAmounts(values);
  // Trade count must pair with the max-amount streak (B, length 2), not the
  // longest-length streak (A, length 5) — a different, already-covered stat.
  assert.equal(result.maxConsecutiveProfitAmount, 200);
  assert.equal(result.maxConsecutiveProfitTrades, 2);
});

test("computeConsecutiveRunAmounts reports the trade count of the max-amount loss streak, not the longest-length streak", () => {
  const values = [
    // Streak A: 5 losses, $10 each = $50 total, length 5 (longest by count)
    -10, -10, -10, -10, -10,
    // win breaks the streak
    5,
    // Streak B: 2 losses, $100 each = $200 total, length 2 (largest by amount)
    -100, -100,
  ];
  const result = computeConsecutiveRunAmounts(values);
  assert.equal(result.maxConsecutiveLossAmount, 200);
  assert.equal(result.maxConsecutiveLossTrades, 2);
});

test("computeAverageStreaks averages the length of every win/loss streak, not just the extremal one", () => {
  const values = [
    // win streak of length 5
    10, 10, 10, 10, 10,
    // loss streak of length 1
    -5,
    // win streak of length 2
    100, 100,
    // loss streak of length 3
    -20, -20, -20,
  ];
  const result = computeAverageStreaks(values);
  assert.equal(result.averageWins, (5 + 2) / 2);
  assert.equal(result.averageLosses, (1 + 3) / 2);
});

test("computeAverageStreaks returns null averages when there are no wins or no losses", () => {
  const result = computeAverageStreaks([10, 10, 10]);
  assert.equal(result.averageWins, 3);
  assert.equal(result.averageLosses, null);
});
