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

function niceStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const niceFraction =
    fraction <= 1.6 ? 1 : fraction <= 3 ? 2 : fraction <= 7 ? 5 : 10;
  return niceFraction * magnitude;
}

function buildScale(
  values: number[],
  targetIntervals: number,
  minimumMaximum = 0,
): ValueScale {
  const rawMinimum = Math.min(0, ...values);
  const rawMaximum = Math.max(minimumMaximum, ...values);
  const rawRange = Math.max(rawMaximum - rawMinimum, 1);
  const step = niceStep(rawRange / targetIntervals);
  const minimum = Math.floor(rawMinimum / step) * step;
  let maximum = Math.ceil(rawMaximum / step) * step;

  if (maximum === minimum) {
    maximum += step;
  }

  const ticks: number[] = [];
  for (let value = minimum; value <= maximum + step / 2; value += step) {
    ticks.push(Number(value.toFixed(8)));
  }

  return {
    minimum,
    maximum,
    range: maximum - minimum,
    ticks,
  };
}

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

export function buildBalanceDepositLoadChart(
  balance: BalanceEventPoint[],
  depositLoad: ChartPoint[],
  timeframe: Timeframe,
) {
  const normalizedBalance = normalizePoints(balance, balanceValue);
  const normalizedDepositLoad = normalizePoints(depositLoad, (point) =>
    Math.max(0, Number(point.y)),
  );
  const allTimestamps = [
    ...normalizedBalance.map((point) => point.timestamp),
    ...normalizedDepositLoad.map((point) => point.timestamp),
  ];
  const anchorTimestamp =
    normalizedBalance.at(-1)?.timestamp ??
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

  const balanceScale = buildScale(
    normalizedBalance.map((point) => point.value),
    6,
  );
  const depositLoadScale = buildScale(
    normalizedDepositLoad.map((point) => point.value),
    9,
    2,
  );
  const balancePoints = projectPoints(
    normalizedBalance,
    xMinimum,
    xMaximum,
    balanceScale,
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
    balancePoints,
    depositLoadPoints,
    balancePath: linePath(balancePoints),
    depositLoadPath,
    depositLoadAreaPath,
    balanceTicks: balanceScale.ticks.map((value) => ({
      value,
      y: projectTick(value, balanceScale),
    })),
    depositLoadTicks: depositLoadScale.ticks.map((value) => ({
      value,
      y: projectTick(value, depositLoadScale, true),
    })),
  };
}
