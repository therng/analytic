import assert from "node:assert/strict";
import test from "node:test";

import type { BalanceEventPoint, ChartPoint } from "@/lib/trading/types";
import {
  DRAWDOWN_CHART_HEIGHT,
  buildBalanceDepositLoadChart,
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

test("projects balance upward and deposit load downward on independent axes", () => {
  const chart = buildBalanceDepositLoadChart(
    [
      balancePoint("2026-04-01T00:00:00.000Z", 0),
      balancePoint("2026-04-02T00:00:00.000Z", 6_000),
    ],
    [
      loadPoint("2026-04-01T00:00:00.000Z", 0),
      loadPoint("2026-04-02T00:00:00.000Z", 18),
    ],
    "1w",
  );

  assert.ok(chart.balancePoints[1]!.y < chart.balancePoints[0]!.y);
  assert.ok(
    chart.depositLoadPoints[1]!.y > chart.depositLoadPoints[0]!.y,
  );
  assert.equal(chart.balancePoints[0]!.x, chart.depositLoadPoints[0]!.x);
  assert.equal(chart.balancePoints[1]!.x, chart.depositLoadPoints[1]!.x);
  assert.ok(
    chart.balancePoints.every(
      (point) => point.y >= 0 && point.y <= DRAWDOWN_CHART_HEIGHT,
    ),
  );
});

test("keeps a real zero deposit load in the projected series", () => {
  const chart = buildBalanceDepositLoadChart(
    [balancePoint("2026-04-01T00:00:00.000Z", 6_000)],
    [loadPoint("2026-04-01T00:00:00.000Z", 0)],
    "all",
  );

  assert.equal(chart.depositLoadPoints.length, 1);
  assert.equal(chart.depositLoadTicks[0]?.value, 0);
});

test("does not substitute a distant deposit-load sample for missing history", () => {
  const points = [{ x: 280, y: 8, sourceIndex: 0 }];

  assert.equal(nearestProjectedPointByX(points, 30), undefined);
  assert.equal(nearestProjectedPointByX(points, 275), points[0]);
});

test("uses a fixed Bangkok-day time axis for the 1d timeframe", () => {
  const chart = buildBalanceDepositLoadChart(
    [
      balancePoint("2026-04-01T17:00:00.000Z", 5_000),
      balancePoint("2026-04-02T16:59:59.999Z", 5_100),
    ],
    [],
    "1d",
  );

  assert.ok(chart.balancePoints[0]!.x < chart.balancePoints[1]!.x);
  assert.equal(chart.balancePoints.length, 2);
});
