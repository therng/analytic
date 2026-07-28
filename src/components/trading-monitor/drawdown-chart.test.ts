import assert from "node:assert/strict";
import test from "node:test";

import type { BalanceEventPoint, ChartPoint } from "@/lib/trading/types";
import {
  DRAWDOWN_CHART_HEIGHT,
  buildDrawdownDepositLoadChart,
  drawdownPctSeries,
  nearestProjectedPointByX,
} from "./drawdown-chart";

function balancePoint(x: string, balance: number): BalanceEventPoint {
  return {
    x,
    y: balance,
    balance,
    eventType: null,
    eventDelta: null,
  };
}

function loadPoint(x: string, y: number): ChartPoint {
  return { x, y };
}

test("projects a growing drawdown downward and deposit load downward on independent axes", () => {
  const chart = buildDrawdownDepositLoadChart(
    [
      balancePoint("2026-04-01T00:00:00.000Z", 6_000),
      balancePoint("2026-04-02T00:00:00.000Z", 3_000),
    ],
    [
      loadPoint("2026-04-01T00:00:00.000Z", 0),
      loadPoint("2026-04-02T00:00:00.000Z", 18),
    ],
    "1w",
  );

  assert.ok(chart.drawdownPoints[1]!.y > chart.drawdownPoints[0]!.y);
  assert.ok(
    chart.depositLoadPoints[1]!.y > chart.depositLoadPoints[0]!.y,
  );
  assert.equal(chart.drawdownPoints[0]!.x, chart.depositLoadPoints[0]!.x);
  assert.equal(chart.drawdownPoints[1]!.x, chart.depositLoadPoints[1]!.x);
  assert.ok(
    chart.drawdownPoints.every(
      (point) => point.y >= 0 && point.y <= DRAWDOWN_CHART_HEIGHT,
    ),
  );
});

test("keeps a real zero deposit load in the projected series", () => {
  const chart = buildDrawdownDepositLoadChart(
    [balancePoint("2026-04-01T00:00:00.000Z", 6_000)],
    [loadPoint("2026-04-01T00:00:00.000Z", 0)],
    "all",
  );

  assert.equal(chart.depositLoadPoints.length, 1);
  assert.equal(chart.depositLoadTicks[0]?.value, 0);
});

test("drawdownPctSeries computes drawdown off the running peak balance", () => {
  const series = drawdownPctSeries([
    balancePoint("2026-04-01T00:00:00.000Z", 1_000),
    balancePoint("2026-04-02T00:00:00.000Z", 1_500),
    balancePoint("2026-04-03T00:00:00.000Z", 1_200),
    balancePoint("2026-04-04T00:00:00.000Z", 1_500),
  ]);

  assert.equal(series[0], 0);
  assert.equal(series[1], 0);
  assert.equal(series[2], 20);
  assert.equal(series[3], 0);
});

test("does not substitute a distant deposit-load sample for missing history", () => {
  const points = [{ x: 280, y: 8, sourceIndex: 0 }];

  assert.equal(nearestProjectedPointByX(points, 30), undefined);
  assert.equal(nearestProjectedPointByX(points, 275), points[0]);
});

test("uses a fixed Bangkok-day time axis for the 1d timeframe", () => {
  const chart = buildDrawdownDepositLoadChart(
    [
      balancePoint("2026-04-01T17:00:00.000Z", 5_000),
      balancePoint("2026-04-02T16:59:59.999Z", 5_100),
    ],
    [],
    "1d",
  );

  assert.ok(chart.drawdownPoints[0]!.x < chart.drawdownPoints[1]!.x);
  assert.equal(chart.drawdownPoints.length, 2);
});
