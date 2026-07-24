export function computeSharpeRatio(values: number[]) {
  if (values.length < 2) return null;
  const average =
    values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  const deviation = Math.sqrt(variance);
  if (!Number.isFinite(deviation) || deviation === 0) return null;
  return average / deviation;
}

// Per-trade Sharpe scaled to an annualized number so gauge benchmarks (1/2/3/4)
// remain meaningful regardless of how often the strategy trades. Falls back to
// the per-trade value when the time span cannot be derived.
export function computeAnnualizedSharpeRatio(
  values: number[],
  tradesPerYear: number | null,
) {
  const sharpe = computeSharpeRatio(values);
  if (sharpe === null) return null;
  if (
    !Number.isFinite(tradesPerYear ?? Number.NaN) ||
    (tradesPerYear ?? 0) <= 0
  )
    return sharpe;
  return sharpe * Math.sqrt(tradesPerYear as number);
}
