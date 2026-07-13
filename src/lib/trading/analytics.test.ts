import assert from "node:assert/strict";
import test from "node:test";

import { buildBalanceCurve, buildDailyProfitSeries, buildUnitDrawdownCurve, computeAbsoluteDrawdown, computeBalanceDrawdown, getAccountStatus, getSinceDate, isTradingDeal, summarizeTrades } from "./analytics";

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

test("computeAbsoluteDrawdown uses MT5 initial deposit minus minimum balance", () => {
  assert.equal(computeAbsoluteDrawdown(12_000, 11_500), 500);
  assert.equal(computeAbsoluteDrawdown(12_000, 12_500), 0);
});

test("computeBalanceDrawdown reports absolute drawdown from the balance curve", () => {
  const deals = [
    { time: new Date("2026-01-01T01:00:00.000Z"), profit: 10_000, swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-01-02T01:00:00.000Z"), profit: -500, swap: 0, commission: 0, type: "sell", comment: null },
    { time: new Date("2026-01-03T01:00:00.000Z"), profit: 2_000, swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-01-04T01:00:00.000Z"), profit: -250, swap: 0, commission: 0, type: "buy", comment: null },
  ] as any[];

  const drawdown = computeBalanceDrawdown(deals);

  assert.equal(drawdown.initialDeposit, 10_000);
  assert.equal(drawdown.minimalBalance, 9_500);
  assert.equal(drawdown.absoluteAmount, 500);
});

test("buildUnitDrawdownCurve includes trade deals with empty-string type and null comment", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end   = new Date("2026-01-31T23:59:59.000Z");

  // A deposit (type="deposit") followed by one trade with type="" and no comment
  const deals = [
    { time: new Date("2026-01-01T01:00:00.000Z"), profit: 10_000, swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-01-10T08:00:00.000Z"), profit: 500,    swap: -2, commission: -3, type: "",        comment: null },
  ] as any[];

  const result = buildUnitDrawdownCurve(deals, start, end);

  // The deposit creates the baseline and the trade at Jan 10 adds net 495
  // to the running balance (10_000 + 495 = 10_495).
  assert.equal(result.length, 2, "deposit baseline and trade deal must appear in balance curve");
  assert.equal(result[0].equity, 10_000);
  assert.equal(result[1].equity, 10_495);
});

test("isTradingDeal follows MT5 symbol plus direction classification", () => {
  assert.equal(isTradingDeal({ type: "", symbol: "EURUSD", direction: "out" }), true);
  assert.equal(isTradingDeal({ type: "balance", symbol: null, direction: null }), false);
});

test("trade summaries include MT5 deals with blank type but symbol and direction", () => {
  const deals = [
    { time: new Date("2026-01-01T01:00:00.000Z"), profit: 10_000, swap: 0, commission: 0, type: "balance", symbol: null, direction: null, comment: "Initial deposit" },
    { time: new Date("2026-01-02T01:00:00.000Z"), profit: 500, swap: -2, commission: -3, type: "", symbol: "EURUSD", direction: "out", comment: null },
  ] as any[];

  const summary = summarizeTrades(deals);

  assert.equal(summary.trades, 1);
  assert.equal(summary.netProfit, 495);
});

test("daily profit series includes MT5 deals with blank type but symbol and direction", () => {
  const deals = [
    { time: new Date("2026-01-02T01:00:00.000Z"), profit: 500, swap: -2, commission: -3, type: "", symbol: "EURUSD", direction: "out", comment: null },
    { time: new Date("2026-01-02T02:00:00.000Z"), profit: 1_000, swap: 0, commission: 0, type: "balance", symbol: null, direction: null, comment: "Deposit" },
  ] as any[];

  const result = buildDailyProfitSeries(deals, 1, new Date("2026-01-02T12:00:00.000Z"));

  assert.equal(result[0].profit, 495);
});

test("buildBalanceCurve reconstructs points from deltas when bridge deals have no balance", () => {
  const deals = [
    { time: new Date("2026-01-01T01:00:00.000Z"), profit: 10_000, swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-01-02T01:00:00.000Z"), profit: 500, swap: -2, commission: -3, type: "buy", comment: null },
    { time: new Date("2026-01-03T01:00:00.000Z"), profit: -100, swap: 0, commission: -1, type: "sell", comment: null },
  ] as any[];

  const result = buildBalanceCurve(deals);

  assert.equal(result.length, 3);
  assert.equal(result[0].balance, 10_000);
  assert.equal(result[1].balance, 10_495);
  assert.equal(result[2].balance, 10_394);
});
