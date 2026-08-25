export type Timeframe = "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | "all";

export interface CursorPageInfo {
  total: number;
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface SerializedAccount {
  id: string;
  account_number: string;
  owner_name: string | null;
  currency: string;
  server: string;
  status: "Active" | "Inactive";
  last_updated: Date | null;
  today_growth_percent: number;
  week_growth_percent: number;
  today_net_profit: number;
  today_net_pips: number;
  today_trade_count: number;
  /** Live open positions — backs the collapsed card's "N open" rail segment. */
  open_position_count: number;
  balance: number;
  equity: number;
  floating_pl: number;
  margin: number | null;
  margin_level: number | null;
  /**
   * Deposit load starts after a filled XAUUSD order: filled XAUUSD lots x
   * XAUUSD_MARGIN_PER_LOT / balance. Broker margin stays broker-raw on the
   * separate margin/level surfaces.
   */
  deposit_load_source: "xauusd_filled_order_volume";
  deposit_load_pct: number | null;
  deposit_load_margin_used: number | null;
  xauusd_filled_lots: number;
}

export interface ChartPoint {
  x: string;
  y: number;
}

export interface BalanceEventPoint extends ChartPoint {
  balance: number;
  eventType: string | null;
  eventDelta: number | null;
}

export interface TradeExecutionHourBucket {
  hour: number;
  totalExecutions: number;
  buyExecutions: number;
  sellExecutions: number;
  totalVolume: number;
  totalProfit: number;
}

export interface TradeExecutionDistribution {
  reportDate: string;
  reportTimestamp: string;
  timezoneBasis: "report-local";
  totalExecutions: number;
  buyExecutions: number;
  sellExecutions: number;
  excludedOutsideReportDate: number;
  excludedFutureSkew: number;
  hourly: TradeExecutionHourBucket[];
}

export interface SerializedOpenPosition {
  positionId: string;
  openedAt: Date | null;
  symbol: string;
  side: string;
  volume: number;
  openPrice: number;
  sl: number | null;
  tp: number | null;
  marketPrice: number;
  floatingProfit: number;
  swap: number;
  comment: string | null;
  magic: number | null;
}

export interface SerializedOpenSymbolExposure {
  symbol: string;
  count: number;
  volume: number;
  floatingProfit: number;
}

export interface AccountOverviewResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  kpis: {
    periodGrowth: number | null;
    netProfit: number | null;
    grossLoss: number;
    totalSwap: number;
    totalCommission: number;
    totalDeposit: number;
    totalWithdrawal: number;
    drawdown: number | null;
    absoluteDrawdown: number;
    winPercent: number | null;
    netPips: number | null;
    totalWinningPips: number;
    trades: number | null;
    floatingPL: number;
    openCount: number;
    /**
     * Positions-view summary scalars the PerformanceBars (DD→WIN) and
     * PerformanceRadar (DD→EXPECT) panels read, folded into the overview so
     * those panels render from the mount-time overview fetch instead of a
     * separate positions roundtrip.
     */
    performance: AccountPerformanceScalars;
  };
  openPositions: SerializedOpenPosition[];
  /**
   * Deprecated wire fields (openBySymbol/balanceCurve/tradeExecutions): no
   * dashboard consumer reads them and the balance curve alone was ~300KB per
   * long timeframe — the balance endpoint remains the curve's only transport.
   * Optional so Redis L2 entries written by older builds still parse.
   */
  openBySymbol?: SerializedOpenSymbolExposure[];
  balanceCurve?: BalanceEventPoint[];
  tradeExecutions?: TradeExecutionDistribution;
  totalNetProfit: number | null;
  sourceReportDate: string | null;
}

export interface AccountPerformanceScalars {
  algoTradingPercent: number | null;
  tradeActivityPercent: number | null;
  averageProfitTrade: number | null;
  averageLossTrade: number | null;
  longTradesTotal: number | null;
  shortTradesTotal: number | null;
  largestProfitTrade: number | null;
  largestLossTrade: number | null;
  maximumConsecutiveWins: number | null;
  maximumConsecutiveLosses: number | null;
  maxConsecutiveProfitAmount: number | null;
  maxConsecutiveLossAmount: number | null;
  profitTradesCount: number | null;
  lossTradesCount: number | null;
  sharpeRatio: number | null;
  profitFactor: number | null;
  recoveryFactor: number | null;
}

export type LinearRegressionSummary = {
  slope: number;
  intercept: number;
  rSquared: number;
  /** Pearson correlation coefficient, sign(slope) * sqrt(rSquared). */
  correlation: number;
  /** Standard error of the residuals (degrees of freedom = sampleSize - 2). Null when sampleSize <= 2. */
  residualStandardError: number | null;
  sampleSize: number;
  minX: number;
  maxX: number;
};

export type TradeDistributionPoint = {
  positionId: string;
  symbol: string;
  openTime: string;
  closeTime: string;
  holdingSeconds: number | null;
  mae: number | null;
  mfe: number | null;
  profit: number;
  swap: number;
  commission: number;
  netPnl: number;
};

export type TradeDistributionDetail =
  | {
      available: false;
      reason: string;
    }
  | {
      available: true;
      totalPositions: number;
      plottedPositions: number;
      truncated: boolean;
      points: TradeDistributionPoint[];
      regressions: {
        mfeProfit: LinearRegressionSummary | null;
        maeProfit: LinearRegressionSummary | null;
        holdingProfit: LinearRegressionSummary | null;
        mfeMae: LinearRegressionSummary | null;
      };
    };

export interface BalanceDetailResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  summary: {
    absoluteDrawdown: number | null;
    relativeDrawdownPct: number | null;
    maximalDrawdownAmount: number | null;
    maximalDrawdownPct: number | null;
    averageLossTrade: number | null;
    /**
     * INTERIM historical path: broker-margin-derived (EquitySnapshot.depositLoad),
     * NOT the XAUUSD-volume-derived live `account.deposit_load_pct`. Historical
     * open-lots-at-time-t cannot be reconstructed today (see
     * preaggregated/algo-summary.ts). Cut over once a volume-based backfill exists.
     */
    maximalDepositLoad: number | null;
    maximumConsecutiveLossAmount: number | null;
    sharpeRatio: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    /** Correlation between the balance curve and its own linear-regression line. */
    lrCorrelation: number | null;
    /** Standard error of balance deviation from the linear-regression line. */
    lrStandardError: number | null;
  };
  tradeDistributions: TradeDistributionDetail;
  balanceCurve: BalanceEventPoint[];
  drawdownCurve: ChartPoint[];
  equityCurve?: BalanceEventPoint[];
  /** True live-equity drawdown %, from EquitySnapshot (7-day retention — may be shorter than the requested timeframe). */
  equityDrawdownCurve?: ChartPoint[];
  /**
   * INTERIM historical path: deposit load % as broker margin used / equity, from
   * EquitySnapshot (same 7-day retention as equityDrawdownCurve). Not yet the
   * XAUUSD-volume-derived product metric — see `maximalDepositLoad` above.
   */
  depositLoadCurve?: ChartPoint[];
}

export interface GrowthResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  summary: {
    periodGrowth: number;
    ytdGrowth: number;
    allTimeGrowth: number;
    absoluteGain: number;
    periodLabel: string;
  };
  series: {
    monthly: Array<{ month: string; value: number }>;
    yearly: Array<{ year: number; value: number }>;
  };
  balanceOperations: Array<{
    time: string;
    type: string | null;
    delta: number;
  }>;
}

export interface PositionsResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  summary: {
    dealCount: number;
    totalTrades: number;
    tradeActivityPercent: number | null;
    algoTradingPercent: number | null;
    algoTradingByComment:
      | Array<{
          comment: string;
          count: number;
          winRate: number;
          netProfit: number;
          percentOfTotal: number;
        }>
      | null;
    tradesPerWeek: number | null;
    averageProfitTrade: number | null;
    averageLossTrade: number | null;
    longTradesTotal: number | null;
    shortTradesTotal: number | null;
    longTradeWin: number | null;
    shortTradeWin: number | null;
    averageHoldHours: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    sharpeRatio: number | null;
    expectedPayoff: number | null;
    maxConsecutiveProfitAmount: number | null;
    maxConsecutiveLossAmount: number | null;
    maxConsecutiveProfitTrades: number | null;
    maxConsecutiveLossTrades: number | null;
    largestProfitTrade: number | null;
    largestLossTrade: number | null;
    maximumConsecutiveWins: number | null;
    maximumConsecutiveLosses: number | null;
    profitTradesCount: number | null;
    lossTradesCount: number | null;
    /** Arithmetic mean of per-trade % equity change, as a percent number (e.g. 2.34 for +2.34%). */
    ahpr: number | null;
    /** Geometric mean of per-trade % equity change, as a percent number (e.g. 2.34 for +2.34%). */
    ghpr: number | null;
    /** Runs-test Z-Score for win/loss sequence non-randomness. */
    zScore: number | null;
    correlationProfitMfe: number | null;
    correlationProfitMae: number | null;
    correlationMfeMae: number | null;
    minHoldingSeconds: number | null;
    maxHoldingSeconds: number | null;
    avgHoldingSeconds: number | null;
    symbolTradePercent: Array<{
      symbol: string;
      percent: number;
    }>;
    totalWinningPips: number;
    totalLosingPips: number;
    netPips: number;
    averageWinningPips: number | null;
    totalVolume: number;
    openCount: number;
    floatingProfit: number;
    /** Per-bot chart aggregate (server-side replacement for the Bot P/L pagination loop). */
    botPerformance: Array<{
      label: string;
      count: number;
      grossProfit: number;
      grossLoss: number;
      netPnl: number;
      wins: number;
      losses: number;
    }>;
    /** Bangkok-day P/L buckets (server-side replacement for the heatmap's limit=100000 download). */
    dailyPnl: Array<{ dateKey: string; pnl: number; count: number }>;
  };
  openPositions: SerializedOpenPosition[];
  openBySymbol: SerializedOpenSymbolExposure[];
  historyPositions: Array<{
    positionId: string;
    symbol: string;
    type: string;
    volume: number;
    openedAt: Date | null;
    closedAt: Date | null;
    openPrice: number | null;
    closePrice: number | null;
    marketPrice: number | null;
    profit: number;
    sl: number | null;
    tp: number | null;
    swap: number | null;
    commission: number | null;
    pips: number | null;
    mae: number | null;
    mfe: number | null;
    comment: string | null;
    exitReason: string | null;
    slHit?: boolean;
    tpHit?: boolean;
    magic: number | null;
  }>;
  historyPage: CursorPageInfo;
  recentDeals: Array<{
    dealId: string;
    symbol: string;
    side: string;
    volume: number;
    time: Date;
    price: number | null;
    pnl: number;
  }>;
}

export interface ProfitDetailResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  summary: {
    netProfit: number;
    grossProfit: number;
    grossLoss: number;
    totalCommission: number;
    totalSwap: number;
    totalDeposit: number;
    totalWithdrawal: number;
    profitFactor: number | null;
    dailyProfit: Array<{
      date: string;
      profit: number;
    }>;
  };
  bySymbol: Array<{
    symbol: string;
    trades: number;
    netProfit: number;
    avgTrade: number;
    winRate: number;
  }>;
  recentDeals: Array<{
    dealId: string;
    symbol: string;
    side: string;
    volume: number;
    time: Date;
    price: number | null;
    pnl: number;
  }>;
}

export interface PipsSummaryRow {
  label: string;
  profit: number;
  growth: number;
  pips: number;
  volume: number;
}

export interface PipsSummaryResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  rows: PipsSummaryRow[];
}

export interface WinDetailResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  summary: {
    winRate: number | null;
    wins: number;
    losses: number;
    longTradeWin: number | null;
    shortTradeWin: number | null;
    largestProfitTrade: number | null;
    largestLossTrade: number | null;
    sharpeRatio: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    expectedPayoff: number | null;
    maximumConsecutiveWins: number | null;
    maximumConsecutiveLosses: number | null;
    maximumConsecutiveProfitAmount: number | null;
    averageConsecutiveWins: number | null;
    averageConsecutiveLosses: number | null;
  };
  bySymbol: Array<{
    symbol: string;
    trades: number;
    netProfit: number;
    winRate: number;
  }>;
  bySide: Array<{
    side: string;
    trades: number;
    netProfit: number;
    winRate: number;
  }>;
  outcomeSeries: ChartPoint[];
}
