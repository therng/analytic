import type { NumericLike } from "./deal-kernel";
import { dealNet, isTradingDeal, normalizeTradeSide } from "./deal-kernel";

/**
 * Z-Score runs test (Ralph Vince / MT5 strategy-tester formula), verified
 * against independent public sources — not reconstructed from memory:
 * N = total trades, W = wins, L = losses, R = number of runs (maximal
 * consecutive same-sign streaks), P = 2*W*L.
 * Z = [N*(R-0.5) - P] / sqrt(P*(P-N)/(N-1))
 *
 * MT5 counts a break-even trade (netValue === 0) as a win, unlike Ralph
 * Vince's original method which counts it as a loss — this follows MT5's
 * convention since this app's data is MT5-native.
 */
export function computeZScore(netValues: number[]) {
  const n = netValues.length;
  if (n < 2) return null;

  let wins = 0;
  let losses = 0;
  let runs = 0;
  let previousWasWin: boolean | null = null;
  for (const value of netValues) {
    const isWin = value >= 0;
    if (isWin) wins++;
    else losses++;
    if (previousWasWin === null || isWin !== previousWasWin) runs++;
    previousWasWin = isWin;
  }

  const p = 2 * wins * losses;
  if (p === 0) return null;

  const denominator = Math.sqrt((p * (p - n)) / (n - 1));
  if (!Number.isFinite(denominator) || denominator === 0) return null;

  return (n * (runs - 0.5) - p) / denominator;
}

export function getTradeWinPercent(
  deals: Array<{
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  let trades = 0,
    wins = 0;
  for (const d of deals) {
    if (isTradingDeal(d)) {
      trades++;
      if (dealNet(d) > 0) wins++;
    }
  }
  return trades > 0 ? (wins / trades) * 100 : 0;
}

export function getLongTradeWinPercent(
  deals: Array<{
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  let trades = 0,
    wins = 0;
  for (const d of deals) {
    if (isTradingDeal(d) && normalizeTradeSide(d.type, d.direction) === "buy") {
      trades++;
      if (dealNet(d) > 0) wins++;
    }
  }
  return trades > 0 ? (wins / trades) * 100 : null;
}

export function getShortTradeWinPercent(
  deals: Array<{
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  let trades = 0,
    wins = 0;
  for (const d of deals) {
    if (
      isTradingDeal(d) &&
      normalizeTradeSide(d.type, d.direction) === "sell"
    ) {
      trades++;
      if (dealNet(d) > 0) wins++;
    }
  }
  return trades > 0 ? (wins / trades) * 100 : null;
}
