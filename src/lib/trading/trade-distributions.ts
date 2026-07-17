import type {
  LinearRegressionSummary,
  TradeDistributionPoint,
  TradeDistributionDetail,
} from "@/lib/trading/types";

/**
 * Computes least-squares linear regression over finite points.
 * Returns null if fewer than 2 finite points or x has zero variance.
 */
export function computeLinearRegression(
  input: Array<{ x: number; y: number }>,
): LinearRegressionSummary | null {
  const points = input.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  if (points.length < 2) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let minX = points[0].x;
  let maxX = points[0].x;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
  }
  const denominator = n * sumX2 - sumX * sumX;

  if (!Number.isFinite(denominator) || Math.abs(denominator) < Number.EPSILON) {
    return null;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const totalVariation = points.reduce(
    (sum, point) => sum + (point.y - meanY) ** 2,
    0,
  );
  const residualVariation = points.reduce((sum, point) => {
    const fitted = slope * point.x + intercept;
    return sum + (point.y - fitted) ** 2;
  }, 0);
  const rSquared =
    totalVariation === 0 ? 1 : 1 - residualVariation / totalVariation;

  return {
    slope,
    intercept,
    rSquared,
    sampleSize: n,
    minX,
    maxX,
  };
}

/**
 * Computes holding duration in seconds from open to close time.
 * Returns null if timestamps are missing, invalid, or reversed.
 */
export function computeHoldingSeconds(
  openTime: Date | string | null | undefined,
  closeTime: Date | string | null | undefined,
): number | null {
  if (!openTime || !closeTime) return null;

  const openedAt = new Date(openTime).getTime();
  const closedAt = new Date(closeTime).getTime();
  const durationMs = closedAt - openedAt;

  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  return durationMs / 1000;
}

/**
 * Returns an evenly spaced deterministic sample from an array.
 * Preserves first and last items. Returns all items if count <= limit.
 */
export function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  if (limit <= 1) return items.length === 0 ? [] : [items[items.length - 1]];

  const sampled: T[] = [];
  const lastIndex = items.length - 1;

  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    sampled.push(items[sourceIndex]);
  }

  return sampled;
}

const MAX_RENDERED_DISTRIBUTION_POINTS = 1000;

export function buildTradeDistributionDetail(
  closedPositions: Array<{
    positionNo?: unknown;
    symbol?: unknown;
    openTime?: string | Date | null;
    closeTime?: string | Date | null;
    mae?: unknown;
    mfe?: unknown;
    profit?: unknown;
    swap?: unknown;
    commission?: unknown;
  }>,
): TradeDistributionDetail {
  if (closedPositions.length === 0) {
    return {
      available: false,
      reason: "No fully closed positions in the selected timeframe.",
    };
  }

  const population: TradeDistributionPoint[] = closedPositions
    .filter((position) => position.closeTime != null)
    .map((position) => {
      const profit = Number(position.profit ?? 0);
      const swap = Number(position.swap ?? 0);
      const commission = Number(position.commission ?? 0);

      return {
        positionId: String(position.positionNo ?? ""),
        symbol: String(position.symbol ?? "UNKNOWN"),
        openTime: position.openTime
          ? new Date(position.openTime).toISOString()
          : "",
        closeTime: new Date(position.closeTime!).toISOString(),
        holdingSeconds: computeHoldingSeconds(
          position.openTime,
          position.closeTime,
        ),
        mae: position.mae == null ? null : Number(position.mae),
        mfe: position.mfe == null ? null : Number(position.mfe),
        profit,
        swap,
        commission,
        netPnl: profit + swap + commission,
      };
    })
    .sort(
      (left, right) =>
        new Date(left.closeTime).getTime() - new Date(right.closeTime).getTime(),
    );

  const regressions = {
    mfeProfit: computeLinearRegression(
      population.flatMap((point) =>
        point.mfe == null ? [] : [{ x: point.mfe, y: point.netPnl }],
      ),
    ),
    maeProfit: computeLinearRegression(
      population.flatMap((point) =>
        point.mae == null ? [] : [{ x: point.mae, y: point.netPnl }],
      ),
    ),
    holdingProfit: computeLinearRegression(
      population.flatMap((point) =>
        point.holdingSeconds == null
          ? []
          : [{ x: point.holdingSeconds, y: point.netPnl }],
      ),
    ),
  };

  const plotted = sampleEvenly(population, MAX_RENDERED_DISTRIBUTION_POINTS);

  return {
    available: true,
    totalPositions: population.length,
    plottedPositions: plotted.length,
    truncated: plotted.length < population.length,
    points: plotted,
    regressions,
  };
}
