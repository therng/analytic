import { test } from "node:test";
import assert from "node:assert";
import {
  computeLinearRegression,
  computeHoldingSeconds,
  sampleEvenly,
  buildTradeDistributionDetail,
} from "./trade-distributions";

test("computeLinearRegression returns an exact least-squares fit", () => {
  assert.deepEqual(
    computeLinearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]),
    {
      slope: 2,
      intercept: 1,
      rSquared: 1,
      sampleSize: 3,
      minX: 0,
      maxX: 2,
    },
  );
});

test("computeLinearRegression returns null with fewer than two finite points", () => {
  assert.equal(computeLinearRegression([{ x: 1, y: 2 }]), null);
});

test("computeLinearRegression returns null when x has zero variance", () => {
  assert.equal(
    computeLinearRegression([
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ]),
    null,
  );
});

test("computeHoldingSeconds uses complete position lifetime", () => {
  assert.equal(
    computeHoldingSeconds(
      new Date("2026-07-17T00:00:00.000Z"),
      new Date("2026-07-17T01:30:00.000Z"),
    ),
    5400,
  );
});

test("computeHoldingSeconds rejects missing, invalid, and reversed timestamps", () => {
  assert.equal(computeHoldingSeconds(null, new Date()), null);
  assert.equal(computeHoldingSeconds(new Date(), null), null);
  assert.equal(
    computeHoldingSeconds(
      new Date("2026-07-17T02:00:00.000Z"),
      new Date("2026-07-17T01:00:00.000Z"),
    ),
    null,
  );
});

test("sampleEvenly returns all items when count is within limit", () => {
  const items = [1, 2, 3, 4, 5];
  const sampled = sampleEvenly(items, 10);
  assert.deepEqual(sampled, items);
});

test("sampleEvenly includes first and last items", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const sampled = sampleEvenly(items, 10);
  assert.equal(sampled[0], items[0]);
  assert.equal(sampled[sampled.length - 1], items[items.length - 1]);
});

test("sampleEvenly is deterministic", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const sample1 = sampleEvenly(items, 10);
  const sample2 = sampleEvenly(items, 10);
  assert.deepEqual(sample1, sample2);
});

test("sampleEvenly handles limit of 1", () => {
  const items = [1, 2, 3, 4, 5];
  const sampled = sampleEvenly(items, 1);
  assert.equal(sampled.length, 1);
  assert.equal(sampled[0], items[items.length - 1]);
});

test("sampleEvenly handles empty array", () => {
  const items: number[] = [];
  const sampled = sampleEvenly(items, 10);
  assert.deepEqual(sampled, []);
});

const distributionFixture = [
  {
    positionNo: 5,
    symbol: "EEE",
    openTime: "2026-01-01T00:00:00.000Z",
    closeTime: "2026-01-06T00:00:00.000Z",
    mae: -10,
    mfe: 20,
    profit: 5,
    swap: 1,
    commission: 1,
  },
  {
    positionNo: 1,
    symbol: "AAA",
    openTime: "2026-01-01T00:00:00.000Z",
    closeTime: "2026-01-05T00:00:00.000Z",
    mae: -50,
    mfe: 80,
    profit: 120,
    swap: -5,
    commission: -2,
  },
  {
    positionNo: 3,
    symbol: "CCC",
    openTime: "2026-01-01T00:00:00.000Z",
    closeTime: "2026-01-04T00:00:00.000Z",
    mae: -20,
    mfe: null,
    profit: -10,
    swap: -1,
    commission: -1,
  },
  {
    positionNo: 2,
    symbol: "BBB",
    openTime: "2026-01-01T00:00:00.000Z",
    closeTime: "2026-01-03T00:00:00.000Z",
    mae: null,
    mfe: 40,
    profit: 30,
    swap: 0,
    commission: -1,
  },
  {
    positionNo: 4,
    symbol: "DDD",
    openTime: null,
    closeTime: "2026-01-02T00:00:00.000Z",
    mae: -30,
    mfe: 60,
    profit: 15,
    swap: 0,
    commission: 0,
  },
];

test("buildTradeDistributionDetail returns unavailable for empty input", () => {
  assert.deepEqual(buildTradeDistributionDetail([]), {
    available: false,
    reason: "No fully closed positions in the selected timeframe.",
  });
});

test("buildTradeDistributionDetail computes netPnl, holdingSeconds, sort order, and regression exclusions", () => {
  const detail = buildTradeDistributionDetail(distributionFixture);
  assert.equal(detail.available, true);
  if (!detail.available) return;

  assert.equal(detail.totalPositions, 5);
  assert.equal(detail.plottedPositions, 5);
  assert.equal(detail.truncated, false);

  assert.deepEqual(
    detail.points.map((point) => point.positionId),
    ["4", "2", "3", "1", "5"],
  );

  const p1 = detail.points.find((point) => point.positionId === "1")!;
  assert.equal(p1.netPnl, 113);
  assert.equal(p1.holdingSeconds, 345600);

  const p4 = detail.points.find((point) => point.positionId === "4")!;
  assert.equal(p4.holdingSeconds, null);

  const p2 = detail.points.find((point) => point.positionId === "2")!;
  assert.equal(p2.mae, null);

  const p3 = detail.points.find((point) => point.positionId === "3")!;
  assert.equal(p3.mfe, null);

  assert.equal(detail.regressions.maeProfit?.sampleSize, 4);
  assert.equal(detail.regressions.mfeProfit?.sampleSize, 4);
  assert.equal(detail.regressions.holdingProfit?.sampleSize, 4);
});

test("buildTradeDistributionDetail computes regressions from the full population, not the sampled points", () => {
  const FIXTURE_SIZE = 1200;
  const largeFixture = Array.from({ length: FIXTURE_SIZE }, (_, i) => ({
    positionNo: i + 1,
    symbol: "AAA",
    openTime: "2026-01-01T00:00:00.000Z",
    closeTime: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    mae: -i,
    mfe: i,
    profit: i,
    swap: 0,
    commission: 0,
  }));

  const detail = buildTradeDistributionDetail(largeFixture);
  assert.equal(detail.available, true);
  if (!detail.available) return;

  assert.equal(detail.totalPositions, FIXTURE_SIZE);
  assert.equal(detail.plottedPositions, 1000);
  assert.equal(detail.truncated, true);

  assert.equal(detail.regressions.mfeProfit?.sampleSize, FIXTURE_SIZE);
  assert.equal(detail.regressions.maeProfit?.sampleSize, FIXTURE_SIZE);
  assert.equal(detail.regressions.mfeProfit?.slope, 1);
  assert.equal(detail.regressions.maeProfit?.slope, -1);
});
