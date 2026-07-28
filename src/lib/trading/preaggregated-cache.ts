import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  endOfBangkokMonth,
  getBangkokMonthIndex,
  getBangkokYear,
  startOfBangkokMonth,
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
  computeAbsoluteGain,
  computeAllTimeGrowth,
  computeAverageHoldHours,
  computeBalanceDrawdown,
  computeCompoundedGrowth,
  computeAverageStreaks,
  computeConsecutiveRunAmounts,
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
  isTradingDeal,
  normalizeTradeSide,
  parseTimeframe,
  positionNetPnl,
  serializeAccountBundle,
  serializeOpenPositions,
  summarizeClosedPositions,
  summarizeTrades,
} from "@/lib/trading/account-data";
import {
  computeAHPR,
  computeGHPR,
  computeHoldingPeriodReturns,
  computeTradeActivityPercent,
  computeZScore,
  summarizeHoldingTime,
} from "@/lib/trading/analytics";
import {
  buildTradeDistributionDetail,
  computeLinearRegression,
} from "@/lib/trading/trade-distributions";
import {
  createProcessLocalReportViewCache,
  getCachedTimeframeView,
  setCachedTimeframeView,
} from "@/lib/trading/report-view-cache";

// Re-exported clusters, split out of this file. See CLAUDE.md / that folder
// for the module layout. Everything below this block is the cache engine
// itself (module-level mutable state) and stays here.
export {
  parsePositionHistoryPageOptions,
  paginatePositionsResponse,
  type PositionHistoryPageOptions,
} from "./preaggregated/positions";
export { buildRealtime24HourBalanceCurve } from "./preaggregated/balance-curve-24h";
export { buildPipsSummaryRows } from "./preaggregated/pips-summary";
export {
  buildAlgoTradingSummary,
  maxAllTimeDepositLoad,
  maxPersistedDepositLoad,
} from "./preaggregated/algo-summary";
export { buildTradeExecutionDistribution } from "./preaggregated/trade-execution";

import { getPositionPips } from "./preaggregated/positions";
import { buildRealtime24HourBalanceCurve } from "./preaggregated/balance-curve-24h";
import { buildPipsSummaryRows } from "./preaggregated/pips-summary";
import {
  buildAlgoTradingSummary,
  maxAllTimeDepositLoad,
  maxPersistedDepositLoad,
} from "./preaggregated/algo-summary";
import { buildTradeExecutionDistribution } from "./preaggregated/trade-execution";

const ACCOUNT_CACHE_REVALIDATE_MS = 5_000;
const MONTH_LABELS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, index, 1))),
);

export type DealRow = {
  time: Date | string;
  type?: string | null;
  direction?: string | null;
  comment?: string | null;
  symbol?: string | null;
  volume?: number | null;
  price?: number | null;
  profit?: number | null;
  commission?: number | null;
  fee?: number | null;
  swap?: number | null;
  dealId?: string;
  dealNo?: string;
  balanceAfter?: number | null;
  balance?: number | null;
};

export type PositionRow = {
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
  mae?: number | null;
  mfe?: number | null;
  comment?: string | null;
  magic?: number | null;
};

type OrderRow = {
  orderTicket?: string | null;
  positionId?: string | null;
  symbol?: string | null;
  sl?: number | null;
  tp?: number | null;
};

type OpenPositionRow = {
  reportDate?: Date | string | null;
  profit?: number | null;
  floatingProfit?: number | null;
  floating_profit?: number | null;
  symbol?: string | null;
  type?: string | null;
  volume?: number | null;
};

function mapEquitySnapshots(
  rows: Array<{
    ts?: Date | string;
    equity?: any;
    margin?: any;
    depositLoad?: any;
    maxDepositLoad?: any;
  }>,
): EquitySnapshotRow[] {
  return rows.map((r) => ({
    ts: r.ts as Date,
    equity: Number(r.equity),
    margin: Number(r.margin),
    depositLoad: r.depositLoad == null ? null : Number(r.depositLoad),
    maxDepositLoad:
      r.maxDepositLoad == null ? null : Number(r.maxDepositLoad),
  }));
}

function toIso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
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

type EquitySnapshotRow = {
  ts: Date;
  equity: number;
  margin: number;
  depositLoad: number | null;
  maxDepositLoad: number | null;
};

type AccountPreaggregatedSource = {
  account: NonNullable<ReturnType<typeof serializeAccountBundle>>;
  deals: DealRow[];
  positions: PositionRow[];
  orders: OrderRow[];
  openPositions: OpenPositionRow[];
  equitySnapshots: EquitySnapshotRow[];
  latestSnapshotBalance: number;
  latestSnapshotEquity: number;
  latestSnapshotMargin: number;
  reportTime: Date;
  tradeExecutions: TradeExecutionDistribution;
  pipsSummaryRows: ReturnType<typeof buildPipsSummaryRows>;
  monthlyGrowthSeries: Array<{ month: string; value: number }>;
  accountReportResult: {
    totalNetProfit: Prisma.Decimal | null;
    sourceReportDate: Date | null;
  } | null;
};

type AccountPreaggregatedBundle = {
  accountId: string;
  // Everything except the latest EquitySnapshot timestamp. EquitySnapshot writes
  // land on their own ~60s cadence and must not force a full rebuild of the
  // equity-independent aggregates below.
  aggregateVersionKey: string;
  equityVersionKey: string;
  lastCheckedAt: number;
  source: AccountPreaggregatedSource;
  timeframes: Partial<Record<Timeframe, CachedTimeframeViews>>;
};

const accountCache = new Map<string, AccountPreaggregatedBundle>();
const accountCacheBuilds = new Map<
  string,
  Promise<AccountPreaggregatedBundle | null>
>();
const CACHE_MAX_ENTRIES = 500; // Prevent unbounded growth

function enforceAccountCacheLimit() {
  if (accountCache.size > CACHE_MAX_ENTRIES) {
    const entriesToDelete = accountCache.size - CACHE_MAX_ENTRIES + 50; // Delete 50 oldest when over limit
    const entries = Array.from(accountCache.entries()).sort(
      (a, b) => a[1].lastCheckedAt - b[1].lastCheckedAt,
    );
    for (let i = 0; i < entriesToDelete && i < entries.length; i++) {
      accountCache.delete(entries[i][0]);
    }
  }
}

type AccountVersionProbe = {
  accountId: string;
  aggregateVersionKey: string;
  equityVersionKey: string;
};

export function buildAccountAggregateVersionKey(account: {
  id: string;
  updatedAt?: Date | null;
  reportDate?: Date | null;
  accountSnapshot?: { updatedAt?: Date | null; reportDate?: Date | null } | null;
  accountReportResult?: {
    computedAt?: Date | null;
    sourceReportDate?: Date | null;
  } | null;
  latestDealTime?: Date | null;
  latestPositionCloseTime?: Date | null;
}) {
  return [
    account.id,
    account.updatedAt?.toISOString() ?? "0",
    account.reportDate?.toISOString() ?? "0",
    account.accountSnapshot?.updatedAt?.toISOString() ?? "0",
    account.accountSnapshot?.reportDate?.toISOString() ?? "0",
    account.accountReportResult?.computedAt?.toISOString() ?? "0",
    account.accountReportResult?.sourceReportDate?.toISOString() ?? "0",
    account.latestDealTime?.toISOString() ?? "0",
    account.latestPositionCloseTime?.toISOString() ?? "0",
  ].join("|");
}

async function getAccountVersionProbe(
  accountId: string,
): Promise<AccountVersionProbe | null> {
  const account = await prisma.tradingAccount.findFirst({
    where: { OR: [{ id: accountId }, { accountNo: accountId }] },
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
      deals: {
        select: { time: true },
        orderBy: { time: "desc" },
        take: 1,
      },
      positions: {
        select: { closeTime: true },
        orderBy: { closeTime: "desc" },
        take: 1,
      },
      equitySnapshots: {
        select: {
          ts: true,
        },
        orderBy: { ts: "desc" },
        take: 1,
      },
    },
  });

  if (!account) {
    return null;
  }

  const latestEquitySnapshot = account.equitySnapshots[0];
  const aggregateVersionKey = buildAccountAggregateVersionKey({
    id: account.id,
    updatedAt: account.updatedAt,
    reportDate: account.reportDate,
    accountSnapshot: account.accountSnapshot,
    accountReportResult: account.accountReportResult,
    latestDealTime: account.deals[0]?.time ?? null,
    latestPositionCloseTime: account.positions[0]?.closeTime ?? null,
  });
  const equityVersionKey = latestEquitySnapshot?.ts?.toISOString() ?? "0";

  return {
    accountId: account.id,
    aggregateVersionKey,
    equityVersionKey,
  };
}

function buildMonthlyGrowthSeries(deals: DealRow[], reportTime: Date) {
  const year = getBangkokYear(reportTime) ?? reportTime.getUTCFullYear();
  return Array.from({ length: 12 }, (_, index) => {
    const start =
      startOfBangkokMonth(new Date(Date.UTC(year, index, 1))) ??
      new Date(Date.UTC(year, index, 1));
    const end = endOfBangkokMonth(start) ?? start;
    return {
      month: MONTH_LABELS[getBangkokMonthIndex(start) ?? index] ?? "",
      value: computeCompoundedGrowth(deals, start, end),
    };
  });
}

function buildTimeframeView(
  params: AccountPreaggregatedSource & { timeframe: Timeframe },
) {
  const {
    timeframe,
    account,
    deals,
    positions,
    orders,
    openPositions,
    equitySnapshots,
    latestSnapshotBalance,
    reportTime,
  } = params;

  const since = getSinceDate(timeframe, reportTime);
  const scopedDeals = filterBySince(deals, (deal) => deal.time, since);
  const tradingDeals = scopedDeals.filter((deal) => isTradingDeal(deal));
  const sortedScopedDeals = [...scopedDeals].sort(
    (left, right) =>
      new Date(left.time).getTime() - new Date(right.time).getTime(),
  );
  const scopedPositions = filterBySince(
    positions,
    (position) => position.closeTime,
    since,
  );
  const scopedClosedPositions = scopedPositions.filter((position) =>
    isClosedPosition(position),
  );
  const closedPositionSummary = summarizeClosedPositions(scopedClosedPositions);
  const tradeDistributionDetail = buildTradeDistributionDetail(
    scopedClosedPositions,
  );

  const scopedPositionPips = scopedClosedPositions
    .map((position) => getPositionPips(position))
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

  const averageWinningPips =
    winningPipCount > 0 ? totalWinningPips / winningPipCount : null;
  const totalVolume = scopedClosedPositions.reduce(
    (total, position) => total + Number(position.volume ?? 0),
    0,
  );

  const pipsSummary: PipsSummaryResponse = {
    timeframe,
    account,
    rows: params.pipsSummaryRows,
  };

  const endingBalance =
    Number.isFinite(latestSnapshotBalance) && latestSnapshotBalance > 0
      ? latestSnapshotBalance
      : account.balance;
  const balanceCurve =
    timeframe === "1d"
      ? buildRealtime24HourBalanceCurve(
          deals,
          reportTime,
          endingBalance,
        )
      : buildBalanceCurve(deals, since);
  const periodGrowth =
    timeframe === "all"
      ? computeAllTimeGrowth(deals)
      : computeCompoundedGrowth(deals, since, null);
  const drawdown = computeBalanceDrawdown(deals, since, null);
  const outcomeSummary = summarizeTrades(tradingDeals);
  const grossLoss = Math.abs(
    tradingDeals
      .filter((trade) => dealNet(trade) < 0)
      .reduce((total, trade) => total + dealNet(trade), 0),
  );
  const fundingTotals = buildFundingTotals(scopedDeals);
  const tradeExecutions = params.tradeExecutions;
  const openPositionsPayload = serializeOpenPositions(openPositions as any);
  const openBySymbolMap = new Map<
    string,
    { symbol: string; count: number; volume: number; floatingProfit: number }
  >();
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

  const openBySymbol = Array.from(openBySymbolMap.values()).sort(
    (left, right) =>
      Math.abs(right.floatingProfit) - Math.abs(left.floatingProfit),
  );

  const noActivity =
    tradingDeals.length === 0 && closedPositionSummary.totalTrades === 0;

  const overview: AccountOverviewResponse = {
    timeframe,
    account,
    kpis: {
      periodGrowth: noActivity ? null : periodGrowth,
      netProfit: noActivity ? null : outcomeSummary.netProfit,
      grossLoss,
      totalSwap: tradingDeals.reduce(
        (total, trade) => total + Number(trade.swap ?? 0),
        0,
      ),
      totalCommission: tradingDeals.reduce(
        (total, trade) => total + Number(trade.commission ?? 0),
        0,
      ),
      totalDeposit: fundingTotals.totalDeposit,
      totalWithdrawal: fundingTotals.totalWithdraw,
      drawdown: noActivity ? null : drawdown.relativePercent,
      absoluteDrawdown: drawdown.absoluteAmount,
      winPercent: closedPositionSummary.winPercent,
      netPips: noActivity ? null : netPips,
      totalWinningPips,
      trades: noActivity ? null : closedPositionSummary.totalTrades,
      floatingPL: openPositions.reduce(
        (total, position) => total + Number(position.profit ?? 0),
        0,
      ),
      openCount: openPositions.length,
    },
    openPositions: openPositionsPayload,
    openBySymbol,
    balanceCurve: balanceCurve.map((point) => ({
      x: toIso(point.time),
      y: point.balance,
      balance: point.balance,
      eventType: point.eventType ?? null,
      eventDelta: point.eventDelta ?? null,
    })),
    tradeExecutions,
    totalNetProfit:
      params.accountReportResult?.totalNetProfit == null
        ? null
        : Number(params.accountReportResult.totalNetProfit),
    sourceReportDate: params.accountReportResult?.sourceReportDate
      ? params.accountReportResult.sourceReportDate.toISOString()
      : null,
  };

  const unitDrawdownCurve = buildUnitDrawdownCurve(deals, since, null);
  const scopedEquitySnapshots = since
    ? equitySnapshots.filter((r) => r.ts >= since)
    : equitySnapshots;
  // INTERIM: broker-margin-derived peak, not the XAUUSD-volume-derived product
  // metric used for the live value — see maxPersistedDepositLoad's note.
  // "all" reads the persisted running high-water mark so the peak isn't
  // bounded by EquitySnapshot's 7-day row retention; scoped timeframes stay
  // on the reduce over retained instantaneous readings.
  const maximalDepositLoad =
    timeframe === "all"
      ? maxAllTimeDepositLoad(scopedEquitySnapshots)
      : maxPersistedDepositLoad(scopedEquitySnapshots);
  const runAmounts = computeConsecutiveRunAmounts(
    sortedScopedDeals
      .filter((deal) => isTradingDeal(deal))
      .map((deal) => dealNet(deal)),
  );

  // Risk-adjusted KPIs scoped to the selected timeframe.
  const balanceDetailTotalNet = closedPositionSummary.totalNetProfit;

  // No drawdown but positive net = "perfect" recovery; surface as Infinity so the
  // gauge picks the "great" zone instead of "NO DATA".
  let balanceDetailRecoveryFactor: number | null = null;
  if (drawdown.maximalAmount > 0) {
    balanceDetailRecoveryFactor =
      balanceDetailTotalNet / drawdown.maximalAmount;
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
  if (
    balanceDetailProfitFactor === null &&
    closedPositionSummary.grossProfit > 0 &&
    closedPositionSummary.grossLoss === 0
  ) {
    balanceDetailProfitFactor = Number.POSITIVE_INFINITY;
  }

  const balanceDetailLrRegression = computeLinearRegression(
    balanceCurve.map((point, index) => ({ x: index, y: point.balance })),
  );

  const balanceDetail: BalanceDetailResponse = {
    timeframe,
    account,
    summary: {
      absoluteDrawdown: drawdown.absoluteAmount,
      relativeDrawdownPct: drawdown.relativePercent,
      maximalDrawdownAmount: drawdown.maximalAmount,
      maximalDrawdownPct: drawdown.maximalPercent,
      averageLossTrade: closedPositionSummary.averageLossTrade,
      maximalDepositLoad: maximalDepositLoad,
      maximumConsecutiveLossAmount: runAmounts.maxConsecutiveLossAmount,
      sharpeRatio: balanceDetailSharpeRatio,
      profitFactor: balanceDetailProfitFactor,
      recoveryFactor: balanceDetailRecoveryFactor,
      lrCorrelation: balanceDetailLrRegression?.correlation ?? null,
      lrStandardError: balanceDetailLrRegression?.residualStandardError ?? null,
    },
    tradeDistributions: tradeDistributionDetail,
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

  const year = getBangkokYear(reportTime) ?? reportTime.getUTCFullYear();
  const allTimeGrowth = computeAllTimeGrowth(deals);
  const ytdGrowth = computeYearGrowth(deals, year);
  const allTimeAbsoluteGain = computeAbsoluteGain(deals, null);
  const absoluteGain =
    timeframe === "all"
      ? allTimeAbsoluteGain
      : computeAbsoluteGain(deals, since, null);

  const monthly = params.monthlyGrowthSeries;

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
    if (!isTradingDeal(deal)) continue;
    const dir = (deal.direction ?? "").toLowerCase().trim();
    if (dir !== "in" && dir !== "out") continue;
    if (!deal.symbol || !deal.time) continue;
    const secs = Math.floor(new Date(deal.time).getTime() / 1000);
    const timeKey = `${deal.symbol}:${secs}`;
    const entry: DealEntry = { comment: deal.comment ?? null };
    const byPriceKey = dir === "in" ? openingByPriceKey : closingByPriceKey;
    const queueByTimeKey =
      dir === "in" ? openingQueueByTimeKey : closingQueueByTimeKey;
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
  const upsertOrder = (map: Map<string, OrderRow>, key: string, order: OrderRow) => {
    const current = map.get(key);
    if (
      !current ||
      (order.sl && Number(order.sl) !== 0) ||
      (order.tp && Number(order.tp) !== 0)
    ) {
      map.set(key, order);
    }
  };
  const orderByPositionId = new Map<string, OrderRow>();
  const orderByTicket = new Map<string, OrderRow>();
  for (const order of orders) {
    if (order.positionId) {
      upsertOrder(orderByPositionId, order.positionId, order);
    }
    if (order.orderTicket) {
      upsertOrder(orderByTicket, order.orderTicket, order);
    }
  }

  function getPositionOrder(positionNo: string | undefined) {
    if (!positionNo) {
      return undefined;
    }

    return orderByPositionId.get(positionNo) ?? orderByTicket.get(positionNo);
  }

  function numberOrNull(value: number | null | undefined) {
    return value == null ? null : Number(value);
  }

  const orderedScopedPositions = [...scopedClosedPositions].sort(
    (left, right) =>
      new Date(left.closeTime ?? 0).getTime() -
      new Date(right.closeTime ?? 0).getTime(),
  );
  const historyPositions = [...orderedScopedPositions]
    .sort((left, right) => {
      const timeDelta =
        new Date(right.closeTime ?? right.reportDate ?? 0).getTime() -
        new Date(left.closeTime ?? left.reportDate ?? 0).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return String(right.positionNo ?? "").localeCompare(
        String(left.positionNo ?? ""),
      );
    })
    .map((position) => {
      const openMs = position.openTime
        ? new Date(position.openTime).getTime()
        : null;
      const closeMs = position.closeTime
        ? new Date(position.closeTime).getTime()
        : null;
      const openPriceNum =
        position.openPrice == null ? null : Number(position.openPrice);
      const closePriceNum =
        position.closePrice == null ? null : Number(position.closePrice);

      const openingComment = lookupDealComment(
        openingByPriceKey,
        openingQueueByTimeKey,
        position.symbol,
        openMs,
        openPriceNum,
      );
      const closingComment = lookupDealComment(
        closingByPriceKey,
        closingQueueByTimeKey,
        position.symbol,
        closeMs,
        closePriceNum,
      );

      const comment = openingComment ?? null;
      const positionOrder = getPositionOrder(position.positionNo);

      let sl = numberOrNull(position.sl) ?? numberOrNull(positionOrder?.sl);
      let tp = numberOrNull(position.tp) ?? numberOrNull(positionOrder?.tp);
      let slHit = false;
      let tpHit = false;
      let exitReason: string | null = null;
      if (closingComment) {
        const slMatch = SL_TAG_RE.exec(closingComment);
        if (slMatch) {
          const parsed = Number(slMatch[1]);
          if (Number.isFinite(parsed)) sl = parsed;
          slHit = true;
          exitReason = "SL";
        }
        const tpMatch = TP_TAG_RE.exec(closingComment);
        if (tpMatch) {
          const parsed = Number(tpMatch[1]);
          if (Number.isFinite(parsed)) tp = parsed;
          tpHit = true;
          exitReason = "TP";
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
        commission:
          position.commission == null ? null : Number(position.commission),
        pips: getPositionPips(position),
        mae: position.mae == null ? null : Number(position.mae),
        mfe: position.mfe == null ? null : Number(position.mfe),
        comment,
        exitReason,
        slHit,
        tpHit,
        magic: numberOrNull(position.magic),
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
    .sort(
      (left, right) =>
        new Date(right.time).getTime() - new Date(left.time).getTime(),
    )
    .slice(0, 30);
  const positionNetValues = closedPositionSummary.netValues;
  const positionRunAmounts = computeConsecutiveRunAmounts(positionNetValues);
  const positionsDrawdown = computeBalanceDrawdown(deals, since, null);
  const totalNet = closedPositionSummary.totalNetProfit;
  const lifetimeTradeActivityPercent = computeTradeActivityPercent(
    scopedClosedPositions,
    reportTime,
    since,
  );
  const algoTradingSummary = buildAlgoTradingSummary(scopedClosedPositions);
  const lifetimeTradesPerWeek = computeTradesPerWeek(
    scopedClosedPositions,
    reportTime,
  );
  const lifetimeAverageHoldHours = computeAverageHoldHours(
    scopedClosedPositions,
  );
  const largestProfitTrade = closedPositionSummary.largestProfitTrade;
  const largestLossTrade = closedPositionSummary.largestLossTrade;
  const positionsHoldingTime = summarizeHoldingTime(scopedClosedPositions);
  const positionsZScore = computeZScore(positionNetValues);
  const positionsHoldingPeriodReturns = computeHoldingPeriodReturns(
    balanceCurve.map((point) => ({
      balance: point.balance,
      eventDelta: point.eventDelta ?? 0,
      eventType: point.eventType ?? null,
    })),
  );
  const correlationProfitMfe = tradeDistributionDetail.available
    ? (tradeDistributionDetail.regressions.mfeProfit?.correlation ?? null)
    : null;
  const correlationProfitMae = tradeDistributionDetail.available
    ? (tradeDistributionDetail.regressions.maeProfit?.correlation ?? null)
    : null;
  const correlationMfeMae = tradeDistributionDetail.available
    ? (tradeDistributionDetail.regressions.mfeMae?.correlation ?? null)
    : null;

  const positionsPayload: PositionsResponse = {
    timeframe,
    account,
    summary: {
      dealCount: closedPositionSummary.totalTrades,
      totalTrades: closedPositionSummary.totalTrades,
      tradeActivityPercent: lifetimeTradeActivityPercent,
      ...algoTradingSummary,
      tradesPerWeek: lifetimeTradesPerWeek,
      averageProfitTrade: closedPositionSummary.averageProfitTrade,
      averageLossTrade: closedPositionSummary.averageLossTrade,
      longTradesTotal: closedPositionSummary.longTradesTotal,
      shortTradesTotal: closedPositionSummary.shortTradesTotal,
      longTradeWin: getLongTradeWinPercent(scopedClosedPositions),
      shortTradeWin: getShortTradeWinPercent(scopedClosedPositions),
      averageHoldHours: lifetimeAverageHoldHours,
      profitFactor: closedPositionSummary.profitFactor,
      recoveryFactor:
        positionsDrawdown.maximalAmount > 0
          ? totalNet / positionsDrawdown.maximalAmount
          : null,
      sharpeRatio: computeSharpeRatio(positionNetValues),
      expectedPayoff: closedPositionSummary.expectedPayoff,
      maxConsecutiveProfitAmount: positionRunAmounts.maxConsecutiveProfitAmount,
      maxConsecutiveLossAmount: positionRunAmounts.maxConsecutiveLossAmount,
      maxConsecutiveProfitTrades: positionRunAmounts.maxConsecutiveProfitTrades,
      maxConsecutiveLossTrades: positionRunAmounts.maxConsecutiveLossTrades,
      largestProfitTrade,
      largestLossTrade,
      maximumConsecutiveWins: closedPositionSummary.maximumConsecutiveWins,
      maximumConsecutiveLosses: closedPositionSummary.maximumConsecutiveLosses,
      profitTradesCount:
        closedPositionSummary.totalTrades > 0
          ? closedPositionSummary.profitTradesCount
          : null,
      lossTradesCount:
        closedPositionSummary.totalTrades > 0
          ? closedPositionSummary.lossTradesCount
          : null,
      ahpr: computeAHPR(positionsHoldingPeriodReturns),
      ghpr: computeGHPR(positionsHoldingPeriodReturns),
      zScore: positionsZScore,
      correlationProfitMfe,
      correlationProfitMae,
      correlationMfeMae,
      minHoldingSeconds: positionsHoldingTime.minHoldingSeconds,
      maxHoldingSeconds: positionsHoldingTime.maxHoldingSeconds,
      avgHoldingSeconds: positionsHoldingTime.avgHoldingSeconds,
      symbolTradePercent: buildSymbolTradePercent(scopedClosedPositions),
      totalWinningPips,
      totalLosingPips,
      netPips,
      averageWinningPips,
      totalVolume,
      openCount: openPositionsPayload.length,
      floatingProfit: openPositionsPayload.reduce(
        (total, position) => total + Number(position.floatingProfit ?? 0),
        0,
      ),
    },
    openPositions: openPositionsPayload,
    openBySymbol,
    historyPositions: historyPositions as any,
    historyPage: {
      total: historyPositions.length,
      limit: historyPositions.length,
      hasMore: false,
      nextCursor: null,
    },
    recentDeals: recentPositionDeals as any,
  };

  const tradingDealsForProfit = tradingDeals.map((trade) => ({
    ...trade,
    pnl: dealNet(trade),
  }));
  const netProfit = tradingDealsForProfit.reduce(
    (total, trade) => total + trade.pnl,
    0,
  );
  const grossProfit = tradingDealsForProfit
    .filter((trade) => trade.pnl > 0)
    .reduce((total, trade) => total + trade.pnl, 0);

  const bySymbolMap = new Map<
    string,
    { symbol: string; trades: number; netProfit: number; wins: number }
  >();
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
    .sort(
      (left, right) => Math.abs(right.netProfit) - Math.abs(left.netProfit),
    );

  const recentDeals = [...tradingDealsForProfit]
    .sort(
      (left, right) =>
        new Date(right.time).getTime() - new Date(left.time).getTime(),
    )
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
      totalCommission: tradingDealsForProfit.reduce(
        (total, trade) => total + Number(trade.commission ?? 0),
        0,
      ),
      totalSwap: tradingDealsForProfit.reduce(
        (total, trade) => total + Number(trade.swap ?? 0),
        0,
      ),
      totalDeposit: fundingTotals.totalDeposit,
      totalWithdrawal: fundingTotals.totalWithdraw,
      profitFactor: closedPositionSummary.profitFactor,
      dailyProfit: buildDailyProfitSeries(scopedDeals, 5, reportTime),
    },
    bySymbol,
    recentDeals: recentDeals as any,
  };

  const totalTrades = closedPositionSummary.totalTrades;

  const accumulateByKey = (
    trades: typeof scopedPositionTrades,
    keyFn: (trade: typeof scopedPositionTrades[0]) => string,
  ) => {
    const map = new Map<
      string,
      { key: string; trades: number; wins: number; netProfit: number }
    >();
    for (const trade of trades) {
      const key = keyFn(trade);
      let current = map.get(key);
      if (!current) {
        current = { key, trades: 0, wins: 0, netProfit: 0 };
        map.set(key, current);
      }
      current.trades += 1;
      current.netProfit += trade.pnl;
      if (trade.pnl > 0) {
        current.wins += 1;
      }
    }
    return map;
  };

  const winBySymbolMap = accumulateByKey(
    scopedPositionTrades,
    (t) => t.symbol || "UNKNOWN",
  );
  const winBySymbol = Array.from(winBySymbolMap.values())
    .map((item) => ({
      symbol: item.key,
      trades: item.trades,
      netProfit: item.netProfit,
      winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
    }))
    .sort((left, right) => right.winRate - left.winRate);

  const bySideMap = accumulateByKey(scopedPositionTrades, (t) => t.side || "unknown");
  const bySide = Array.from(bySideMap.values()).map((item) => ({
    side: item.key,
    trades: item.trades,
    netProfit: item.netProfit,
    winRate: item.trades > 0 ? (item.wins / item.trades) * 100 : 0,
  }));

  const outcomeSeries = [...scopedPositionTrades].slice(-30).map((trade) => ({
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
      recoveryFactor:
        positionsDrawdown.maximalAmount > 0
          ? totalNet / positionsDrawdown.maximalAmount
          : null,
      expectedPayoff: closedPositionSummary.expectedPayoff,
      maximumConsecutiveWins: hasTrades
        ? closedPositionSummary.maximumConsecutiveWins
        : null,
      maximumConsecutiveLosses: hasTrades
        ? closedPositionSummary.maximumConsecutiveLosses
        : null,
      maximumConsecutiveProfitAmount:
        positionRunAmounts.maxConsecutiveProfitAmount,
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

async function rebuildAccountCache(
  accountId: string,
  aggregateVersionKey: string,
  equityVersionKey: string,
): Promise<AccountPreaggregatedBundle | null> {
  const bundle = await getAccountBundle(accountId, { allHistory: true });
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
  const orders = bundle.account.orders as OrderRow[];
  const openPositions = bundle.account.openPositions as OpenPositionRow[];
  const equitySnapshots = mapEquitySnapshots(bundle.account.equitySnapshots ?? []);
  const latestSnapshotBalance = Number(bundle.latestSnapshot?.balance ?? 0);
  const latestSnapshotEquity = Number(bundle.latestSnapshot?.equity ?? 0);
  const latestSnapshotMargin = Number(bundle.latestSnapshot?.margin ?? 0);

  // Precompute values that are timeframe-invariant — expensive to repeat per view.
  const tradeExecutions = buildTradeExecutionDistribution(deals, reportTime);
  const pipsSummaryRows = buildPipsSummaryRows(deals, positions, reportTime);
  const monthlyGrowthSeries = buildMonthlyGrowthSeries(deals, reportTime);

  const cached: AccountPreaggregatedBundle = {
    accountId,
    aggregateVersionKey,
    equityVersionKey,
    lastCheckedAt: Date.now(),
    source: {
      account,
      deals,
      positions,
      orders,
      openPositions,
      equitySnapshots,
      latestSnapshotBalance,
      latestSnapshotEquity,
      latestSnapshotMargin,
      reportTime,
      tradeExecutions,
      pipsSummaryRows,
      monthlyGrowthSeries,
      accountReportResult: bundle.account.accountReportResult
        ? {
            totalNetProfit: bundle.account.accountReportResult.totalNetProfit,
            sourceReportDate:
              bundle.account.accountReportResult.sourceReportDate ?? null,
          }
        : null,
    },
    timeframes: {},
  };

  accountCache.set(accountId, cached);
  enforceAccountCacheLimit();
  return cached;
}

/**
 * Refetches only equitySnapshots and patches them into an existing cache entry,
 * skipping the full deals/positions/orders refetch and aggregate recompute that
 * rebuildAccountCache does. Used when only the EquitySnapshot table changed.
 */
async function patchEquitySnapshots(
  existing: AccountPreaggregatedBundle,
  equityVersionKey: string,
): Promise<AccountPreaggregatedBundle> {
  const earliestCachedTs = existing.source.equitySnapshots[0]?.ts ?? new Date(0);
  const rows = await prisma.equitySnapshot.findMany({
    where: { tradingAccountId: existing.accountId, ts: { gte: earliestCachedTs } },
    orderBy: { ts: "asc" },
    select: {
      ts: true,
      equity: true,
      margin: true,
      depositLoad: true,
      maxDepositLoad: true,
    },
  });

  existing.source.equitySnapshots = mapEquitySnapshots(rows);
  existing.equityVersionKey = equityVersionKey;
  existing.lastCheckedAt = Date.now();
  // Equity feeds into timeframe views (e.g. the 1D sparkline); drop the memoized
  // views so they rebuild lazily from source, which reuses the untouched
  // equity-independent aggregates (tradeExecutions/pipsSummaryRows/monthlyGrowthSeries).
  existing.timeframes = {};
  return existing;
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

function getOrBuildTimeframeView(
  bundle: AccountPreaggregatedBundle,
  timeframe: Timeframe,
): CachedTimeframeViews {
  const cached = bundle.timeframes[timeframe];
  if (cached) {
    return cached;
  }

  const view = buildTimeframeView({ ...bundle.source, timeframe });
  bundle.timeframes[timeframe] = view;
  void setCachedTimeframeView(
    bundle.accountId,
    timeframe,
    bundle.aggregateVersionKey,
    bundle.equityVersionKey,
    view,
  );
  return view;
}

const l2ViewReads = new Map<string, Promise<CachedTimeframeViews | null>>();
const processLocalL2Views =
  createProcessLocalReportViewCache<CachedTimeframeViews>({
    ttlMs: ACCOUNT_CACHE_REVALIDATE_MS,
    maxEntries: CACHE_MAX_ENTRIES,
    maxBytes: 16 * 1024 * 1024,
  });

function getDedupedCachedTimeframeView(
  accountId: string,
  timeframe: Timeframe,
  aggregateVersionKey: string,
  equityVersionKey: string,
) {
  const key = `${accountId}:${timeframe}:${aggregateVersionKey}:${equityVersionKey}`;
  const inFlight = l2ViewReads.get(key);
  if (inFlight) {
    return inFlight;
  }

  const read = getCachedTimeframeView<CachedTimeframeViews>(
    accountId,
    timeframe,
    aggregateVersionKey,
    equityVersionKey,
  ).finally(() => {
    l2ViewReads.delete(key);
  });
  l2ViewReads.set(key, read);
  return read;
}

export async function getCachedAccountView(
  accountId: string,
  timeframe: Timeframe,
  kind: AccountCachedViewKind,
) {
  const existing = accountCache.get(accountId);
  const now = Date.now();

  if (existing && now - existing.lastCheckedAt < ACCOUNT_CACHE_REVALIDATE_MS) {
    return getOrBuildTimeframeView(existing, timeframe)[kind];
  }

  const retainedL2 = processLocalL2Views.get(accountId, timeframe);
  if (retainedL2?.view) {
    return retainedL2.view[kind];
  }

  const probe = retainedL2
    ? {
        accountId,
        aggregateVersionKey: retainedL2.aggregateVersionKey,
        equityVersionKey: retainedL2.equityVersionKey,
      }
    : await getAccountVersionProbe(accountId);
  if (!probe) {
    accountCache.delete(accountId);
    processLocalL2Views.delete(accountId);
    return null;
  }

  if (existing && existing.aggregateVersionKey === probe.aggregateVersionKey) {
    let bundle = existing;
    if (existing.equityVersionKey === probe.equityVersionKey) {
      existing.lastCheckedAt = now;
    } else {
      bundle = await patchEquitySnapshots(existing, probe.equityVersionKey);
    }
    return getOrBuildTimeframeView(bundle, timeframe)[kind];
  }

  const l2View = await getDedupedCachedTimeframeView(
    accountId,
    timeframe,
    probe.aggregateVersionKey,
    probe.equityVersionKey,
  );
  if (l2View) {
    processLocalL2Views.set(
      accountId,
      timeframe,
      probe.aggregateVersionKey,
      probe.equityVersionKey,
      l2View,
    );
    return l2View[kind];
  }

  let build = accountCacheBuilds.get(accountId);
  if (!build) {
    build = rebuildAccountCache(
      accountId,
      probe.aggregateVersionKey,
      probe.equityVersionKey,
    ).finally(() => {
      accountCacheBuilds.delete(accountId);
    });
    accountCacheBuilds.set(accountId, build);
  }

  const bundle = await build;
  return bundle ? getOrBuildTimeframeView(bundle, timeframe)[kind] : null;
}
