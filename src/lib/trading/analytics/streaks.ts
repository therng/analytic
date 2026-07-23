export function computeConsecutiveRunAmounts(values: number[]) {
  let currentProfit = 0,
    currentLoss = 0,
    currentProfitTrades = 0,
    currentLossTrades = 0,
    maxProfit = 0,
    maxLoss = 0,
    maxProfitTrades = 0,
    maxLossTrades = 0;
  for (const value of values) {
    if (value > 0) {
      currentProfit += value;
      currentProfitTrades += 1;
      currentLoss = 0;
      currentLossTrades = 0;
    } else if (value < 0) {
      currentLoss += Math.abs(value);
      currentLossTrades += 1;
      currentProfit = 0;
      currentProfitTrades = 0;
    } else {
      currentProfit = 0;
      currentLoss = 0;
      currentProfitTrades = 0;
      currentLossTrades = 0;
    }
    if (currentProfit > maxProfit) {
      maxProfit = currentProfit;
      maxProfitTrades = currentProfitTrades;
    }
    if (currentLoss > maxLoss) {
      maxLoss = currentLoss;
      maxLossTrades = currentLossTrades;
    }
  }
  return {
    maxConsecutiveProfitAmount: maxProfit > 0 ? maxProfit : null,
    maxConsecutiveLossAmount: maxLoss > 0 ? maxLoss : null,
    maxConsecutiveProfitTrades: maxProfit > 0 ? maxProfitTrades : null,
    maxConsecutiveLossTrades: maxLoss > 0 ? maxLossTrades : null,
  };
}

/**
 * Averages the *length* of every win streak and every loss streak found in
 * `values` (not just the longest/max-amount one) — MQL5
 * STAT_PROFITTRADES_AVGCON / STAT_LOSSTRADES_AVGCON semantics.
 */
export function computeAverageStreaks(values: number[]) {
  const winStreaks: number[] = [];
  const lossStreaks: number[] = [];

  let currentType: "win" | "loss" | null = null;
  let currentLength = 0;

  const pushCurrent = () => {
    if (!currentType || currentLength === 0) {
      return;
    }

    if (currentType === "win") {
      winStreaks.push(currentLength);
    } else {
      lossStreaks.push(currentLength);
    }
  };

  for (const value of values) {
    const nextType = value > 0 ? "win" : value < 0 ? "loss" : null;
    if (!nextType) {
      pushCurrent();
      currentType = null;
      currentLength = 0;
      continue;
    }

    if (nextType === currentType) {
      currentLength += 1;
      continue;
    }

    pushCurrent();
    currentType = nextType;
    currentLength = 1;
  }

  pushCurrent();

  const average = (streaks: number[]) =>
    streaks.length
      ? streaks.reduce((total, value) => total + value, 0) / streaks.length
      : null;

  return {
    averageWins: average(winStreaks),
    averageLosses: average(lossStreaks),
  };
}
