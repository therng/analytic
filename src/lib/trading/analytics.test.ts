import assert from "node:assert/strict";
import test from "node:test";

import { buildFundingTotals, buildUnitDrawdownCurve, computeAbsoluteDrawdown, filterBySince, getAccountStatus, getSinceDate } from "./analytics";

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

test("getSinceDate uses Thai day boundaries translated into table time for 1d", () => {
  const reportTime = new Date("2026-04-15T05:00:00.000Z");
  const since = getSinceDate("1d", reportTime);

  assert.ok(since instanceof Date);
  assert.equal(since?.toISOString(), "2026-04-14T20:00:00.000Z");
});

test("computeAbsoluteDrawdown uses withdrawals plus balance minus deposits", () => {
  assert.equal(computeAbsoluteDrawdown(1_500, 9_000, 12_000), -1_500);
  assert.equal(computeAbsoluteDrawdown(12_500, 9_000, 12_000), 9_500);
});

test("computeAbsoluteDrawdown uses all-time funding totals (not period-scoped)", () => {
  // Two deposits and one withdrawal spread across two months.
  const deals = [
    { time: new Date("2026-01-05T00:00:00.000Z"), profit: 10_000, swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-02-10T00:00:00.000Z"), profit: 5_000,  swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-02-20T00:00:00.000Z"), profit: -2_000, swap: 0, commission: 0, type: "withdrawal", comment: null },
  ] as any[];

  // ABS must use all-time funding; balance is always the current all-time snapshot.
  const allTimeFunding = buildFundingTotals(deals);
  assert.equal(allTimeFunding.totalDeposit, 15_000);
  assert.equal(allTimeFunding.totalWithdraw, 2_000);
  // balance=14k → 2k + 14k - 15k = 1k (above net funding by 1k — account is profitable)
  assert.equal(computeAbsoluteDrawdown(allTimeFunding.totalWithdraw, 14_000, allTimeFunding.totalDeposit), 1_000);

  // Using period-scoped funding would give a wrong result: 2k + 14k - 5k = 11k
  // (positive despite the account having older deposits not counted), so preaggregated-cache
  // always passes buildFundingTotals(deals) — not scopedDeals — to computeAbsoluteDrawdown.
  const febFunding = buildFundingTotals(filterBySince(deals, (deal: any) => deal.time, new Date("2026-02-01T00:00:00.000Z")));
  assert.equal(computeAbsoluteDrawdown(febFunding.totalWithdraw, 14_000, febFunding.totalDeposit), 11_000);
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

  // The trade at Jan 10 adds net 495 to the running balance (10_000 + 495 = 10_495)
  // Without the fix, result is empty (trade excluded)
  // With the fix, result has one entry for the trade
  assert.equal(result.length, 1, "trade deal must appear in balance curve");
  assert.equal(result[0].equity, 10_495);
});
