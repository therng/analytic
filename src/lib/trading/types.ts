export type Timeframe = "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | "all";

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
  balance: number;
  equity: number;
  floating_pl: number;
  margin: number | null;
  margin_level: number | null;
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

export interface CalendarMonthlyPerformanceCell {
  month: number;
  label: string;
  growthPercent: number | null;
  netAmount: number | null;
}

export interface CalendarMonthlyPerformanceYear {
  year: number;
  months: CalendarMonthlyPerformanceCell[];
  totalGrowthPercent: number | null;
  totalNetAmount: number | null;
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
  };
  openPositions: SerializedOpenPosition[];
  openBySymbol: SerializedOpenSymbolExposure[];
  monthlyPerformance: {
    years: CalendarMonthlyPerformanceYear[];
    summary: {
      totalGrowthPercent: number | null;
      totalNetAmount: number | null;
    };
  };
  balanceCurve: BalanceEventPoint[];
  tradeExecutions: TradeExecutionDistribution;
}

export interface BalanceDetailResponse {
  timeframe: Timeframe;
  account: SerializedAccount;
  summary: {
    absoluteDrawdown: number | null;
    relativeDrawdownPct: number | null;
    maximalDrawdownAmount: number | null;
    maximalDrawdownPct: number | null;
    averageLossTrade: number | null;
    maximalDepositLoad: number | null;
    maximumConsecutiveLossAmount: number | null;
    sharpeRatio: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
  };
  mfeMae: {
    available: boolean;
    reason: string;
    mfe: null;
    mae: null;
  };
  balanceCurve: BalanceEventPoint[];
  drawdownCurve: ChartPoint[];
  equityCurve?: BalanceEventPoint[];
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
    tradesPerWeek: number | null;
    averageProfitTrade: number | null;
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
    largestProfitTrade: number | null;
    largestLossTrade: number | null;
    maximumConsecutiveWins: number | null;
    maximumConsecutiveLosses: number | null;
    profitTradesCount: number | null;
    lossTradesCount: number | null;
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
  };
  openPositions: SerializedOpenPosition[];
  workingOrders: Array<{
    orderId: string;
    openedAt: Date | null;
    symbol: string;
    type: string;
    volume: number;
    price: number;
    sl: number | null;
    tp: number | null;
    marketPrice: number | null;
    state: string;
    comment: string | null;
  }>;
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
    comment: string | null;
    slHit?: boolean;
    tpHit?: boolean;
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
