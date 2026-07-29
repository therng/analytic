// Pure barrel: re-exports the public API of the analytics engine, now split
// across src/lib/trading/analytics/*. See that folder for the module layout.
// Do NOT use `export *` here — deal-kernel.ts also contains private parsing
// helpers that must not leak.

export {
  dealNet,
  positionNetPnl,
  positionProfit,
  normalizeTradeSide,
  isBalanceDeal,
  isFundingDeal,
  isTradingDeal,
  getLatestDealBalance,
} from "./analytics/deal-kernel";

export {
  parseTimeframe,
  startOfDay,
  endOfDay,
  getSinceDate,
  getTimeframeLabel,
  getAccountStatus,
  filterBySince,
  filterByDateRange,
  sanitizeOptionalText,
} from "./analytics/timeframe";

export type { InstrumentSpec } from "./analytics/instrument";
export {
  resolveInstrumentSpec,
  positionPips,
} from "./analytics/instrument";

export {
  computeCompoundedGrowth,
  computeAbsoluteGain,
  computeAllTimeGrowth,
  computeYearGrowth,
} from "./analytics/growth";

export {
  computeSharpeRatio,
  computeAnnualizedSharpeRatio,
} from "./analytics/sharpe";

export {
  computeTradesPerYear,
  computeTradesPerWeek,
  computeTradeActivityPercent,
  computeAlgoTradingPercent,
  computeAlgoTradingByComment,
} from "./analytics/activity";

export {
  computeAverageHoldHours,
  summarizeHoldingTime,
  computeHoldingPeriodReturns,
  computeAHPR,
  computeGHPR,
} from "./analytics/holding";

export {
  computeConsecutiveRunAmounts,
  computeAverageStreaks,
} from "./analytics/streaks";

export {
  isClosedPosition,
  summarizeClosedPositions,
} from "./analytics/closed-positions";

export {
  computeZScore,
  getTradeWinPercent,
  getLongTradeWinPercent,
  getShortTradeWinPercent,
} from "./analytics/win-rate";

export {
  buildDailyProfitSeries,
  buildFundingTotals,
  buildSymbolTradePercent,
  buildBalanceCurve,
  buildUnitDrawdownCurve,
  buildDrawdownPercentSeries,
  normalizeExcludeTransfers,
} from "./analytics/series";

export {
  computeAbsoluteDrawdown,
  computeDepositLoadPercent,
  computeBalanceDrawdown,
} from "./analytics/drawdown";

export { summarizeTrades } from "./analytics/summary";

export {
  XAUUSD_MARGIN_PER_LOT,
  depositLoadByXauusdFilledOrderVolume,
  depositLoadByXauusdVolume,
  depositLoadFromXauusdFilledOrderVolume,
  depositLoadFromXauusdVolume,
  marginUsedFromXauusdFilledOrderVolume,
  marginUsedFromXauusdVolume,
} from "./analytics/xauusd-margin";
export type {
  DepositLoadByVolumeInput,
  DepositLoadByVolumeResult,
  OpenVolumeLeg,
  XauusdFilledOrderLeg,
  XauusdMarginSpec,
} from "./analytics/xauusd-margin";
