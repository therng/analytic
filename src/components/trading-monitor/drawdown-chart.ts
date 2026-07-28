import type {
  BalanceEventPoint,
  ChartPoint,
  Timeframe,
} from "@/lib/trading/types";
import {
  endOfBangkokDayTimestamp,
  startOfBangkokDayTimestamp,
  toTimestamp,
} from "@/lib/time";
import { isTradingDeal } from "@/lib/trading/analytics";

export const DRAWDOWN_CHART_WIDTH = 320;
export const DRAWDOWN_CHART_HEIGHT = 142;

const PLOT_LEFT = 30;
const PLOT_RIGHT = 30;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 18;

interface ValueScale {
  minimum: number;
  maximum: number;
  range: number;
  ticks: number[];
}

export interface ProjectedChartPoint {
  x: number;
  y: number;
  sourceIndex: number;
}

export function nearestProjectedPointByX<T extends { x: number }>(
  points: T[],
  targetX: number,
  maximumDistance = 12,
) {
  let nearest: T | undefined;
  let nearestDistance = Infinity;

  points.forEach((point) => {
    const distance = Math.abs(point.x - targetX);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });

  return nearestDistance <= maximumDistance ? nearest : undefined;
}

interface NormalizedPoint {
  timestamp: number;
  value: number;
  sourceIndex: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function balanceValue(point: BalanceEventPoint) {
  return Number.isFinite(point.balance) ? point.balance : Number(point.y);
}

function normalizePoints<T extends ChartPoint>(
  points: T[],
  resolveValue: (point: T) => number,
) {
  return points.flatMap((point, sourceIndex) => {
    const timestamp = toTimestamp(point.x);
    const value = resolveValue(point);
    return timestamp !== null && Number.isFinite(value)
      ? [{ timestamp, value, sourceIndex }]
      : [];
  });
}

// drawdownPct(i) = (runningMax(0..i) - balance(i)) / runningMax(0..i) * 100
export function drawdownPctSeries(balance: BalanceEventPoint[]) {
  let cumulativeFunding = 0;
  let seedDepositConsumed = balance[0]?.eventType === "baseline";
  let runningMax = -Infinity;
  return balance.map((point) => {
    const delta = point.eventDelta;
    if (
      delta != null &&
      delta !== 0 &&
      !isTradingDeal(point.eventType)
    ) {
      if (!seedDepositConsumed && delta > 0) {
        seedDepositConsumed = true;
      } else {
        cumulativeFunding += delta;
      }
    }

    const value = balanceValue(point) - cumulativeFunding;
    runningMax = Math.max(runningMax, value);
    return runningMax > 0 ? ((runningMax - value) / runningMax) * 100 : 0;
  });
}

function normalizeDrawdownPoints(balance: BalanceEventPoint[]) {
  const drawdownPct = drawdownPctSeries(balance);
  return balance.flatMap((point, sourceIndex) => {
    const timestamp = toTimestamp(point.x);
    const value = drawdownPct[sourceIndex]!;
    return timestamp !== null && Number.isFinite(value)
      ? [{ timestamp, value, sourceIndex }]
      : [];
  });
}

// Both series are percentages plotted on a shared fixed 0-100 scale so the
// two axes stay visually comparable; values beyond 100 clamp at the top.
const PERCENT_SCALE: ValueScale = {
  minimum: 0,
  maximum: 100,
  range: 100,
  ticks: [0, 50, 100],
};

function linePath(points: ProjectedChartPoint[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function projectPoints(
  points: NormalizedPoint[],
  xMinimum: number,
  xMaximum: number,
  scale: ValueScale,
  invertY = false,
) {
  const plotWidth = DRAWDOWN_CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = DRAWDOWN_CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const xRange = Math.max(xMaximum - xMinimum, 1);

  return points
    .filter(
      (point) => point.timestamp >= xMinimum && point.timestamp <= xMaximum,
    )
    .map((point) => {
      const xFraction = (point.timestamp - xMinimum) / xRange;
      const valueFraction = clamp(
        (point.value - scale.minimum) / scale.range,
        0,
        1,
      );
      const yFraction = invertY ? valueFraction : 1 - valueFraction;

      return {
        x: Number((PLOT_LEFT + xFraction * plotWidth).toFixed(2)),
        y: Number((PLOT_TOP + yFraction * plotHeight).toFixed(2)),
        sourceIndex: point.sourceIndex,
      };
    });
}

function projectTick(value: number, scale: ValueScale, invertY = false) {
  const plotHeight = DRAWDOWN_CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
  const valueFraction = clamp(
    (value - scale.minimum) / scale.range,
    0,
    1,
  );
  const yFraction = invertY ? valueFraction : 1 - valueFraction;
  return Number((PLOT_TOP + yFraction * plotHeight).toFixed(2));
}

export function buildDrawdownDepositLoadChart(
  balance: BalanceEventPoint[],
  depositLoad: ChartPoint[],
  timeframe: Timeframe,
) {
  const normalizedDrawdown = normalizeDrawdownPoints(balance);
  const normalizedDepositLoad = normalizePoints(depositLoad, (point) =>
    Math.max(0, Number(point.y)),
  );
  const allTimestamps = [
    ...normalizedDrawdown.map((point) => point.timestamp),
    ...normalizedDepositLoad.map((point) => point.timestamp),
  ];
  const anchorTimestamp =
    normalizedDrawdown.at(-1)?.timestamp ??
    normalizedDepositLoad.at(-1)?.timestamp ??
    Date.now();

  let xMinimum: number;
  let xMaximum: number;
  if (timeframe === "1d") {
    xMinimum =
      startOfBangkokDayTimestamp(anchorTimestamp) ?? anchorTimestamp;
    xMaximum =
      endOfBangkokDayTimestamp(anchorTimestamp) ??
      xMinimum + 24 * 60 * 60 * 1000 - 1;
  } else {
    xMinimum = Math.min(...allTimestamps, anchorTimestamp);
    xMaximum = Math.max(...allTimestamps, anchorTimestamp);
    if (xMinimum === xMaximum) {
      xMaximum += 1;
    }
  }

  const drawdownScale = PERCENT_SCALE;
  const depositLoadScale = PERCENT_SCALE;
  const drawdownPoints = projectPoints(
    normalizedDrawdown,
    xMinimum,
    xMaximum,
    drawdownScale,
    true,
  );
  const depositLoadPoints = projectPoints(
    normalizedDepositLoad,
    xMinimum,
    xMaximum,
    depositLoadScale,
    true,
  );
  const depositLoadPath = linePath(depositLoadPoints);
  const depositLoadAreaPath = depositLoadPoints.length
    ? `M ${depositLoadPoints[0]!.x} ${PLOT_TOP} ${depositLoadPath.replace(/^M /, "L ")} L ${depositLoadPoints.at(-1)!.x} ${PLOT_TOP} Z`
    : "";

  return {
    drawdownPoints,
    depositLoadPoints,
    drawdownPath: linePath(drawdownPoints),
    depositLoadPath,
    depositLoadAreaPath,
    drawdownTicks: drawdownScale.ticks.map((value) => ({
      value,
      y: projectTick(value, drawdownScale, true),
    })),
    depositLoadTicks: depositLoadScale.ticks.map((value) => ({
      value,
      y: projectTick(value, depositLoadScale, true),
    })),
  };
}
