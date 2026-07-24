import type { NumericLike } from "./deal-kernel";
import { dealNet, getPositionSortKey, normalizeTradeSide, parseTimestamp } from "./deal-kernel";
import { getPositionCloseTime } from "./position-time";

type PositionMetricRow = {
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
  openTime?: Date | string | null;
  inTime?: Date | string | null;
  positionNo?: string | null;
  positionId?: string | null;
  type?: string | null;
  direction?: string | null;
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
};

export function isClosedPosition(row: {
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
}) {
  return Number.isFinite(parseTimestamp(getPositionCloseTime(row)));
}

export function summarizeClosedPositions(rows: PositionMetricRow[]) {
  const closed = rows
    .map((row) => ({ row, ts: parseTimestamp(getPositionCloseTime(row)) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort(
      (a, b) =>
        a.ts - b.ts ||
        getPositionSortKey(a.row).localeCompare(getPositionSortKey(b.row)),
    );

  let totalNetProfit = 0,
    grossProfit = 0,
    grossLoss = 0;
  let profitCount = 0,
    lossCount = 0;
  let maxProfit = -Infinity,
    maxLoss = Infinity;
  let longTotal = 0,
    longWon = 0,
    shortTotal = 0,
    shortWon = 0;
  let currentWins = 0,
    bestWinStreak = 0,
    currentLosses = 0,
    worstLossStreak = 0;
  const netValues: number[] = [];

  for (const { row } of closed) {
    const profit = dealNet(row);
    if (!Number.isFinite(profit)) continue;

    netValues.push(profit);
    totalNetProfit += profit;

    if (profit > 0) {
      grossProfit += profit;
      profitCount++;
      if (profit > maxProfit) maxProfit = profit;
      currentWins++;
      currentLosses = 0;
      if (currentWins > bestWinStreak) bestWinStreak = currentWins;
    } else if (profit < 0) {
      grossLoss += Math.abs(profit);
      lossCount++;
      if (profit < maxLoss) maxLoss = profit;
      currentLosses++;
      currentWins = 0;
      if (currentLosses > worstLossStreak) worstLossStreak = currentLosses;
    } else {
      currentWins = 0;
      currentLosses = 0;
    }

    const side = normalizeTradeSide(row.type, row.direction ?? row.type);
    if (side === "buy") {
      longTotal++;
      if (profit > 0) longWon++;
    } else if (side === "sell") {
      shortTotal++;
      if (profit > 0) shortWon++;
    }
  }

  const totalTrades = netValues.length;

  return {
    netValues,
    totalTrades,
    totalNetProfit,
    winPercent: totalTrades > 0 ? (profitCount / totalTrades) * 100 : null,
    profitTradesCount: profitCount,
    lossTradesCount: lossCount,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectedPayoff: totalTrades > 0 ? totalNetProfit / totalTrades : null,
    largestProfitTrade: profitCount > 0 ? maxProfit : null,
    largestLossTrade: lossCount > 0 ? maxLoss : null,
    averageProfitTrade: profitCount > 0 ? grossProfit / profitCount : null,
    averageLossTrade: lossCount > 0 ? grossLoss / lossCount : null,
    longTradesTotal: longTotal,
    longTradesWon: longWon,
    shortTradesTotal: shortTotal,
    shortTradesWon: shortWon,
    maximumConsecutiveWins: totalTrades > 0 ? bestWinStreak : null,
    maximumConsecutiveLosses: totalTrades > 0 ? worstLossStreak : null,
  };
}
