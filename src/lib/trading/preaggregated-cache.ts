import { prisma } from "@/lib/prisma";
import {
  convertBangkokReportTimeToTableTimestamp,
  endOfBangkokMonth,
  endOfBangkokYear,
  getBangkokDateKey,
  getBangkokHour,
  getBangkokMonthIndex,
  getBangkokYear,
  getThaiDateKeyFromTableTime,
  getThaiHourFromTableTime,
  startOfBangkokDay,
  startOfBangkokMonth,
  startOfBangkokWeek,
  startOfBangkokYear,
  startOfThaiDayInTableTime,
} from "@/lib/time";
import type {
  AccountOverviewResponse,
  BalanceDetailResponse,
  GrowthResponse,
  PositionsResponse,
  ProfitDetailResponse,
  TradeExecutionDistribution,
  Timeframe,
  WinDetailResponse,
  PipsSummaryResponse,
} from "@/lib/trading/types";
import {
  buildBalanceCurve,
  buildDailyProfitSeries,
  buildFundingTotals,
  buildSymbolTradePercent,
  buildUnitDrawdownCurve,
  computeAbsoluteDrawdown,
  computeAbsoluteGain,
  computeAllTimeGrowth,
  computeAverageHoldHours,
  computeBalanceDrawdown,
  computeCompoundedGrowth,
  computeConsecutiveRunAmounts,
  computeDepositLoadPercent,
  computeTradeActivityPercent,
  computeAnnualizedSharpeRatio,
  computeSharpeRatio,
  computeTradesPerWeek,
  computeTradesPerYear,
  computeYearGrowth,
  dealNet,
  filterBySince,
  getAccountAnchorDate,
  getAccountBundle,
  getLongTradeWinPercent,
  getShortTradeWinPercent,
  getSinceDate,
  getTimeframeLabel,
  isClosedPosition,
  isBalanceDeal,
  isFundingDeal,
  isTradingDeal,
  normalizeTradeSide,
  parseTimeframe,
  positionNetPnl,
  positionPips,
  serializeAccountBundle,
  serializeOpenPositions,
  summarizeClosedPositions,
  summarizeTrades,
} from "@/lib/trading/account-data";

const ACCOUNT_CACHE_REVALIDATE_MS = 5_000;
const MONTH_LABELS = Array.from({ length: 12 }, (_, index) =>
  new Date(2024, index, 1).toLocaleString("en-US", { month: "short" }),
);

type DealRow = {
  time: Date | string;
  type?: string | null;
  direction?: string | null;
  comment?: string | null;
  symbol?: string | null;
  volume?: number | null;
  price?: number | null;
  profit?: number | null;
  commission?: number | null;
  swap?: number | null;
  dealId?: string;
  dealNo?: string;
  balanceAfter?: number | null;
  balance?: number | null;
};

type PositionRow = {
  closeTime: Date | string | null;
  openTime?: Date | string | null;
  reportDate?: Date | string | null;
  positionNo?: string;
  symbol?: string;
  type?: string;
  volume?: number;
  openPrice?: number | null;
  closePrice?: number | null;
  sl?: number | null;
  tp?: number | null;
  profit?: number | null;
  swap?: number | null;
  commission?: number | null;
  pips?: number | null;
  comment?: string | null;
};

type OpenPositionRow = {
  reportDate?: Date | string | null;
  profit?: number | null;
  floatingProfit?: number | null;
  floating_profit?: number | null;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_REPORT_FUTURE_SKEW_MS = 5 * 60 * 1000;

function startOfReportDay(date: Date) {
  return startOfThaiDayInTableTime(date) ?? startOfBangkokDay(date) ?? date;
}

function getValidDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getReportLocalDateKey(value: Date | string | null | undefined) {
  return getBangkokDateKey(value);
}


function buildTradeExecutionDistribution(deals: DealRow[], reportTime: Date): TradeExecutionDistribution {
  const reportDate = getReportLocalDateKey(reportTime) ?? "0000-00-00";
  const reportTableTimestamp = convertBangkokReportTimeToTableTimestamp(reportTime);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalExecutions: 0,
    buyExecutions: 0,
    sellExecutions: 0,
    totalVolume: 0,
    totalProfit: 0,
  }));
  const seenDealKeys = new Set<string>();
  let totalExecutions = 0;
  let buyExecutions = 0;
  let sellExecutions = 0;
  let excludedOutsideReportDate = 0;
  let excludedFutureSkew = 0;

  for (const deal of deals) {
    if (!isTradingDeal(deal.type)) {
      continue;
    }

    const parsedTime = getValidDate(deal.time);
    if (!parsedTime) {
      continue;
    }

    const executionDate = getThaiDateKeyFromTableTime(parsedTime);
    if (executionDate !== reportDate) {
      excludedOutsideReportDate += 1;
      continue;
    }

    if (reportTableTimestamp !== null && parsedTime.getTime() > reportTableTimestamp + MAX_REPORT_FUTURE_SKEW_MS) {
      excludedFutureSkew += 1;
      continue;
    }

    const side = normalizeTradeSide(deal.type, deal.direction);
    const dedupeKey = String(
      deal.dealNo
      ?? deal.dealId
      ?? `${parsedTime.toISOString()}|${side}|${deal.symbol ?? ""}|${Number(deal.price ?? 0)}|${Number(deal.volume ?? 0)}`,
    );
    if (seenDealKeys.has(dedupeKey)) {
      continue;
    }
    seenDealKeys.add(dedupeKey);

    const hour = getThaiHourFromTableTime(parsedTime) ?? getBangkokHour(parsedTime) ?? 0;
    const bucket = hourly[hour];
    if (!bucket) {
      continue;
    }

    const volume = Number(deal.volume ?? 0);
    const profit = dealNet(deal);
    bucket.totalExecutions += 1;
    bucket.totalVolume += Number.isFinite(volume) ? volume : 0;
    bucket.totalProfit += Number.isFinite(profit) ? profit : 0;
    totalExecutions += 1;

    if (side === "buy") {
      bucket.buyExecutions += 1;
      buyExecutions += 1;
    } else if (side === "sell") {
      bucket.sellExecutions += 1;
      sellExecutions += 1;
    }
  }

  return {
    reportDate,
    reportTimestamp: reportTime.toISOString(),
    timezoneBasis: "report-local",
    totalExecutions,
    buyExecutions,
    sellExecutions,
    excludedOutsideReportDate,
    excludedFutureSkew,
    hourly,
  };
}

function getDealBalancePointValue(deal: DealRow) {
  const value = Number(deal.balanceAfter ?? deal.balance ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

function deriveOpeningBalance(deal: DealRow) {
  const balanceAfter = getDealBalancePointValue(deal);
  if (balanceAfter === null) {
    return 0;
  }

  return balanceAfter - dealNet(deal);
}

function buildRealtime24HourBalanceCurve(
  deals: DealRow[],
  reportTime: Date,
  endingBalance: number,
) {
  const sortedDeals = [...deals].sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
  const anchorTime = convertBangkokReportTimeToTableTimestamp(reportTime) ?? reportTime.getTime();
  const startTime = startOfReportDay(reportTime).getTime();
  const endTime = startTime + 24 * ONE_HOUR_MS;
  const clampedAnchorTime = Math.min(Math.max(anchorTime, startTime), endTime);
  let fallbackOpeningBalance = 0;
  if (Number.isFinite(endingBalance) && endingBalance > 0) {
    fallbackOpeningBalance = endingBalance;
  } else if (sortedDeals.length > 0) {
    fallbackOpeningBalance = deriveOpeningBalance(sortedDeals[0]!);
  }

  let previousCloseBalance = fallbackOpeningBalance;

  for (const deal of sortedDeals) {
    const timestamp = new Date(deal.time).getTime();
    if (!Number.isFinite(timestamp) || timestamp >= startTime) {
      break;
    }

    const balanceAfter = getDealBalancePointValue(deal);
    if (balanceAfter !== null) {
      previousCloseBalance = balanceAfter;
    }
  }

  const points: Array<{
    time: Date;
    balance: number;
    eventType: string | null;
    eventDelta: number | null;
  }> = [
    {
      time: new Date(startTime),
      balance: previousCloseBalance,
      eventType: null,
      eventDelta: null,
    },
  ];

  let runningBalance = previousCloseBalance;

  for (const deal of sortedDeals) {
    const timestamp = new Date(deal.time).getTime();
    if (!Number.isFinite(timestamp) || timestamp < startTime) {
      continue;
    }

    if (timestamp > clampedAnchorTime) {
      break;
    }

    const balanceAfter = getDealBalancePointValue(deal);
    if (balanceAfter === null) {
      continue;
    }

    runningBalance = balanceAfter;
    points.push({
      time: new Date(timestamp),
      balance: runningBalance,
      eventType: deal.type ?? null,
      eventDelta: dealNet(deal),
    });
  }

  const latestPoint = points[points.length - 1];
  const shouldAppendCurrentPoint =
    !latestPoint
    || latestPoint.time.getTime() !== clampedAnchorTime
    || Math.abs(latestPoint.balance - endingBalance) > 0.000001;

  if (shouldAppendCurrentPoint) {
    points.push({
      time: new Date(clampedAnchorTime),
      balance: Number.isFinite(endingBalance) ? endingBalance : runningBalance,
      eventType: null,
      eventDelta: null,
    });
  }

  return points;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isMonthCovered(
  monthStart: Date,
  monthEnd: Date,
  firstDealTime: Date | null,
  latestCoveredTime: Date | null,
) {
  if (!firstDealTime || !latestCoveredTime) {
    return false;
  }

  return monthEnd >= (startOfBangkokMonth(firstDealTime) ?? firstDealTime)
    && monthStart <= latestCoveredTime;
}

function sumTradingNetForRange(deals: DealRow[], start: Date, end: Date) {
  return deals.reduce((total, deal) => {
    const timestamp = new Date(deal.time).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp > end.getTime()) {
      return total;
    }

    return !isFundingDeal(deal.type, deal.comment, dealNet(deal)) ? total + dealNet(deal) : total;
  }, 0);
}

function buildCalendarMonthlyPerformance(deals: DealRow[], reportTime: Date) {
  const sortedDeals = [...deals].sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
  if (sortedDeals.length === 0) {
    return {
      years: [] as Array<{
        year: number;
        months: Array<{
          month: number;
          label: string;
          growthPercent: number | null;
          netAmount: number | null;
        }>;
        totalGrowthPercent: number | null;
        totalNetAmount: number | null;
      }>,
      summary: {
        totalGrowthPercent: 0,
        totalNetAmount: 0,
      },
    };
  }

  const firstDealTime = new Date(sortedDeals[0]!.time);
  const latestCoveredTime = new Date(reportTime);
  const firstYear = getBangkokYear(firstDealTime) ?? firstDealTime.getFullYear();
  const lastYear = getBangkokYear(latestCoveredTime) ?? latestCoveredTime.getFullYear();
  
  let totalRatio = 1;
  let totalNetAmount = 0;
  const years = [];

  for (let year = lastYear; year >= firstYear; year--) {
    let yearRatio = 1;
    let yearNetAmount = 0;
    let hasCoveredMonth = false;
    const months = [];

    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
      const monthStart = startOfBangkokMonth(new Date(Date.UTC(year, monthIndex, 1))) ?? new Date(Date.UTC(year, monthIndex, 1));
      const monthEnd = endOfBangkokMonth(monthStart) ?? monthStart;
      
      if (!isMonthCovered(monthStart, monthEnd, firstDealTime, latestCoveredTime)) {
        months.push({
          month: monthIndex,
          label: MONTH_LABELS[monthIndex] ?? "",
          growthPercent: null,
          netAmount: null,
        });
        continue;
      }

      hasCoveredMonth = true;
      const growthPercent = computeCompoundedGrowth(deals, monthStart, monthEnd);
      const monthRatio = 1 + growthPercent / 100;
      const validMonthRatio = Number.isFinite(monthRatio) ? monthRatio : 1;
      const netAmount = sumTradingNetForRange(deals, monthStart, monthEnd);

      yearRatio *= validMonthRatio;
      yearNetAmount += netAmount;
      
      totalRatio *= validMonthRatio;
      totalNetAmount += netAmount;

      months.push({
        month: monthIndex,
        label: MONTH_LABELS[monthIndex] ?? "",
        growthPercent,
        netAmount,
      });
    }

    if (hasCoveredMonth) {
      years.push({
        year,
        months,
        totalGrowthPercent: (yearRatio - 1) * 100,
        totalNetAmount: yearNetAmount,
      });
    }
  }

  return {
    years,
    summary: {
      totalGrowthPercent: (totalRatio - 1) * 100,
      totalNetAmount,
    },
  };
}

function computeAverageStreaks(values: number[]) {
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
    streaks.length ? streaks.reduce((total, value) => total + value, 0) / streaks.length : null;

  return {
    averageWins: average(winStreaks),
    averageLosses: average(lossStreaks),
  };
}

type CachedTimeframeViews = {
  overview: AccountOverviewResponse;
  balanceDetail: BalanceDetailResponse;
  growth: GrowthResponse;
  positions: PositionsResponse;
  profitDetail: ProfitDetailResponse;
  winDetail: WinDetailResponse;
  pipsSummary: PipsSummaryResponse;
};

type AccountPreaggregatedSource = {
  account: NonNullable<ReturnType<typeof serializeAccountBundle>>;
  deals: DealRow[];
  positions: PositionRow[];
  openPositions: OpenPositionRow[];
  latestSnapshotBalance: number;
  latestSnapshotEquity: number;
  latestSnapshotMargin: number;
  reportTime: Date;
};

type AccountPreaggregatedBundle = {
  accountId: string;
  versionKey: string;
  lastCheckedAt: number;
  source: AccountPreaggregatedSource;
  timeframes: Partial<Record<Timeframe, CachedTimeframeViews>>;
};

const accountCache = new Map<string, AccountPreaggregatedBundle>();
const CACHE_MAX_ENTRIES = 500; // Prevent unbounded growth

function enforceAccountCacheLimit() {
  if (accountCache.size > CACHE_MAX_ENTRIES) {
    const entriesToDelete = accountCache.size - CACHE_MAX_ENTRIES + 50; // Delete 50 oldest when over limit
    const entries = Array.from(accountCache.entries()).sort((a, b) => a[1].lastCheckedAt - b[1].lastCheckedAt);
    for (let i = 0; i < entriesToDelete && i < entries.length; i++) {
      accountCache.delete(entries[i][0]);
    }
  }
}

type AccountVersionProbe = {
  accountId: string;
  versionKey: string;
};

async function getAccountVersionProbe(accountId: string): Promise<AccountVersionProbe | null> {
  const account = await (prisma as any).tradingAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      updatedAt: true,
      reportDate: true,
      accountSnapshot: {
        select: {
          updatedAt: true,
          reportDate: true,
        },
      },
      accountReportResult: {
        select: {
          computedAt: true,
          sourceReportDate: true,
        },
      },
      reportImports: {
        select: {
          createdAt: true,
          reportDate: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!account) {
    return null;
  }

  const latestImport = account.reportImports[0];
  const versionKey = [
    account.id,
    account.updatedAt?.toISOString() ?? "0",
    account.reportDate?.toISOString() ?? "0",
    account.accountSnapshot?.updatedAt?.toISOString() ?? "0",
    account.accountSnapshot?.reportDate?.toISOString() ?? "0",
    account.accountReportResult?.computedAt?.toISOString() ?? "0",
    account.accountReportResult?.sourceReportDate?.toISOString() ?? "0",
    latestImport?.createdAt?.toISOString() ?? "0",
    latestImport?.reportDate?.toISOString() ?? "0",
  ].join("|");

  return {
    accountId: account.id,
    versionKey,
  };
}

function buildTimeframeView(params: AccountPreaggregatedSource & { timeframe: Timeframe }) {
  const {
    timeframe,
    account,
    deals,
    positions,
    openPositions,
    latestSnapshotBalance,
    latestSnapshotEquity,
    latestSnapshotMargin,
    reportTime,
  } = params;

  const since = getSinceDate(timeframe, reportTime);
  const scopedDeals = filterBySince(deals, (deal) => deal.time, since);
  const drawdownDeals = deals.filter((deal) => !isBalanceDeal(deal.type, deal.comment, dealNet(deal)));
  const tradingDeals = scopedDeals.filter((deal) => isTradingDeal(deal.type));
  const sortedScopedDeals = [...scopedDeals].sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
  const allClosedPositions = positions.filter((position) => isClosedPosition(position));
  const scopedPositions = filterBySince(positions, (position) => position.closeTime, since);
  const scopedClosedPositions = scopedPositions.filter((position) => isClosedPosition(position));
  const closedPositionSummary = summarizeClosedPositions(scopedClosedPositions);

  const scopedPositionPips = scopedClosedPositions
    .map((position) => positionPips(position))
    .filter((value): value is number => Number.isFinite(value));

  let totalWinningPips = 0;
  let totalLosingPips = 0;
  let netPips = 0;
  let winningPipCount = 0;

  for (const pips of scopedPositionPips) {
    netPips += pips;
    if (pips > 0) {
      totalWinningPips += pips;
      winningPipCount++;
    } else if (pips < 0) {
      totalLosingPips += pips;
    }
  }

  const averageWinningPips = winningPipCount > 0 ? totalWinningPips / winningPipCount : null;
  const totalVolume = scopedClosedPositions.reduce((total, position) => total + Number(position.volume ?? 0), 0);

  const getPipsSummaryRow = (label: string, sinceDate: Date | null) => {
    const periodDeals = filterBySince(deals, (deal) => deal.time, sinceDate);
    const periodPositions = filterBySince(positions, (position) => position.closeTime, sinceDate);
    const periodClosedPositions = periodPositions.filter((position) => isClosedPosition(position));

    const profit = periodDeals
      .filter((deal) => !isFundingDeal(deal.type, deal.comment, dealNet(deal)))
      .reduce((total, deal) => total + dealNet(deal), 0);

    // Return = Profit / (Balance at period start + deposits during period)
    const balanceAtPeriodStart = sinceDate
      ? deals
          .filter((d) => d.time != null && new Date(d.time as unknown as string) < sinceDate)
          .reduce((total, d) => total + dealNet(d), 0)
      : 0;
    const periodDeposits = periodDeals
      .filter((d) => isFundingDeal(d.type, d.comment, dealNet(d)) && dealNet(d) > 0)
      .reduce((total, d) => total + dealNet(d), 0);
    const capitalBase = Math.max(1, balanceAtPeriodStart + periodDeposits);
    const growth = (profit / capitalBase) * 100;

    const pips = periodClosedPositions
      .map((position) => positionPips(position))
      .filter((value): value is number => Number.isFinite(value))
      .reduce((total, value) => total + value, 0);

    const volume = periodClosedPositions.reduce((total, position) => total + Number(position.volume ?? 0), 0);

    return {
      label,
      profit,
      growth,
      pips,
      volume,
    };
  };

  const now = reportTime;
  const startOfToday = startOfThaiDayInTableTime(now) ?? startOfBangkokDay(now) ?? now;
  const startOfWeek = startOfBangkokWeek(now) ?? startOfToday;
  const startOfMonth = startOfBangkokMonth(now) ?? startOfToday;
  const startOfYear = startOfBangkokYear(now) ?? startOfToday;

  const pipsSummary: PipsSummaryResponse = {
    timeframe,
    account,
    rows: [
      getPipsSummaryRow("วันนี้", startOfToday),
      getPipsSummaryRow("สัปดาห์นี้", startOfWeek),
      getPipsSummaryRow("เดือนนี้", startOfMonth),
      getPipsSummaryRow("ปีนี้", startOfYear),
    ],
  };

  const endingBalance = Number.isFinite(latestSnapshotBalance) && latestSnapshotBalance > 0
    ? latestSnapshotBalance
    : account.balance;
  const balanceCurve = timeframe === "1d"
    ? buildRealtime24HourBalanceCurve(deals, reportTime, endingBalance)
    : buildBalanceCurve(sortedScopedDeals);
  const periodGrowth = timeframe === "all" ? computeAllTimeGrowth(deals) : computeCompoundedGrowth(deals, since, null);
  const drawdown = computeBalanceDrawdown(drawdownDeals, since, null);
  const outcomeSummary = summarizeTrades(tradingDeals);
  const grossLoss = Math.abs(tradingDeals.filter((trade) => dealNet(trade) < 0).reduce((total, trade) => total + dealNet(trade), 0));
  const fundingTotals = buildFundingTotals(scopedDeals);
  const allTimeFundingTotals = buildFundingTotals(deals);
  const monthlyPerformance = buildCalendarMonthlyPerformance(deals, reportTime);
  const tradeExecutions = buildTradeExecutionDistribution(deals, reportTime);
  const openPositionsPayload = serializeOpenPositions(openPositions as any);
  const openBySymbolMap = new Map<string, { symbol: string; count: number; volume: number; floatingProfit: number }>();
  for (const position of openPositionsPayload) {
    const symbol = position.symbol || "UNKNOWN";
    let current = openBySymbolMap.get(symbol);
    if (!current) {
      current = { symbol, count: 0, volume: 0, floatingProfit: 0 };
      openBySymbolMap.set(symbol, current);
    }
    current.count += 1;
    current.volume += Number(position.volume ?? 0);
    current.floatingProfit += Number(position.floatingProfit ?? 0);
  }

  const openBySymbol = Array.from(openBySymbolMap.values())
    .sort((left, right) => Math.abs(right.floatingProfit) - Math.abs(left.floatingProfit));

  const overview: AccountOverviewResponse = {
    timeframe,
    account,
    kpis: {
      periodGrowth,
      netProfit: outcomeSummary.netProfit,
      grossLoss,
      totalSwap: tradingDeals.reduce((total, trade) => total + Number(trade.swap ?? 0), 0),
      totalCommission: tradingDeals.reduce((total, trade) => total + Number(trade.commission ?? 0), 0),
      totalDeposit: fundingTotals.totalDeposit,
      totalWithdrawal: fundingTotals.totalWithdraw,
      drawdown: drawdown.relativePercent,
      absoluteDrawdown: computeAbsoluteDrawdown(allTimeFundingTotals.totalWithdraw, endingBalance, allTimeFundingTotals.totalDeposit),
      winPercent: closedPositionSummary.winPercent,
      netPips,
      totalWinningPips,
      trades: closedPositionSummary.totalTrades,
      floatingPL: openPositions.reduce((total, position) => total + Number(position.profit ?? 0), 0),
      openCount: openPositions.length,
    },
    openPositions: openPositionsPayload,
    openBySymbol,
    monthlyPerformance,
    balanceCurve: balanceCurve.map((point) => ({
      x: toIso(point.time),
      y: point.balance,
      balance: point.balance,
      eventType: point.eventType ?? null,
      eventDelta: point.eventDelta ?? null,
    })),
    tradeExecutions,
  };

  const unitDrawdownCurve = buildUnitDrawdownCurve(drawdownDeals, since, null);
  const currentDepositLoad = computeDepositLoadPercent({
    equity: latestSnapshotEquity,
    margin: latestSnapshotMargin,
  });
  const runAmounts = computeConsecutiveRunAmounts(
    sortedScopedDeals
      .filter((deal) => isTradingDeal(deal.type))
      .map((deal) => dealNet(deal)),
  );

  // Risk-adjusted KPIs scoped to the selected timeframe.
  const balanceDetailTotalNet = closedPositionSummary.totalNetProfit;

  // No drawdown but positive net = "perfect" recovery; surface as Infinity so the
  // gauge picks the "great" zone instead of "NO DATA".
  let balanceDetailRecoveryFactor: number | null = null;
  if (drawdown.maximalAmount > 0) {
    balanceDetailRecoveryFactor = balanceDetailTotalNet / drawdown.maximalAmount;
  } else if (balanceDetailTotalNet > 0) {
    balanceDetailRecoveryFactor = Number.POSITIVE_INFINITY;
  }

  const balanceDetailSharpeRatio = computeAnnualizedSharpeRatio(
    closedPositionSummary.netValues,
    computeTradesPerYear(scopedClosedPositions),
  );

  // Profit factor is undefined when there are zero losing trades; treat a
  // strictly winning sample as "great" (Infinity) for the gauge.
  let balanceDetailProfitFactor = closedPositionSummary.profitFactor ?? null;
  if (balanceDetailProfitFactor === null && closedPositionSummary.grossProfit > 0 && closedPositionSummary.grossLoss === 0) {
    balanceDetailProfitFactor = Number.POSITIVE_INFINITY;
  }

  const balanceDetail: BalanceDetailResponse = {
    timeframe,
    account,
    summary: {
      absoluteDrawdown: computeAbsoluteDrawdown(allTimeFundingTotals.totalWithdraw, endingBalance, allTimeFundingTotals.totalDeposit),
      relativeDrawdownPct: drawdown.relativePercent,
      maximalDrawdownAmount: drawdown.maximalAmount,
      maximalDrawdownPct: drawdown.maximalPercent,
      averageLossTrade: closedPositionSummary.averageLossTrade,
      maximalDepositLoad: currentDepositLoad,
      maximumConsecutiveLossAmount: runAmounts.maxConsecutiveLossAmount,
      sharpeRatio: balanceDetailSharpeRatio,
      profitFactor: balanceDetailProfitFactor,
      recoveryFactor: balanceDetailRecoveryFactor,
    },
    mfeMae: {
      available: false,
      reason: "Unavailable from current report data",
      mfe: null,
      mae: null,
    },
    balanceCurve: balanceCurve.map((point) => ({
      x: toIso(point.time),
      y: point.balance,
      balance: point.balance,
      eventType: point.eventType ?? null,
      eventDelta: point.eventDelta ?? null,
    })),
    drawdownCurve: unitDrawdownCurve.map((point) => ({
      x: point.time.toISOString(),
      y: point.drawdownPercent,
    })),
  };

  const year = getBangkokYear(reportTime) ?? reportTime.getFullYear();
  const allTimeGrowth = computeAllTimeGrowth(deals);
  const ytdGrowth = computeYearGrowth(deals, year);
  const allTimeAbsoluteGain = computeAbsoluteGain(deals, null);
  const ytdAbsoluteGain = computeAbsoluteGain(
    deals,
    startOfBangkokYear(reportTime) ?? new Date(Date.UTC(year, 0, 1)),
    endOfBangkokYear(reportTime) ?? new Date(Date.UTC(year + 1, 0, 1) - 1),
  );
  void ytdAbsoluteGain;
  const absoluteGain = timeframe === "all" ? allTimeAbsoluteGain : computeAbsoluteGain(deals, since, null);

  const monthly = Array.from({ length: 12 }, (_, index) => {
    const start = startOfBangkokMonth(new Date(Date.UTC(year, index, 1))) ?? new Date(Date.UTC(year, index, 1));
    const end = endOfBangkokMonth(start) ?? start;

    return {
      month: MONTH_LABELS[getBangkokMonthIndex(start) ?? index] ?? "",
      value: computeCompoundedGrowth(deals, start, end),
    };
  });

  const years = deals
    .map((deal) => getBangkokYear(deal.time))
    .filter((value): value is number => Number.isFinite(value));
  const firstYear = years.length ? Math.min(...years) : year;
  const yearly = Array.from({ length: year - firstYear + 1 }, (_, index) => {
    const itemYear = firstYear + index;
    return {
      year: itemYear,
      value: computeYearGrowth(deals, itemYear),
    };
  });

  const growth: GrowthResponse = {
    timeframe,
    account,
    summary: {
      periodGrowth,
      ytdGrowth,
      allTimeGrowth,
      absoluteGain,
      periodLabel: getTimeframeLabel(timeframe),
    },
    series: {
      monthly,
      yearly,
    },
    balanceOperations: deals
      .filter((deal) => isBalanceDeal(deal.type, deal.comment, dealNet(deal)))
      .map((deal) => ({
        time: toIso(deal.time),
        type: deal.type ?? null,
        delta: dealNet(deal),
      })),
  };

  // Build separate maps for opening (direction="in") and closing (direction="out") deals.
  // - Opening deal comment → shown as the trade note in UI (e.g. "Axonshift-N Buy").
  // - Closing deal comment → parsed for "[sl <price>]" / "[tp <price>]" tags to override
  //   the displayed SL/TP and flag the close reason.
  // Match positions to deals via "symbol:seconds:price" (price disambiguates basket closes
  // at the same instant); fall back to a FIFO queue on "symbol:seconds" when prices collide.
  type DealEntry = { comment: string | null };
  const openingByPriceKey = new Map<string, DealEntry>();
  const openingQueueByTimeKey = new Map<string, DealEntry[]>();
  const closingByPriceKey = new Map<string, DealEntry>();
  const closingQueueByTimeKey = new Map<string, DealEntry[]>();
  for (const deal of deals) {
    if (!isTradingDeal(deal.type)) continue;
    const dir = (deal.direction ?? "").toLowerCase().trim();
    if (dir !== "in" && dir !== "out") continue;
    if (!deal.symbol || !deal.time) continue;
    const secs = Math.floor(new Date(deal.time).getTime() / 1000);
    const timeKey = `${deal.symbol}:${secs}`;
    const entry: DealEntry = { comment: deal.comment ?? null };
    const byPriceKey = dir === "in" ? openingByPriceKey : closingByPriceKey;
    const queueByTimeKey = dir === "in" ? openingQueueByTimeKey : closingQueueByTimeKey;
    if (deal.price != null) {
      const priceKey = `${timeKey}:${Number(deal.price).toFixed(5)}`;
      if (!byPriceKey.has(priceKey)) {
        byPriceKey.set(priceKey, entry);
      }
    }
    const queue = queueByTimeKey.get(timeKey);
    if (queue) {
      queue.push(entry);
    } else {
      queueByTimeKey.set(timeKey, [entry]);
    }
  }

  function lookupDealComment(
    byPriceKey: Map<string, DealEntry>,
    queueByTimeKey: Map<string, DealEntry[]>,
    symbol: string | null | undefined,
    timeMs: number | null,
    price: number | null,
  ): string | null | undefined {
    if (!symbol || timeMs == null) return undefined;
    const timeKey = `${symbol}:${Math.floor(timeMs / 1000)}`;
    if (price != null) {
      const priceKey = `${timeKey}:${Number(price).toFixed(5)}`;
      const hit = byPriceKey.get(priceKey);
      if (hit) return hit.comment;
    }
    const queue = queueByTimeKey.get(timeKey);
    if (queue && queue.length > 0) {
      return (queue.shift() as DealEntry).comment;
    }
    return undefined;
  }

  const SL_TAG_RE = /\[sl\s+([\d.]+)\]/i;
  const TP_TAG_RE = /\[tp\s+([\d.]+)\]/i;

  const orderedScopedPositions = [...scopedClosedPositions].sort(
    (left, right) => new Date(left.closeTime ?? 0).getTime() - new Date(right.closeTime ?? 0).getTime(),
  );
  const historyPositions = [...orderedScopedPositions]
    .sort((left, right) => new Date(right.closeTime ?? right.reportDate ?? 0).getTime() - new Date(left.closeTime ?? left.reportDate ?? 0).getTime())
    .map((position) => {
      const openMs = position.openTime ? new Date(position.openTime).getTime() : null;
      const closeMs = position.closeTime ? new Date(position.closeTime).getTime() : null;
      const openPriceNum = position.openPrice == null ? null : Number(position.openPrice);
      const closePriceNum = position.closePrice == null ? null : Number(position.closePrice);

      const openingComment = lookupDealComment(openingByPriceKey, openingQueueByTimeKey, position.symbol, openMs, openPriceNum);
      const closingComment = lookupDealComment(closingByPriceKey, closingQueueByTimeKey, position.symbol, closeMs, closePriceNum);

      const comment = openingComment ?? null;

      let sl = position.sl == null ? null : Number(position.sl);
      let tp = position.tp == null ? null : Number(position.tp);
      let slHit = false;
      let tpHit = false;
      if (closingComment) {
        const slMatch = SL_TAG_RE.exec(closingComment);
        if (slMatch) {
          const parsed = Number(slMatch[1]);
          if (Number.isFinite(parsed)) sl = parsed;
          slHit = true;
        }
        const tpMatch = TP_TAG_RE.exec(closingComment);
        if (tpMatch) {
          const parsed = Number(tpMatch[1]);
          if (Number.isFinite(parsed)) tp = parsed;
          tpHit = true;
        }
      }

      return {
        positionId: position.positionNo ?? "",
        symbol: position.symbol ?? "UNKNOWN",
        type: position.type ?? "",
        volume: position.volume ?? 0,
        openedAt: position.openTime ? new Date(position.openTime) : null,
        closedAt: position.closeTime ? new Date(position.closeTime) : null,
        openPrice: openPriceNum,
        closePrice: closePriceNum,
        marketPrice: closePriceNum,
        profit: position.profit == null ? 0 : Number(position.profit),
        sl,
        tp,
        swap: position.swap == null ? null : Number(position.swap),
        commission: position.commission == null ? null : Number(position.commission),
        pips: positionPips(position),
        comment,
        slHit,
        tpHit,
      };
    });
  const scopedPositionTrades = orderedScopedPositions.map((position) => ({
    dealId: position.positionNo ?? "",
    symbol: position.symbol ?? "UNKNOWN",
    side: normalizeTradeSide(position.type, position.type),
    volume: position.volume ?? 0,
    time: position.closeTime ?? position.reportDate ?? new Date(0),
    price: position.closePrice == null ? null : Number(position.closePrice),
    pnl: positionNetPnl(position),
  }));
  const recentPositionDeals = [...scopedPositionTrades]
    .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
    .slice(0, 30);
  const positionNetValues = closedPositionSummary.netValues;
  const positionRunAmounts = computeConsecutiveRunAmounts(positionNetValues);
  const positionsDrawdown = computeBalanceDrawdown(deals, since, null);
  const totalNet = closedPositionSummary.totalNetProfit;
  const lifetimeTradeActivityPercent = computeTradeActivityPercent(allClosedPositions, reportTime);
  const lifetimeTradesPerWeek = computeTradesPerWeek(allClosedPositions, reportTime);
  const lifetimeAverageHoldHours = computeAverageHoldHours(allClosedPositions);
  const largestProfitTrade = closedPositionSummary.largestProfitTrade;
  const largestLossTrade = closedPositionSummary.largestLossTrade;

  const positionsPayload: PositionsResponse = {
    timeframe,
    account,
    summary: {
      dealCount: closedPositionSummary.totalTrades,
      totalTrades: closedPositionSummary.totalTrades,
      tradeActivityPercent: lifetimeTradeActivityPercent,
      tradesPerWeek: lifetimeTradesPerWeek,
      averageProfitTrade: closedPositionSummary.averageProfitTrade,
      longTradesTotal: closedPositionSummary.longTradesTotal,
      shortTradesTotal: closedPositionSummary.shortTradesTotal,
      longTradeWin: getLongTradeWinPercent(scopedClosedPositions),
      shortTradeWin: getShortTradeWinPercent(scopedClosedPositions),
      averageHoldHours: lifetimeAverageHoldHours,
      profitFactor: closedPositionSummary.profitFactor,
      recoveryFactor: positionsDrawdown.maximalAmount > 0 ? totalNet / positionsDrawdown.maximalAmount : null,
      sharpeRatio: computeSharpeRatio(positionNetValues),
      expectedPayoff: closedPositionSummary.expectedPayoff,
      maxConsecutiveProfitAmount: positionRunAmounts.maxConsecutiveProfitAmount,
      maxConsecutiveLossAmount: positionRunAmounts.maxConsecutiveLossAmount,
      largestProfitTrade,
      largestLossTrade,
      maximumConsecutiveWins: closedPositionSummary.maximumConsecutiveWins,
      maximumConsecutiveLosses: closedPositionSummary.maximumConsecutiveLosses,
      symbolTradePercent: buildSymbolTradePercent(scopedClosedPositions),
      totalWinningPips,
      totalLosingPips,
      netPips,
      averageWinningPips,
      totalVolume,
      openCount: openPositionsPayload.length,
      floatingProfit: openPositionsPayload.reduce((total, position) => total + Number(position.floatingProfit ?? 0), 0),
    },
    openPositions: openPositionsPayload,
    workingOrders: [],
    openBySymbol,
    historyPositions: historyPositions as any,
    recentDeals: recentPositionDeals as any,
  };

  const tradingDealsForProfit = tradingDeals.map((trade) => ({
    ...trade,
    pnl: dealNet(trade),
  }));
  const netProfit = tradingDealsForProfit.reduce((total, trade) => total + trade.pnl, 0);
  const grossProfit = tradingDealsForProfit.filter((trade) => trade.pnl > 0).reduce((total, trade) => total + trade.pnl, 0);

  const bySymbolMap = new Map<string, { symbol: string; trades: number; netProfit: number; wins: number }>();
  for (const trade of tradingDealsForProfit) {
    const symbol = trade.symbol || "UNKNOWN";
    let current = bySymbolMap.get(symbol);
    if (!current) {
      current = { symbol, trades: 0, netProfit: 0, wins: 0 };
      bySymbolMap.set(symbol, current);
    }
    current.trades += 1;
    current.netProfit += trade.pnl;
    if (trade.pnl > 0) {
      current.wins += 1;
    }
  }

  const bySymbol = Array.from(bySymbolMap.values())
    .map((item) => ({
      symbol: item.symbol,
      trades: item.trades,
      netProfit: item.netProfit,
      avgTrade: item.trades > 0 ? item.netProfit / item.trades : 0,
      winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
    }))
    .sort((left, right) => Math.abs(right.netProfit) - Math.abs(left.netProfit));

  const recentDeals = [...tradingDealsForProfit]
    .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
    .slice(0, 8)
    .map((trade) => ({
      dealId: trade.dealNo ?? "",
      symbol: trade.symbol || "UNKNOWN",
      side: trade.direction ?? trade.type,
      volume: trade.volume ?? 0,
      time: trade.time,
      price: trade.price == null ? null : Number(trade.price),
      pnl: trade.pnl,
    }));

  const profitDetail: ProfitDetailResponse = {
    timeframe,
    account,
    summary: {
      netProfit,
      grossProfit,
      grossLoss,
      totalCommission: tradingDealsForProfit.reduce((total, trade) => total + Number(trade.commission ?? 0), 0),
      totalSwap: tradingDealsForProfit.reduce((total, trade) => total + Number(trade.swap ?? 0), 0),
      totalDeposit: fundingTotals.totalDeposit,
      totalWithdrawal: fundingTotals.totalWithdraw,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      dailyProfit: buildDailyProfitSeries(scopedDeals, 5, reportTime),
    },
    bySymbol,
    recentDeals: recentDeals as any,
  };

  const totalTrades = closedPositionSummary.totalTrades;

  const winBySymbolMap = new Map<string, { symbol: string; trades: number; wins: number; netProfit: number }>();
  for (const trade of scopedPositionTrades) {
    const symbol = trade.symbol || "UNKNOWN";
    let current = winBySymbolMap.get(symbol);
    if (!current) {
      current = { symbol, trades: 0, wins: 0, netProfit: 0 };
      winBySymbolMap.set(symbol, current);
    }
    current.trades += 1;
    current.netProfit += trade.pnl;
    if (trade.pnl > 0) {
      current.wins += 1;
    }
  }

  const winBySymbol = Array.from(winBySymbolMap.values())
    .map((item) => ({
      symbol: item.symbol,
      trades: item.trades,
      netProfit: item.netProfit,
      winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
    }))
    .sort((left, right) => right.winRate - left.winRate);

  const bySideMap = new Map<string, { side: string; trades: number; wins: number; netProfit: number }>();
  for (const trade of scopedPositionTrades) {
    const side = trade.side || "unknown";
    let current = bySideMap.get(side);
    if (!current) {
      current = { side, trades: 0, wins: 0, netProfit: 0 };
      bySideMap.set(side, current);
    }
    current.trades += 1;
    current.netProfit += trade.pnl;
    if (trade.pnl > 0) {
      current.wins += 1;
    }
  }

  const bySide = Array.from(bySideMap.values()).map((item) => ({
    side: item.side,
    trades: item.trades,
    netProfit: item.netProfit,
    winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
  }));

  const outcomeSeries = [...scopedPositionTrades]
    .slice(-30)
    .map((trade) => ({
      x: toIso(trade.time),
      y: trade.pnl,
    }));

  const streakAverages = computeAverageStreaks(positionNetValues);
  const hasTrades = totalTrades > 0;
  const sharpeRatio = computeSharpeRatio(positionNetValues);

  const winDetail: WinDetailResponse = {
    timeframe,
    account,
    summary: {
      winRate: closedPositionSummary.winPercent,
      wins: closedPositionSummary.profitTradesCount,
      losses: closedPositionSummary.lossTradesCount,
      longTradeWin: getLongTradeWinPercent(scopedClosedPositions),
      shortTradeWin: getShortTradeWinPercent(scopedClosedPositions),
      largestProfitTrade,
      largestLossTrade,
      sharpeRatio,
      profitFactor: closedPositionSummary.profitFactor,
      recoveryFactor: positionsDrawdown.maximalAmount > 0 ? totalNet / positionsDrawdown.maximalAmount : null,
      expectedPayoff: closedPositionSummary.expectedPayoff,
      maximumConsecutiveWins: hasTrades ? closedPositionSummary.maximumConsecutiveWins : null,
      maximumConsecutiveLosses: hasTrades ? closedPositionSummary.maximumConsecutiveLosses : null,
      maximumConsecutiveProfitAmount: positionRunAmounts.maxConsecutiveProfitAmount,
      averageConsecutiveWins: hasTrades ? streakAverages.averageWins : null,
      averageConsecutiveLosses: hasTrades ? streakAverages.averageLosses : null,
    },
    bySymbol: winBySymbol,
    bySide,
    outcomeSeries,
  };

  return {
    overview,
    balanceDetail,
    growth,
    positions: positionsPayload,
    profitDetail,
    winDetail,
    pipsSummary,
  } satisfies CachedTimeframeViews;
}

async function rebuildAccountCache(accountId: string, versionKey: string): Promise<AccountPreaggregatedBundle | null> {
  const bundle = await getAccountBundle(accountId);
  if (!bundle) {
    accountCache.delete(accountId);
    return null;
  }

  const account = serializeAccountBundle(bundle);
  if (!account) {
    accountCache.delete(accountId);
    return null;
  }

  const reportTime = getAccountAnchorDate(bundle);
  const deals = bundle.account.deals as DealRow[];
  const positions = bundle.account.positions as PositionRow[];
  const openPositions = bundle.account.openPositions as OpenPositionRow[];
  const latestSnapshotBalance = Number(bundle.latestSnapshot?.balance ?? 0);
  const latestSnapshotEquity = Number(bundle.latestSnapshot?.equity ?? 0);
  const latestSnapshotMargin = Number(bundle.latestSnapshot?.margin ?? 0);

  const cached: AccountPreaggregatedBundle = {
    accountId,
    versionKey,
    lastCheckedAt: Date.now(),
    source: {
      account,
      deals,
      positions,
      openPositions,
      latestSnapshotBalance,
      latestSnapshotEquity,
      latestSnapshotMargin,
      reportTime,
    },
    timeframes: {},
  };

  accountCache.set(accountId, cached);
  enforceAccountCacheLimit();
  return cached;
}

async function getAccountPreaggregatedBundle(accountId: string) {
  const existing = accountCache.get(accountId);
  const now = Date.now();

  if (existing && now - existing.lastCheckedAt < ACCOUNT_CACHE_REVALIDATE_MS) {
    return existing;
  }

  const probe = await getAccountVersionProbe(accountId);
  if (!probe) {
    accountCache.delete(accountId);
    return null;
  }

  if (existing && existing.versionKey === probe.versionKey) {
    existing.lastCheckedAt = now;
    return existing;
  }

  return rebuildAccountCache(accountId, probe.versionKey);
}

export type AccountCachedViewKind =
  | "overview"
  | "balanceDetail"
  | "growth"
  | "positions"
  | "profitDetail"
  | "winDetail"
  | "pipsSummary";

export function parseRequestTimeframe(rawTimeframe: string | null) {
  return rawTimeframe === null ? "1d" : parseTimeframe(rawTimeframe);
}

export async function getCachedAccountView(accountId: string, timeframe: Timeframe, kind: AccountCachedViewKind) {
  const cached = await getAccountPreaggregatedBundle(accountId);
  if (!cached) {
    return null;
  }

  const timeframeView = cached.timeframes[timeframe] ?? buildTimeframeView({
    ...cached.source,
    timeframe,
  });
  cached.timeframes[timeframe] = timeframeView;

  return timeframeView[kind];
}

export function warmAccountOverviewCaches(accountIds: string[]) {
  for (const accountId of accountIds) {
    void getCachedAccountView(accountId, "all", "overview");
  }
}
