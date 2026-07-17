import { test } from "node:test";
import assert from "node:assert";
import type { TradeDistributionDetail, TradeDistributionPoint } from "@/lib/trading/types";
import {
  buildTradeDistributionSeries,
  buildTradeDistributionDomains,
  regressionLine,
  idealCaptureLine,
  formatHoldingDuration,
  getModeCopy,
} from "./trade-distribution-chart";

function makePoint(overrides: Partial<TradeDistributionPoint>): TradeDistributionPoint {
  return {
    positionId: "1",
    symbol: "EURUSD",
    openTime: "2026-07-01T00:00:00.000Z",
    closeTime: "2026-07-01T01:00:00.000Z",
    holdingSeconds: 0,
    mae: 0,
    mfe: 0,
    profit: 0,
    swap: 0,
    commission: 0,
    netPnl: 0,
    ...overrides,
  };
}

// idx0: win, all fields present
// idx1: loss, mfe null (omitted from mfe-profit mode)
// idx2: loss, mae null + holdingSeconds null (omitted from mae-profit and profit-time modes)
// idx3: win, all fields present
const points: TradeDistributionPoint[] = [
  makePoint({ positionId: "0", mfe: 10, mae: -4, netPnl: 8, holdingSeconds: 100 }),
  makePoint({ positionId: "1", mfe: null, mae: -2, netPnl: -3, holdingSeconds: 200 }),
  makePoint({ positionId: "2", mfe: 5, mae: null, netPnl: -1, holdingSeconds: null }),
  makePoint({ positionId: "3", mfe: 2, mae: -1, netPnl: 6, holdingSeconds: 50 }),
];

const detail: TradeDistributionDetail = {
  available: true,
  totalPositions: 4,
  plottedPositions: 4,
  truncated: false,
  points,
  regressions: {
    mfeProfit: { slope: 2, intercept: 1, rSquared: 1, sampleSize: 4, minX: 0, maxX: 10 },
    maeProfit: null,
    holdingProfit: { slope: 1, intercept: 0, rSquared: 0.5, sampleSize: 3, minX: 50, maxX: 200 },
  },
};

test("buildTradeDistributionSeries: mfe-profit uses mfe as x, omits null-mfe point", () => {
  const result = buildTradeDistributionSeries("mfe-profit", detail);
  assert.equal(result.data.length, 3);
  assert.deepEqual(
    result.data.find((d) => d.pointIndex === 0),
    { x: 10, y: 8, pointIndex: 0 },
  );
  assert.deepEqual(
    result.data.find((d) => d.pointIndex === 3),
    { x: 2, y: 6, pointIndex: 3 },
  );
  assert.equal(result.data.some((d) => d.pointIndex === 1), false);
});

test("buildTradeDistributionSeries: mae-profit uses mae as x, omits null-mae point", () => {
  const result = buildTradeDistributionSeries("mae-profit", detail);
  assert.equal(result.data.length, 3);
  assert.deepEqual(
    result.data.find((d) => d.pointIndex === 0),
    { x: -4, y: 8, pointIndex: 0 },
  );
  assert.deepEqual(
    result.data.find((d) => d.pointIndex === 1),
    { x: -2, y: -3, pointIndex: 1 },
  );
  assert.equal(result.data.some((d) => d.pointIndex === 2), false);
});

test("buildTradeDistributionSeries: profit-time uses holdingSeconds as x, omits null point", () => {
  const result = buildTradeDistributionSeries("profit-time", detail);
  assert.equal(result.data.length, 3);
  assert.deepEqual(
    result.data.find((d) => d.pointIndex === 0),
    { x: 100, y: 8, pointIndex: 0 },
  );
  assert.deepEqual(
    result.data.find((d) => d.pointIndex === 1),
    { x: 200, y: -3, pointIndex: 1 },
  );
  assert.equal(result.data.some((d) => d.pointIndex === 2), false);
});

test("buildTradeDistributionSeries: unavailable detail returns empty result", () => {
  const result = buildTradeDistributionSeries("mfe-profit", {
    available: false,
    reason: "no data",
  });
  assert.deepEqual(result, { hasData: false, data: [], series: [], regression: null });
});

test("buildTradeDistributionSeries: Profit/Loss series split on netPnl sign (mfe-profit)", () => {
  const result = buildTradeDistributionSeries("mfe-profit", detail);
  const profitSeries = result.series.find((s) => s.name === "Profit");
  const lossSeries = result.series.find((s) => s.name === "Loss");
  assert.deepEqual(profitSeries?.data, [
    { x: 10, y: 8 },
    { x: 2, y: 6 },
  ]);
  assert.deepEqual(lossSeries?.data, [{ x: 5, y: -1 }]);
});

test("buildTradeDistributionSeries: Profit/Loss series split on netPnl sign (mae-profit)", () => {
  const result = buildTradeDistributionSeries("mae-profit", detail);
  const profitSeries = result.series.find((s) => s.name === "Profit");
  const lossSeries = result.series.find((s) => s.name === "Loss");
  assert.deepEqual(profitSeries?.data, [
    { x: -4, y: 8 },
    { x: -1, y: 6 },
  ]);
  assert.deepEqual(lossSeries?.data, [{ x: -2, y: -3 }]);
});

test("buildTradeDistributionSeries: Regression series matches regressionLine for mode's regression", () => {
  const mfeResult = buildTradeDistributionSeries("mfe-profit", detail);
  assert.deepEqual(
    mfeResult.series.find((s) => s.name === "Regression")?.data,
    [
      { x: 0, y: 1 },
      { x: 10, y: 21 },
    ],
  );

  const holdingResult = buildTradeDistributionSeries("profit-time", detail);
  assert.deepEqual(
    holdingResult.series.find((s) => s.name === "Regression")?.data,
    [
      { x: 50, y: 50 },
      { x: 200, y: 200 },
    ],
  );

  const maeResult = buildTradeDistributionSeries("mae-profit", detail);
  assert.deepEqual(maeResult.series.find((s) => s.name === "Regression")?.data, []);
});

test("buildTradeDistributionSeries: Ideal 45° series present only for mfe-profit", () => {
  const mfeResult = buildTradeDistributionSeries("mfe-profit", detail);
  const maeResult = buildTradeDistributionSeries("mae-profit", detail);
  const timeResult = buildTradeDistributionSeries("profit-time", detail);

  assert.deepEqual(
    mfeResult.series.find((s) => s.name === "Ideal 45°")?.data,
    [
      { x: 2, y: 2 },
      { x: 10, y: 10 },
    ],
  );
  assert.equal(maeResult.series.find((s) => s.name === "Ideal 45°"), undefined);
  assert.equal(timeResult.series.find((s) => s.name === "Ideal 45°"), undefined);
});

test("regressionLine(null) returns empty array", () => {
  assert.deepEqual(regressionLine(null), []);
});

test("idealCaptureLine returns y=x endpoints", () => {
  assert.deepEqual(idealCaptureLine(2, 10), [
    { x: 2, y: 2 },
    { x: 10, y: 10 },
  ]);
});

test("buildTradeDistributionDomains computes min/max bounds", () => {
  assert.deepEqual(
    buildTradeDistributionDomains("mfe-profit", [
      { x: 1, y: 5 },
      { x: -2, y: 10 },
      { x: 7, y: -3 },
    ]),
    { minX: -2, maxX: 7, minY: -3, maxY: 10 },
  );
});

test("buildTradeDistributionDomains returns zeros for empty input", () => {
  assert.deepEqual(buildTradeDistributionDomains("mfe-profit", []), {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  });
});

test("formatHoldingDuration formats by magnitude", () => {
  assert.equal(formatHoldingDuration(30), "30s");
  assert.equal(formatHoldingDuration(90), "1.5m");
  assert.equal(formatHoldingDuration(600), "10m");
  assert.equal(formatHoldingDuration(5400), "1.5h");
  assert.equal(formatHoldingDuration(90000), "1.0d");
  assert.equal(formatHoldingDuration(-5), "-");
  assert.equal(formatHoldingDuration(NaN), "-");
});

test("getModeCopy returns exact copy per mode", () => {
  assert.deepStrictEqual(getModeCopy("mfe-profit"), {
    title: "MFE–Profit Distribution",
    xAxis: "Maximum Favorable Excursion",
    yAxis: "Net P/L",
    description:
      "Shows how much favorable unrealized profit was available and how much was retained at close.",
  });
  assert.deepStrictEqual(getModeCopy("mae-profit"), {
    title: "MAE–Profit Distribution",
    xAxis: "Maximum Adverse Excursion",
    yAxis: "Net P/L",
    description:
      "Shows the largest unrealized drawdown endured before the final closed result.",
  });
  assert.deepStrictEqual(getModeCopy("profit-time"), {
    title: "Profit–Holding Time Distribution",
    xAxis: "Holding Time",
    yAxis: "Net P/L",
    description:
      "Shows the relationship between full position lifetime and the final closed result.",
  });
});
