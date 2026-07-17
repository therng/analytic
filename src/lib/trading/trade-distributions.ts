/**
 * Linear regression summary from finite points.
 */
export interface LinearRegressionSummary {
  slope: number;
  intercept: number;
  rSquared: number;
  sampleSize: number;
  minX: number;
  maxX: number;
}

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
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumX2 = points.reduce((sum, point) => sum + point.x * point.x, 0);
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
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
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
