import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  AccountOverviewResponse,
  AccountPerformanceScalars,
  BalanceDetailResponse,
  GrowthResponse,
  PositionsResponse,
  ProfitDetailResponse,
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
  computeAverageHoldHours,
  computeBalanceDrawdown,
  computeCompoundedGrowth,
  computeAverageStreaks,
  computeConsecutiveRunAmounts,
  computeAnnualizedSharpeRatio,
  computeSharpeRatio,
  computeTradesPerWeek,
  computeTradesPerYear,
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
  CURVE_POINT_BUDGET,
  downsampleBy,
} from "@/lib/trading/core/downsample";
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
import {
  buildTimeframePrecomputed,
  type DealEntry,
  type TimeframeInvariantPrecomputed,
} from "@/lib/trading/view-precompute";
import type { buildPipsSummaryRows } from "./preaggregated/pips-summary";

import { getPositionPips } from "./preaggregated/positions";
import {
  buildBotPerformance,
  buildDailyPnl,
} from "./preaggregated/panel-aggregates";
import { buildRealtime24HourBalanceCurve } from "./preaggregated/balance-curve-24h";
import {
  buildAlgoTradingSummary,
  maxAllTimeDepositLoad,
  maxPersistedDepositLoad,
} from "./preaggregated/algo-summary";

const ACCOUNT_CACHE_REVALIDATE_MS = 5_000;

const EMPTY_PERFORMANCE_SCALARS: AccountPerformanceScalars = {
  algoTradingPercent: null,
  tradeActivityPercent: null,
  averageProfitTrade: null,
  averageLossTrade: null,
  longTradesTotal: null,
  shortTradesTotal: null,
  largestProfitTrade: null,
  largestLossTrade: null,
  maximumConsecutiveWins: null,
  maximumConsecutiveLosses: null,
  maxConsecutiveProfitAmount: null,
  maxConsecutiveLossAmount: null,
  profitTradesCount: null,
  lossTradesCount: null,
  sharpeRatio: null,
  profitFactor: null,
  recoveryFactor: null,
};
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

export type OrderRow = {
  orderTicket?: string | null;
  positionId?: string | null;
  symbol?: string | null;
  sl?: number | null;
  tp?: number | null;
};

// Mirrors the Prisma OpenPosition row (the shape the view builder actually
// consumes via bundle.account.openPositions); Decimal columns typed loosely so
// plain-number fixtures fit too. floatingProfit/floating_profit stay optional
// legacy extras (fixture-only).
export type OpenPositionRow = {
  positionNo: string;
  openTime: Date | null;
  symbol: string;
  type: string;
  volume: number;
  price: number | Prisma.Decimal | null;
  sl: number | Prisma.Decimal | null;
  tp: number | Prisma.Decimal | null;
  marketPrice: number | Prisma.Decimal | null;
  profit: number | Prisma.Decimal | null;
  swap: number | Prisma.Decimal | null;
  comment: string | null;
  magic?: number | null;
  reportDate?: Date | string | null;
  floatingProfit?: number | null;
  floating_profit?: number | null;
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

export type CachedTimeframeViews = {
  overview: AccountOverviewResponse;
  balanceDetail: BalanceDetailResponse;
  growth: GrowthResponse;
  positions: PositionsResponse;
  profitDetail: ProfitDetailResponse;
  winDetail: WinDetailResponse;
  pipsSummary: PipsSummaryResponse;
};

export type EquitySnapshotRow = {
  ts: Date;
  equity: number;
  margin: number;
  depositLoad: number | null;
  maxDepositLoad: number | null;
};

export type AccountPreaggregatedSource = {
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
  // Timeframe-invariant precomputes. Optional in the source: the worker
  // computes them once per source version (see view-precompute.ts /
  // view-build-worker-entry.ts); the inline fallback computes them lazily
  // per build. When present they are used verbatim.
  pipsSummaryRows?: ReturnType<typeof buildPipsSummaryRows>;
  monthlyGrowthSeries?: Array<{ month: string; value: number }>;
  accountReportResult: {
    totalNetProfit: Prisma.Decimal | null;
    sourceReportDate: Date | null;
  } | null;
};

export type AccountPreaggregatedBundle = {
  accountId: string;
  // Everything except the latest EquitySnapshot timestamp. EquitySnapshot writes
  // land on their own ~60s cadence and must not force a full rebuild of the
  // equity-independent aggregates below.
  aggregateVersionKey: string;
  equityVersionKey: string;
  lastCheckedAt: number;
  source: AccountPreaggregatedSource;
  // In-flight-memoized builds: concurrent requests for the same timeframe
  // share one worker build instead of each paying the full serialization +
  // build cost (card mounts fire 4+ same-view requests in one burst).
  timeframes: Partial<Record<Timeframe, Promise<CachedTimeframeViews>>>;
};

export type TimeframeBuildFn = (
  source: AccountPreaggregatedSource,
  timeframes: Timeframe[],
  sourceId?: string,
) => Promise<Partial<Record<Timeframe, CachedTimeframeViews>>>;

type ViewPersistFn = (timeframe: Timeframe, view: CachedTimeframeViews) => void;

function bundleSourceId(bundle: AccountPreaggregatedBundle) {
  return `${bundle.aggregateVersionKey}|${bundle.equityVersionKey}`;
}

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

/**
 * History identity of an account's cached views. Keyed ONLY on inputs that
 * change what a view embeds from history: the newest deal (entries, exits,
 * balance ops), the newest closed position, and the report-result recompute
 * stamp. Live-tick noise (AccountSnapshot.updatedAt ~2s during trading,
 * TradingAccount.reportDate drift ~5min) deliberately does NOT invalidate —
 * it moves without changing history-derived view content, and keying on it
 * turned every live tick into a full-history reload + view rebuild storm.
 * Equity/open-floating staleness is bounded instead by the equity-version
 * revalidation path (serve-stale + background patch).
 */
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

/**
 * The ONLY equity-derived value inside a built timeframe view: the scoped
 * deposit-load peak. Everything else in a view is deal/position-derived, so
 * an equity tick that doesn't move this peak leaves every view byte-identical
 * — the property the equity revalidation retention check relies on.
 */
export function computeMaximalDepositLoad(
  timeframe: Timeframe,
  equitySnapshots: EquitySnapshotRow[],
  reportTime: Date,
): number | null {
  const since = getSinceDate(timeframe, reportTime);
  const scoped = since
    ? equitySnapshots.filter((row) => row.ts >= since)
    : equitySnapshots;
  return timeframe === "all"
    ? maxAllTimeDepositLoad(scoped)
    : maxPersistedDepositLoad(scoped);
}

export type EquityRevalidationPlan = {
  /** Timeframes whose deposit-load peak moved — rebuild these from the patched source. */
  rebuild: Timeframe[];
  /** Views provably identical to a rebuild — retain the existing view objects. */
  retained: Array<{ timeframe: Timeframe; view: CachedTimeframeViews }>;
};

/**
 * Decide what an equity-only tick actually invalidates. Equity feeds a view
 * ONLY through computeMaximalDepositLoad (see its doc comment), so a warm
 * view stays byte-identical whenever its window's peak is unchanged — which
 * is the common case outside new deposit-load highs. Retained views are safe
 * to carry under the new version key: a rebuild from the same deals + the
 * same peak reproduces them exactly.
 */
export function selectEquityRevalidationPlan(
  warmViews: Array<{ timeframe: Timeframe; view: CachedTimeframeViews }>,
  patchedSnapshots: EquitySnapshotRow[],
  reportTime: Date,
): EquityRevalidationPlan {
  const plan: EquityRevalidationPlan = { rebuild: [], retained: [] };
  for (const { timeframe, view } of warmViews) {
    const nextPeak = computeMaximalDepositLoad(
      timeframe,
      patchedSnapshots,
      reportTime,
    );
    if (view.balanceDetail.summary.maximalDepositLoad === nextPeak) {
      plan.retained.push({ timeframe, view });
    } else {
      plan.rebuild.push(timeframe);
    }
  }
  return plan;
}

export function buildTimeframeView(
  params: AccountPreaggregatedSource & {
    timeframe: Timeframe;
    precomputed?: TimeframeInvariantPrecomputed;
  },
) {
  const {
    timeframe,
    account,
    deals,
    positions,
    openPositions,
    equitySnapshots,
    latestSnapshotBalance,
    reportTime,
  } = params;

  // Timeframe-invariant inputs (growth aggregates, deal-comment and order
  // maps, the three bundle precomputes) are computed once per source version
  // by the worker session; the inline path computes them here per build.
  const precomputed =
    params.precomputed ?? buildTimeframePrecomputed(params);

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
    rows: precomputed.pipsSummaryRows,
  };

  const endingBalance =
    Number.isFinite(latestSnapshotBalance) && latestSnapshotBalance > 0
      ? latestSnapshotBalance
      : account.balance;
  // Both builders emit deal-anchored curve points; the realtime 1D builder's
  // inferred element type is slightly wider (string|Date times) — normalize
  // so downstream consumers see one shape.
  const balanceCurve: Array<{
    time: Date | string;
    balance: number;
    eventType: string | null;
    eventDelta: number | null;
  }> =
    timeframe === "1d"
      ? buildRealtime24HourBalanceCurve(
          deals,
          reportTime,
          endingBalance,
        )
      : buildBalanceCurve(deals, since);
  const periodGrowth =
    timeframe === "all"
      ? precomputed.allTimeGrowth
      : computeCompoundedGrowth(deals, since, null);
  const drawdown = computeBalanceDrawdown(deals, since, null);
  const outcomeSummary = summarizeTrades(tradingDeals);
  const grossLoss = Math.abs(
    tradingDeals
      .filter((trade) => dealNet(trade) < 0)
      .reduce((total, trade) => total + dealNet(trade), 0),
  );
  const fundingTotals = buildFundingTotals(scopedDeals);
  const openPositionsPayload = serializeOpenPositions(openPositions);
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

  // Long windows are point-per-deal (thousands for 1y/all) — LTTB-cap the
  // shipped curve so payload, client parse, and sparkline DOM stay bounded.
  // Endpoint points (day anchor + freshest) are always kept.
  const serializedBalanceCurve = downsampleBy(
    balanceCurve,
    CURVE_POINT_BUDGET,
    (point) => new Date(point.time).getTime(),
    (point) => point.balance,
  ).map((point) => ({
    x: toIso(point.time),
    y: point.balance,
    balance: point.balance,
    eventType: point.eventType ?? null,
    eventDelta: point.eventDelta ?? null,
  }));

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
      // Filled in below, once the positions-summary inputs exist.
      performance: EMPTY_PERFORMANCE_SCALARS,
    },
    openPositions: openPositionsPayload,
    totalNetProfit:
      params.accountReportResult?.totalNetProfit == null
        ? null
        : Number(params.accountReportResult.totalNetProfit),
    sourceReportDate: params.accountReportResult?.sourceReportDate
      ? params.accountReportResult.sourceReportDate.toISOString()
      : null,
  };

  const unitDrawdownCurve = buildUnitDrawdownCurve(deals, since, null);
  const maximalDepositLoad = computeMaximalDepositLoad(
    timeframe,
    equitySnapshots,
    reportTime,
  );
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
    balanceCurve: serializedBalanceCurve,
    drawdownCurve: downsampleBy(
      unitDrawdownCurve,
      CURVE_POINT_BUDGET,
      (point) => point.time.getTime(),
      (point) => point.drawdownPercent,
    ).map((point) => ({
      x: point.time.toISOString(),
      y: point.drawdownPercent,
    })),
  };

  const { allTimeGrowth, ytdGrowth, allTimeAbsoluteGain } = precomputed;
  const absoluteGain =
    timeframe === "all"
      ? allTimeAbsoluteGain
      : computeAbsoluteGain(deals, since, null);

  const monthly = precomputed.monthlyGrowthSeries;
  const yearly = precomputed.yearlySeries;

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

  // Deal-comment and order maps come from the precomputed block (built once
  // per source version; see view-precompute.ts for the matching semantics).
  const {
    openingByPriceKey,
    openingQueueByTimeKey,
    closingByPriceKey,
    closingQueueByTimeKey,
    orderByPositionId,
    orderByTicket,
  } = precomputed;

  // The FIFO queues are shared across timeframe builds via the precomputed
  // block, so consumption is tracked per build with a cursor instead of
  // destructively shifting entries (a shift would drain the queue for every
  // later build of the same source version).
  const queueConsumed = new Map<string, number>();

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
      const cursor = queueConsumed.get(timeKey) ?? 0;
      if (cursor < queue.length) {
        queueConsumed.set(timeKey, cursor + 1);
        return queue[cursor].comment;
      }
    }
    return undefined;
  }

  const SL_TAG_RE = /\[sl\s+([\d.]+)\]/i;
  const TP_TAG_RE = /\[tp\s+([\d.]+)\]/i;

  function getPositionOrder(positionNo: string | undefined) {
    if (!positionNo) {
      return undefined;
    }

    return orderByPositionId.get(positionNo) ?? orderByTicket.get(positionNo);
  }

  function numberOrNull(value: number | null | undefined) {
    return value == null ? null : Number(value);
  }

  // Descending by close time (tie-broken by positionNo) — the dominant ordering:
  // historyPositions and recentPositionDeals are newest-first, and the asc list
  // needed for streak/order math is just its reverse.
  const orderedScopedPositionsDesc = [...scopedClosedPositions].sort(
    (left, right) => {
      const timeDelta =
        new Date(right.closeTime ?? right.reportDate ?? 0).getTime() -
        new Date(left.closeTime ?? left.reportDate ?? 0).getTime();
      if (timeDelta !== 0) {
        return timeDelta;
      }

      return String(right.positionNo ?? "").localeCompare(
        String(left.positionNo ?? ""),
      );
    },
  );
  const historyPositions: PositionsResponse["historyPositions"] =
    orderedScopedPositionsDesc
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
  // Ascending (oldest-first) — feed order for streak/run math below.
  const orderedScopedPositions = [...orderedScopedPositionsDesc].reverse();
  const scopedPositionTrades: PositionsResponse["recentDeals"] =
    orderedScopedPositions.map((position) => ({
    dealId: position.positionNo ?? "",
    symbol: position.symbol ?? "UNKNOWN",
    side: normalizeTradeSide(position.type, position.type),
    volume: position.volume ?? 0,
    time: new Date(position.closeTime ?? position.reportDate ?? 0),
    price: position.closePrice == null ? null : Number(position.closePrice),
    pnl: positionNetPnl(position),
  }));
  // scopedPositionTrades is already ascending by close time; newest-first is
  // just a slice of the reversed array.
  const recentPositionDeals = [...scopedPositionTrades]
    .reverse()
    .slice(0, 30);
  const positionNetValues = closedPositionSummary.netValues;
  const positionRunAmounts = computeConsecutiveRunAmounts(positionNetValues);
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

  const longTradeWinPercent = getLongTradeWinPercent(scopedClosedPositions);
  const shortTradeWinPercent = getShortTradeWinPercent(scopedClosedPositions);
  const positionsSharpeRatio = computeSharpeRatio(positionNetValues);
  const positionsRecoveryFactor =
    drawdown.maximalAmount > 0 ? totalNet / drawdown.maximalAmount : null;

  // Fold the PerformanceBars (DD→WIN) / PerformanceRadar (DD→EXPECT) scalars
  // into the overview KPIs — assigned here, after the positions-summary
  // inputs exist, so those panels render from the mount-time overview fetch
  // instead of a separate positions roundtrip.
  overview.kpis.performance = {
    algoTradingPercent: algoTradingSummary.algoTradingPercent,
    tradeActivityPercent: lifetimeTradeActivityPercent,
    averageProfitTrade: closedPositionSummary.averageProfitTrade,
    averageLossTrade: closedPositionSummary.averageLossTrade,
    longTradesTotal: closedPositionSummary.longTradesTotal,
    shortTradesTotal: closedPositionSummary.shortTradesTotal,
    largestProfitTrade,
    largestLossTrade,
    maximumConsecutiveWins: closedPositionSummary.maximumConsecutiveWins,
    maximumConsecutiveLosses: closedPositionSummary.maximumConsecutiveLosses,
    maxConsecutiveProfitAmount: positionRunAmounts.maxConsecutiveProfitAmount,
    maxConsecutiveLossAmount: positionRunAmounts.maxConsecutiveLossAmount,
    profitTradesCount:
      closedPositionSummary.totalTrades > 0
        ? closedPositionSummary.profitTradesCount
        : null,
    lossTradesCount:
      closedPositionSummary.totalTrades > 0
        ? closedPositionSummary.lossTradesCount
        : null,
    sharpeRatio: positionsSharpeRatio,
    profitFactor: closedPositionSummary.profitFactor,
    recoveryFactor: positionsRecoveryFactor,
  };

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
      longTradeWin: longTradeWinPercent,
      shortTradeWin: shortTradeWinPercent,
      averageHoldHours: lifetimeAverageHoldHours,
      profitFactor: closedPositionSummary.profitFactor,
      recoveryFactor: positionsRecoveryFactor,
      sharpeRatio: positionsSharpeRatio,
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
      // Server-side panel aggregates: replace the client's MB-scale raw-row
      // downloads (Bot P/L pagination loop, heatmap limit=100000) with a few
      // hundred bytes per view.
      botPerformance: buildBotPerformance(historyPositions),
      dailyPnl: buildDailyPnl(historyPositions),
    },
    openPositions: openPositionsPayload,
    openBySymbol,
    historyPositions,
    historyPage: {
      total: historyPositions.length,
      limit: historyPositions.length,
      hasMore: false,
      nextCursor: null,
    },
    recentDeals: recentPositionDeals,
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

  const recentDeals: ProfitDetailResponse["recentDeals"] = [
    ...tradingDealsForProfit,
  ]
    .sort(
      (left, right) =>
        new Date(right.time).getTime() - new Date(left.time).getTime(),
    )
    .slice(0, 8)
    .map((trade) => ({
      dealId: trade.dealNo ?? "",
      symbol: trade.symbol || "UNKNOWN",
      side: String(trade.direction ?? trade.type ?? ""),
      volume: trade.volume ?? 0,
      time: new Date(trade.time),
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
    recentDeals,
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

  const winDetail: WinDetailResponse = {
    timeframe,
    account,
    summary: {
      winRate: closedPositionSummary.winPercent,
      wins: closedPositionSummary.profitTradesCount,
      losses: closedPositionSummary.lossTradesCount,
      longTradeWin: longTradeWinPercent,
      shortTradeWin: shortTradeWinPercent,
      largestProfitTrade,
      largestLossTrade,
      sharpeRatio: positionsSharpeRatio,
      profitFactor: closedPositionSummary.profitFactor,
      recoveryFactor: positionsRecoveryFactor,
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
  // Incremental append: in steady state a 60s equity tick lands exactly one
  // new row, so fetch only rows newer than the newest cached one instead of
  // re-reading the whole retained window (~10k rows at 60s x 7 days).
  const latestCachedTs =
    existing.source.equitySnapshots[
      existing.source.equitySnapshots.length - 1
    ]?.ts ?? null;
  const rows = await prisma.equitySnapshot.findMany({
    where: {
      tradingAccountId: existing.accountId,
      ...(latestCachedTs ? { ts: { gt: latestCachedTs } } : {}),
    },
    orderBy: { ts: "asc" },
    select: {
      ts: true,
      equity: true,
      margin: true,
      depositLoad: true,
      maxDepositLoad: true,
    },
  });

  const mergedSnapshots = latestCachedTs
    ? [
        ...existing.source.equitySnapshots,
        ...mapEquitySnapshots(rows),
      ]
    : mapEquitySnapshots(rows);

  return {
    ...existing,
    equityVersionKey,
    lastCheckedAt: Date.now(),
    source: {
      ...existing.source,
      equitySnapshots: mergedSnapshots,
    },
    // Equity feeds into timeframe views (maximalDepositLoad, the 1D curve's
    // ending balance); start from a clean view map so they rebuild from the
    // patched source — warm worker builds reuse the cached precompute and
    // parsed source of the unchanged aggregate version.
    timeframes: {},
  };
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

/**
 * In-flight-memoized multi-timeframe build. Missing timeframes are built in
 * ONE worker request (one source serialization for the whole batch); slots
 * are pre-registered so concurrent per-timeframe callers dedupe onto this
 * batch instead of each paying a full build.
 */
export async function getOrBuildTimeframeViews(
  bundle: AccountPreaggregatedBundle,
  timeframes: Timeframe[],
  buildViews: TimeframeBuildFn = buildTimeframeViews,
  persistView: ViewPersistFn = (timeframe, view) => {
    void setCachedTimeframeView(
      bundle.accountId,
      timeframe,
      bundle.aggregateVersionKey,
      bundle.equityVersionKey,
      view,
    );
  },
): Promise<CachedTimeframeViews[]> {
  const missing = timeframes.filter((tf) => !bundle.timeframes[tf]);

  if (missing.length > 0) {
    const batch = buildViews(bundle.source, missing, bundleSourceId(bundle));
    const slots = new Map<Timeframe, Promise<CachedTimeframeViews>>();

    for (const timeframe of missing) {
      const slot = batch.then((views) => {
        const view = views[timeframe];
        if (!view) {
          throw new Error(
            `timeframe view build returned no view for ${timeframe}`,
          );
        }
        persistView(timeframe, view);
        return view;
      });
      slots.set(timeframe, slot);
      bundle.timeframes[timeframe] = slot;
    }

    batch.catch(() => {
      // A rejected batch must not stay memoized — clear only slots this batch
      // still owns so a later request can retry.
      for (const [timeframe, slot] of slots) {
        if (bundle.timeframes[timeframe] === slot) {
          delete bundle.timeframes[timeframe];
        }
      }
    });
  }

  return Promise.all(
    timeframes.map((timeframe) => {
      const slot = bundle.timeframes[timeframe];
      if (!slot) {
        throw new Error(`timeframe view slot missing for ${timeframe}`);
      }
      return slot;
    }),
  );
}

export async function getOrBuildTimeframeView(
  bundle: AccountPreaggregatedBundle,
  timeframe: Timeframe,
  buildViews: TimeframeBuildFn = buildTimeframeViews,
  persistView: ViewPersistFn = (timeframe, view) => {
    void setCachedTimeframeView(
      bundle.accountId,
      timeframe,
      bundle.aggregateVersionKey,
      bundle.equityVersionKey,
      view,
    );
  },
): Promise<CachedTimeframeViews> {
  return (await getOrBuildTimeframeViews(bundle, [timeframe], buildViews, persistView))[0];
}

import {
  buildTimeframeViews,
  patchWorkerEquitySource,
} from "./view-build-worker";

const l2ViewReads = new Map<string, Promise<CachedTimeframeViews | null>>();

/**
 * A single timeframe view build is seconds of synchronous CPU on
 * large accounts (28k+ deals). Running several back-to-back on the
 * event loop starves pending I/O — Redis writes miss their deadline
 * and queued requests stall for the whole batch. setImmediate is NOT
 * enough: its continuation runs in the check phase and the next build
 * starts as a microtask before the poll phase can drain socket
 * replies. A timed delay forces the loop through poll, letting
 * in-flight Redis replies (sub-ms RTT locally) complete between
 * builds.
 */
function yieldToEventLoop() {
  return new Promise<void>((resolve) => setTimeout(resolve, 20));
}
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

/**
 * Background stale-while-revalidate for equity-only changes: patches equity
 * snapshots into a copy of the bundle, rebuilds the timeframes the cache was
 * already serving, and only then swaps the bundle into the account cache —
 * so request paths always see a fully warm view map.
 */
async function revalidateEquityInBackground(
  existing: AccountPreaggregatedBundle,
  equityVersionKey: string,
) {
  const pending = accountEquityRevalidations.get(existing.accountId);
  if (pending) {
    if (pending !== equityVersionKey) {
      // Newer equity tick arrived while a revalidation was running — mark it
      // so the current run's result is not swapped in; the next request that
      // observes the newer key will schedule a fresh revalidation.
      accountEquityRevalidations.set(existing.accountId, "superseded");
    }
    return;
  }

  accountEquityRevalidations.set(existing.accountId, equityVersionKey);
  try {
    const patched = await patchEquitySnapshots(existing, equityVersionKey);

    // Resolve the warm views (settled slots; a rejected slot just drops out —
    // its timeframe rebuilds below), then decide what the tick actually
    // invalidated. Equity reaches a view ONLY through the scoped deposit-load
    // peak, so unchanged peaks retain their views byte-identically instead of
    // rebuilding every warm timeframe per ~60s tick.
    const warmViews: Array<{
      timeframe: Timeframe;
      view: CachedTimeframeViews;
    }> = [];
    for (const timeframe of Object.keys(existing.timeframes) as Timeframe[]) {
      const view = await existing.timeframes[timeframe]!.then(
        (resolved) => resolved,
        () => null,
      );
      if (view) warmViews.push({ timeframe, view });
    }

    const plan = selectEquityRevalidationPlan(
      warmViews,
      patched.source.equitySnapshots,
      patched.source.reportTime,
    );
    for (const { timeframe, view } of plan.retained) {
      patched.timeframes[timeframe] = Promise.resolve(view);
      // Re-key the retained views into Redis L2 under the new version so a
      // process restart still finds them warm.
      void setCachedTimeframeView(
        patched.accountId,
        timeframe,
        patched.aggregateVersionKey,
        patched.equityVersionKey,
        view,
      );
    }

    // Re-key the worker session in place: the parsed source and the
    // timeframe-invariant precompute survive the equity tick (equity never
    // feeds the precompute), so no multi-MB source transfer and no ~1.8s
    // precompute re-run. A missed patch (evicted session) falls back to a
    // full source send inside the next build — correctness intact.
    await patchWorkerEquitySource(
      bundleSourceId(existing),
      bundleSourceId(patched),
      patched.source.equitySnapshots,
    );

    if (plan.rebuild.length > 0) {
      await yieldToEventLoop();
      await getOrBuildTimeframeViews(patched, plan.rebuild);
    }

    // Swap in only if no newer equity version superseded this run and the
    // cache entry was not replaced by a full aggregate rebuild meanwhile.
    if (
      accountEquityRevalidations.get(existing.accountId) === equityVersionKey &&
      accountCache.get(existing.accountId) === existing
    ) {
      accountCache.set(existing.accountId, patched);
      schedulePrewarm(patched);
    }
  } catch (error) {
    console.error("background equity revalidation failed", error);
  } finally {
    // Release the slot if this run still owns it (directly or via the
    // superseded marker) so a later request can schedule a fresh revalidation.
    const current = accountEquityRevalidations.get(existing.accountId);
    if (current === equityVersionKey || current === "superseded") {
      accountEquityRevalidations.delete(existing.accountId);
    }
  }
}

const DASHBOARD_TIMEFRAMES: Timeframe[] = [
  "1d",
  "1w",
  "1m",
  "3m",
  "6m",
  "1y",
  "all",
];

// Single-lane background prewarm of every dashboard timeframe per bundle.
// One lane, one timeframe build at a time (with an event-loop yield between),
// so interactive switch requests interleave at single-build granularity
// instead of queueing behind a 7-timeframe batch. The loop re-checks bundle
// identity each step — a superseded bundle stops its own prewarm.
const prewarmQueue: AccountPreaggregatedBundle[] = [];
let prewarmRunning = false;

function schedulePrewarm(bundle: AccountPreaggregatedBundle) {
  if (accountCache.get(bundle.accountId) !== bundle) return;
  if (!prewarmQueue.some((queued) => queued.accountId === bundle.accountId)) {
    prewarmQueue.push(bundle);
  }
  if (!prewarmRunning) {
    prewarmRunning = true;
    void runPrewarmLoop();
  }
}

async function runPrewarmLoop() {
  try {
    while (prewarmQueue.length > 0) {
      const bundle = prewarmQueue.shift()!;
      for (const timeframe of DASHBOARD_TIMEFRAMES) {
        if (accountCache.get(bundle.accountId) !== bundle) break;
        if (bundle.timeframes[timeframe]) continue;
        try {
          await getOrBuildTimeframeView(bundle, timeframe);
        } catch (error) {
          console.error(
            `[prewarm] timeframe ${timeframe} build failed for ${bundle.accountId}`,
            error,
          );
          break;
        }
        await yieldToEventLoop();
      }
    }
  } finally {
    prewarmRunning = false;
  }
}

const accountEquityRevalidations = new Map<string, string>();

/**
 * Same serve-stale contract as revalidateEquityInBackground, but for full
 * aggregate-version changes: rebuilds the bundle off the request path,
 * pre-warms every timeframe the cache was already serving, and swaps the
 * result in only if nothing newer superseded it.
 */
async function rebuildAccountCacheInBackground(
  existing: AccountPreaggregatedBundle,
  probe: AccountVersionProbe,
) {
  const { accountId } = existing;
  // An aggregate change supersedes any in-flight equity patch of the old
  // bundle; mark it so its (older-source) result is not swapped in.
  accountEquityRevalidations.set(accountId, "superseded");

  if (accountCacheBuilds.has(accountId)) return; // already rebuilding

  const build = rebuildAccountCache(
    accountId,
    probe.aggregateVersionKey,
    probe.equityVersionKey,
  ).finally(() => {
    accountCacheBuilds.delete(accountId);
  });
  accountCacheBuilds.set(accountId, build);

  try {
    const bundle = await build;
    if (!bundle) return;
    // Pre-warm every timeframe this account was already serving so requests
    // land on warm views. rebuildAccountCache installs the bundle before this
    // continuation runs. One batched worker request covers all warm
    // timeframes; the yield lets pending I/O (Redis writes, queued requests)
    // drain before the dispatch. A request that interleaves mid-warm builds
    // its own timeframe view idempotently — no worse than the pre-serve-stale
    // baseline.
    const warmTimeframes = Object.keys(existing.timeframes) as Timeframe[];
    if (warmTimeframes.length > 0) {
      await yieldToEventLoop();
      await getOrBuildTimeframeViews(bundle, warmTimeframes);
    }
    // Warm the never-visited timeframes too, one build at a time, so the
    // first switch to any timeframe already lands on a memoized view.
    schedulePrewarm(bundle);
  } catch (error) {
    console.error("background account cache rebuild failed", error);
  } finally {
    if (accountEquityRevalidations.get(accountId) === "superseded") {
      accountEquityRevalidations.delete(accountId);
    }
  }
}

export async function getCachedAccountView(
  accountId: string,
  timeframe: Timeframe,
  kind: AccountCachedViewKind,
) {
  const existing = accountCache.get(accountId);
  const now = Date.now();

  if (existing && now - existing.lastCheckedAt < ACCOUNT_CACHE_REVALIDATE_MS) {
    return (await getOrBuildTimeframeView(existing, timeframe))[kind];
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
    if (existing.equityVersionKey === probe.equityVersionKey) {
      existing.lastCheckedAt = now;
      return (await getOrBuildTimeframeView(existing, timeframe))[kind];
    }

    // Equity-only change: serve the still-warm views immediately (they lag by
    // at most one ~60s equity tick) and patch + re-warm in the background,
    // swapping the patched bundle into the cache once its first view is ready.
    // This keeps timeframe switches off the synchronous rebuild path.
    existing.lastCheckedAt = now;
    void revalidateEquityInBackground(existing, probe.equityVersionKey);
    return (await getOrBuildTimeframeView(existing, timeframe))[kind];
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

  if (existing) {
    // Aggregate version moved (live tick via AccountSnapshot/TradingAccount
    // write, or the 10-min liveness touch). Serve the still-warm views
    // immediately — they lag by at most one live tick — and rebuild in the
    // background, pre-warming the timeframes this account was already
    // serving before swapping the bundle in. Keeps timeframe switches off
    // the synchronous rebuild path.
    existing.lastCheckedAt = now;
    void rebuildAccountCacheInBackground(existing, probe);
    return (await getOrBuildTimeframeView(existing, timeframe))[kind];
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
  if (!bundle) return null;
  const view = (await getOrBuildTimeframeView(bundle, timeframe))[kind];
  // The request's own timeframe is warm — fill in the other six in the
  // background so the first switch to any of them is a memo hit.
  schedulePrewarm(bundle);
  return view;
}
