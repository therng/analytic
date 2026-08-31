"use client";

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trackKpiExpand, trackTimeframeChange } from "@/lib/analytics";

import type {
  AccountOverviewResponse,
  BalanceDetailResponse,
  PipsSummaryResponse,
  PositionsResponse,
  SerializedAccount,
  SerializedOpenPosition,
  Timeframe,
} from "@/lib/trading/types";

import type { Mt5LiveData, Mt5Position } from "@/lib/redis-mt5";
import { toTimestamp } from "@/lib/time";
import { useLiveData } from "@/hooks/useLiveData";
import { useValueFlash } from "@/hooks/useValueFlash";
import { useDashboardTimeframe } from "../DashboardTimeframeContext";
import {
  prefetchApiResource,
  useApiResource,
} from "@/components/trading-monitor/useApiResource";

import {
  formatCompactCount,
  formatCompactNumber,
  drawdownTone,
  formatCompactSignedNumber,
  formatSignedCurrency,
  toneFromNumber,
  type MetricTone,
} from "@/components/trading-monitor/formatters";

import {
  InlineState,
  TimeframeStrip,
} from "@/components/trading-monitor/MonitorShared";
import {
  ExpandableKpiKey,
  formatPlainNumberValue,
  formatPlainPercent,
} from "@/components/trading-monitor/dashboardFormatters";
import { SummaryChip } from "@/components/trading-monitor/SummaryChip";
import { OpenPositionsPanel } from "@/components/trading-monitor/OpenPositionsPanel";
import {
  TradeHistoryPanel,
  TRADES_HISTORY_PAGE_LIMIT,
} from "@/components/trading-monitor/TradeHistoryPanel";
import { PipsPerformanceTable } from "@/components/trading-monitor/PipsPerformanceTable";
import { ProfitHeatmapPanel } from "@/components/trading-monitor/ProfitHeatmapPanel";
import { BotPnLPanel } from "@/components/trading-monitor/BotPnLPanel";
import { DrawdownPanel } from "@/components/trading-monitor/DrawdownPanel";
import { TradeDistributionPanel } from "@/components/trading-monitor/TradeDistributionPanel";
import { PerformanceBars } from "@/components/trading-monitor/PerformanceBars";
import { PerformanceRadar } from "@/components/trading-monitor/PerformanceRadar";
import { TradingViewAnalysisModal } from "@/components/trading-monitor/TradingViewAnalysisModal";
import { BalancePanel } from "@/components/trading-monitor/card/BalancePanel";
import { AccountCardStrip } from "@/components/trading-monitor/card/AccountCardStrip";
import { getDashboardMetric } from "@/lib/trading/metric-registry";

function formatRatioValue(value: number | null | undefined, digits = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return formatPlainNumberValue(value, digits);
}

function kpiValue(value: number | null | undefined): number | null | undefined {
  return value ?? null;
}

function winRateTone(value: number | null | undefined): MetricTone {
  if (!Number.isFinite(value)) return "muted";
  if ((value as number) >= 70) return "positive";
  if ((value as number) >= 50) return "neutral";
  return "warning";
}

function formatAverageHoldTime(hours: number | null | undefined) {
  if (!Number.isFinite(hours)) {
    return "-";
  }

  const totalHours = Math.max(0, Number(hours ?? 0));
  if (totalHours < 1) {
    return `${Math.max(1, Math.round(totalHours * 60))}m`;
  }

  if (totalHours < 24) {
    return `${formatPlainNumberValue(totalHours, 1)}h`;
  }

  return `${formatPlainNumberValue(totalHours / 24, 1)}d`;
}

const DD_SUB_CYCLE = ["dd", "abs", "max", "win", "expect"] as const;

function mapLivePositions(
  data: Mt5LiveData | null | undefined,
): SerializedOpenPosition[] | null {
  if (!data || data.stale || !data.positions.length) return null;
  return data.positions.map((p: Mt5Position) => ({
    positionId: String(p.ticket),
    openedAt: p.openTime == null ? null : new Date(p.openTime * 1000),
    symbol: p.symbol,
    side: p.type === 0 ? "buy" : "sell",
    volume: p.volume,
    openPrice: p.openPrice,
    sl: p.sl || null,
    tp: p.tp || null,
    marketPrice: p.currentPrice,
    floatingProfit: p.profit,
    swap: p.swap,
    comment: p.comment || null,
    magic: p.magic ?? null,
  }));
}

function timestampMs(value: Date | string | number | null | undefined) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) return null;
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

type DdSubPanel = "dd" | "abs" | "max" | "win" | "expect";

interface KpiChipItem {
  key: string;
  label: string;
  value: string;
  tone?: MetricTone;
  meta?: string;
  fullValue?: string;
  hint?: string;
  expandKey?: ExpandableKpiKey;
}

interface DetailChipRow {
  label: string;
  value: string;
  tone?: MetricTone;
  meta?: string;
  fullValue?: string;
  hint?: string;
  onClick?: () => void;
  flashClass?: string;
}

// Isolated memo boundary: live-tick re-renders stop at the grid unless a
// KPI value, selection, or toggle handler actually changes.
const KpiChipGrid = memo(function KpiChipGrid({
  items,
  expandedKpi,
  onToggle,
}: {
  items: KpiChipItem[];
  expandedKpi: ExpandableKpiKey | null;
  onToggle: (key: ExpandableKpiKey) => void;
}) {
  return (
    <div className="kgrid">
      {items.map((item) => {
        const expandKey = item.expandKey;

        if (!expandKey) {
          return (
            <SummaryChip
              key={item.key}
              label={item.label}
              value={item.value}
              tone={item.tone}
              meta={item.meta}
              fullValue={item.fullValue}
              hint={item.hint}
            />
          );
        }

        return (
          <SummaryChip
            key={item.key}
            label={item.label}
            value={item.value}
            tone={item.tone}
            meta={item.meta}
            fullValue={item.fullValue}
            hint={item.hint}
            onClick={() => onToggle(expandKey)}
            isSelected={expandedKpi === expandKey}
          />
        );
      })}
    </div>
  );
});

const DdSubPanelChips = memo(function DdSubPanelChips({
  absoluteDrawdown,
  maximalDrawdownAmount,
  winPercent,
  expectedPayoff,
  selected,
  onSelect,
  maxDrawdownLabel,
  maxDrawdownMeta,
  maxDrawdownHint,
}: {
  absoluteDrawdown: number | null | undefined;
  maximalDrawdownAmount: number | null | undefined;
  winPercent: number | null | undefined;
  expectedPayoff: number | null | undefined;
  selected: DdSubPanel;
  onSelect: (panel: Exclude<DdSubPanel, "dd">) => void;
  maxDrawdownLabel: string;
  maxDrawdownMeta?: string;
  maxDrawdownHint?: string;
}) {
  return (
    <div className="kpi-detail-grid">
      <SummaryChip
        label="ABS"
        value={formatCompactNumber(kpiValue(absoluteDrawdown), 1)}
        tone={drawdownTone(kpiValue(absoluteDrawdown))}
        meta="Abs DD"
        isSelected={selected === "abs"}
        onClick={() => onSelect("abs")}
      />
      <SummaryChip
        label={maxDrawdownLabel}
        value={formatCompactNumber(kpiValue(maximalDrawdownAmount), 1)}
        tone={drawdownTone(kpiValue(maximalDrawdownAmount))}
        meta={maxDrawdownMeta}
        hint={maxDrawdownHint}
        isSelected={selected === "max"}
        onClick={() => onSelect("max")}
      />
      <SummaryChip
        label="WIN"
        value={formatPlainPercent(kpiValue(winPercent), 1)}
        tone={winRateTone(winPercent)}
        meta="Win %"
        isSelected={selected === "win"}
        onClick={() => onSelect("win")}
      />
      <SummaryChip
        label="EXPECT"
        value={formatCompactSignedNumber(kpiValue(expectedPayoff), 1)}
        tone={toneFromNumber(kpiValue(expectedPayoff))}
        meta="Per trade"
        isSelected={selected === "expect"}
        onClick={() => onSelect("expect")}
      />
    </div>
  );
});

const DetailChipsPanel = memo(function DetailChipsPanel({
  rows,
  error,
  showSkeleton,
}: {
  rows: DetailChipRow[];
  error: string | null;
  showSkeleton: boolean;
}) {
  if (error) {
    return <InlineState tone="error" title="KPI unavailable" message={error} />;
  }

  if (showSkeleton) {
    return (
      <div className="kpi-detail-grid" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="kpi-detail-item kpi-detail-item--skeleton"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="kpi-detail-grid">
      {rows.map((row) => (
        <SummaryChip
          key={row.label}
          label={row.label}
          value={row.value}
          tone={row.tone}
          meta={row.meta}
          fullValue={row.fullValue}
          hint={row.hint}
          onClick={row.onClick}
          flashClass={row.flashClass}
        />
      ))}
    </div>
  );
});

export const DashboardCard = memo(function DashboardCard({
  account,
  refreshKey,
  onRequestStateChange,
}: {
  account: SerializedAccount;
  refreshKey?: number;
  onRequestStateChange?: (request: {
    loading: boolean;
    refreshKey: number;
  }) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const sharedTimeframe = useDashboardTimeframe();
  const [localTimeframe, setLocalTimeframe] = useState<Timeframe>("1d");
  const timeframe = sharedTimeframe.timeframe ?? localTimeframe;
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [expandedKpi, setExpandedKpi] = useState<ExpandableKpiKey | null>(null);
  const [highlightedBalance, setHighlightedBalance] = useState<number | null>(
    null,
  );
  const [ddSubPanel, setDdSubPanel] = useState<
    "dd" | "abs" | "max" | "win" | "expect"
  >("dd");
  const [isTechnicalAnalysisOpen, setIsTechnicalAnalysisOpen] = useState(false);

  const handleTimeframeChange = useCallback(
    (value: Timeframe) => {
      trackTimeframeChange(account.id, value);
      // Shared dashboard timeframe keeps every card in sync; the local
      // fallback also updates so a context-less card stays usable.
      setLocalTimeframe(value);
      sharedTimeframe.setTimeframe(value);
      startTransition(() => {
        setHighlightedBalance(null);
      });
    },
    [account.id, sharedTimeframe],
  );

  const prefetchTimeframe = useCallback(
    (value: Timeframe) => {
      if (value === timeframe) return;
      prefetchApiResource(
        `/api/accounts/${account.id}/overview?timeframe=${value}`,
      );
      prefetchApiResource(
        `/api/accounts/${account.id}/balance?timeframe=${value}`,
      );
      // Warm the trades panel's page-1 payload so a tap on the trades chip
      // after switching timeframe renders from cache, not a cold request.
      // (overview+balance already build/cache the whole timeframe view — the
      // old limit=1 "probe" request was redundant wire + envelope bytes.)
      prefetchApiResource(
        `/api/accounts/${account.id}/positions?timeframe=${value}&limit=${TRADES_HISTORY_PAGE_LIMIT}`,
      );
    },
    [account.id, timeframe],
  );

  // Mount-time warm for the trades chip: page-1 of the default timeframe.
  // The lifetime summary (ACTIVITY/PER WEEK/HOLDING + the pips heatmap's
  // all-time buckets) is fetched on first chip tap instead — warming the
  // "all" view at mount forced its full-history build (the heaviest one)
  // for every card, seconds after load.
  useEffect(() => {
    prefetchApiResource(
      `/api/accounts/${account.id}/positions?timeframe=1d&limit=${TRADES_HISTORY_PAGE_LIMIT}`,
    );
  }, [account.id]);

  const handleChipToggle = useCallback(
    (key: ExpandableKpiKey) => {
      if (key === "dd") {
        setExpandedKpi((current) => {
          if (current !== "dd") {
            setDdSubPanel("dd");
            trackKpiExpand(account.id, "dd");
            return "dd";
          }
          setDdSubPanel((cur) => {
            const idx = DD_SUB_CYCLE.indexOf(cur);
            return DD_SUB_CYCLE[(idx + 1) % DD_SUB_CYCLE.length];
          });
          return "dd";
        });
      } else {
        setExpandedKpi((current) => {
          const next = current === key ? null : key;
          if (next) {
            trackKpiExpand(account.id, next);
          }
          return next;
        });
      }
    },
    [account.id],
  );

  const handleDdSubSelect = useCallback(
    (panel: Exclude<DdSubPanel, "dd">) => {
      setDdSubPanel((current) => (current === panel ? "dd" : panel));
    },
    [],
  );

  const handleHighlightBalanceChange = useCallback(
    (value: number | null) => {
      setHighlightedBalance(value);
    },
    [],
  );

  const resourceOptions = {
    refreshKey: (refreshKey ?? 0) + localRefreshKey,
    onRequestStateChange,
  };

  const retryCard = useCallback(() => {
    setLocalRefreshKey((key) => key + 1);
  }, []);

  const overview = useApiResource<AccountOverviewResponse>(
    `/api/accounts/${account.id}/overview?timeframe=${timeframe}`,
    resourceOptions,
  );

  const balanceDetail = useApiResource<BalanceDetailResponse>(
    `/api/accounts/${account.id}/balance?timeframe=${timeframe}`,
    resourceOptions,
  );

  const pipsDetail = useApiResource<PipsSummaryResponse>(
    expandedKpi === "pips"
      ? `/api/accounts/${account.id}/pips?timeframe=all`
      : null,
    resourceOptions,
  );

  // Only the opens panel still needs the positions view; the DD→WIN/EXPECT
  // performance scalars ride the overview payload now.
  const needsPositionSummary = expandedKpi === "opens";

  const positionsDetail = useApiResource<PositionsResponse>(
    needsPositionSummary
      ? `/api/accounts/${account.id}/positions?timeframe=${timeframe}&history=0`
      : null,
    resourceOptions,
  );

  // Activity/Per-week/Holding are lifetime stats, not scoped to the card's
  // timeframe. The same all-time summary carries the dailyPnl buckets the
  // pips chip's heatmap renders — replacing a former unbounded raw-row
  // download (~MBs) with the same ~KB response.
  const tradesStatsAll = useApiResource<PositionsResponse>(
    expandedKpi === "trades" || expandedKpi === "pips"
      ? `/api/accounts/${account.id}/positions?timeframe=all&history=0`
      : null,
    resourceOptions,
  );

  // Trades panel page-1, cached at card level so repeat taps on the trades
  // chip render instantly and pull-to-refresh revalidates it like other views.
  const tradesHistory = useApiResource<PositionsResponse>(
    expandedKpi === "trades"
      ? `/api/accounts/${account.id}/positions?timeframe=${timeframe}&limit=${TRADES_HISTORY_PAGE_LIMIT}`
      : null,
    resourceOptions,
  );



  const liveData = useLiveData(account.id);
  const liveOpenPositions = useMemo(
    () => mapLivePositions(liveData),
    [liveData],
  );
  const liveLiveInfo = liveData?.live ?? null;

  // Compute P/L at top level — needed for useValueFlash (hooks can't be called conditionally)
  const rawPlForFlash = liveLiveInfo?.profit ?? account.floating_pl;
  const plFlashClass = useValueFlash(rawPlForFlash);

  // Balance flash tracks live equity — needed at top level for useValueFlash (hooks can't be called conditionally)
  const rawBalanceForFlash = liveLiveInfo?.equity ?? account.equity;
  const balanceFlashClass = useValueFlash(rawBalanceForFlash);

  const hasLiveBridgeConnection =
    liveData !== null && liveLiveInfo !== null && !liveData.stale;
  const liveSnapshotMs = timestampMs(liveLiveInfo?.timestamp);
  const lastReportMs = timestampMs(account.last_updated);
  const showLiveBridgeSnapshot =
    hasLiveBridgeConnection &&
    liveSnapshotMs !== null &&
    lastReportMs !== null &&
    liveSnapshotMs > lastReportMs;
  const active = liveLiveInfo?.terminalConnected === true;

  const liveEquity = liveLiveInfo?.equity ?? account.equity;
  const displayedBalance =
    highlightedBalance !== null ? highlightedBalance : liveEquity;
  const displayedBalanceMetricName =
    highlightedBalance !== null ? "Balance" : "Equity";

  const sparklinePoints = useMemo(
    () => balanceDetail.data?.balanceCurve ?? [],
    [balanceDetail.data],
  );
  const openCount =
    liveOpenPositions?.length ?? overview.data?.kpis.openCount ?? 0;
  const gainMetric = getDashboardMetric("gain")!;
  const ddMetric = getDashboardMetric("dd")!;
  const maxBalanceDrawdownMetric = getDashboardMetric(
    "max-balance-drawdown",
  )!;
  const pipsMetric = getDashboardMetric("pips")!;
  const tradesMetric = getDashboardMetric("trades")!;
  const opensMetric = getDashboardMetric("opens")!;
  const commissionMetric = getDashboardMetric("commission")!;
  const swapMetric = getDashboardMetric("swap")!;
  const depositMetric = getDashboardMetric("deposit")!;
  const withdrawalMetric = getDashboardMetric("withdrawal")!;
  const floatingPlMetric = getDashboardMetric("floating-pl")!;
  const marginMetric = getDashboardMetric("margin")!;
  const freeMarginMetric = getDashboardMetric("free-margin")!;
  const marginLevelMetric = getDashboardMetric("margin-level")!;

  const kpiItems = useMemo<KpiChipItem[]>(() => [
    {
      key: "gain",
      label: gainMetric.label,
      value: formatCompactSignedNumber(
        kpiValue(overview.data?.kpis.netProfit),
        1,
      ),
      tone: toneFromNumber(kpiValue(overview.data?.kpis.netProfit)),
      meta: gainMetric.meta,
      fullValue: formatSignedCurrency(
        kpiValue(overview.data?.kpis.netProfit),
        2,
      ),
      expandKey: "gain" as ExpandableKpiKey,
      hint: gainMetric.hint,
    },
    {
      key: "dd",
      label: ddMetric.label,
      value: formatPlainPercent(kpiValue(overview.data?.kpis.drawdown), 1),
      tone: drawdownTone(kpiValue(overview.data?.kpis.drawdown)),
      meta: ddMetric.meta,
      fullValue: formatPlainPercent(kpiValue(overview.data?.kpis.drawdown), 2),
      expandKey: "dd" as ExpandableKpiKey,
      hint: ddMetric.hint,
    },
    {
      key: "pips",
      label: pipsMetric.label,
      value: formatCompactSignedNumber(kpiValue(overview.data?.kpis.netPips)),
      tone: toneFromNumber(kpiValue(overview.data?.kpis.netPips)),
      meta: pipsMetric.meta,
      fullValue: formatPlainNumberValue(
        kpiValue(overview.data?.kpis.netPips),
        0,
      ),
      expandKey: "pips" as ExpandableKpiKey,
      hint: pipsMetric.hint,
    },
    {
      key: "trades",
      label: tradesMetric.label,
      value: formatCompactCount(kpiValue(overview.data?.kpis.trades)),
      tone: "neutral" as MetricTone,
      meta: tradesMetric.meta,
      fullValue:
        overview.data?.kpis.trades != null && overview.data.kpis.trades > 0
          ? `${overview.data.kpis.trades} trades`
          : undefined,
      expandKey: "trades" as ExpandableKpiKey,
      hint: tradesMetric.hint,
    },
    {
      key: "opens",
      label: opensMetric.label,
      value: formatCompactCount(openCount || null),
      tone: openCount > 0 ? "info" : "neutral",
      meta: opensMetric.meta,
      fullValue: openCount > 0 ? `${openCount} active positions` : undefined,
      expandKey: "opens" as ExpandableKpiKey,
      hint: opensMetric.hint,
    },
  ], [overview.data, openCount, gainMetric, ddMetric, pipsMetric, tradesMetric, opensMetric]);

  const detailState = expandedKpi === "trades" ? tradesStatsAll : null;

  const detailRows = useMemo<DetailChipRow[]>(() => {
    const rows: DetailChipRow[] = [];

    if (expandedKpi === "gain" && overview.data) {
      rows.push(
        {
          label: commissionMetric.label,
          value: formatCompactSignedNumber(
            kpiValue(overview.data.kpis.totalCommission),
            1,
          ),
          tone: toneFromNumber(kpiValue(overview.data.kpis.totalCommission)),
          meta: commissionMetric.meta,
        },
        {
          label: swapMetric.label,
          value: formatCompactSignedNumber(
            kpiValue(overview.data.kpis.totalSwap),
            1,
          ),
          tone: toneFromNumber(kpiValue(overview.data.kpis.totalSwap)),
          meta: swapMetric.meta,
        },
        {
          label: depositMetric.label,
          value: formatCompactNumber(
            kpiValue(overview.data.kpis.totalDeposit),
            1,
          ),
          tone:
            kpiValue(overview.data.kpis.totalDeposit) != null
              ? ("positive" as MetricTone)
              : ("muted" as MetricTone),
          meta: depositMetric.meta,
        },
        {
          label: withdrawalMetric.label,
          value: formatCompactNumber(
            kpiValue(overview.data.kpis.totalWithdrawal),
            1,
          ),
          tone:
            kpiValue(overview.data.kpis.totalWithdrawal) != null
              ? ("negative" as MetricTone)
              : ("muted" as MetricTone),
          meta: withdrawalMetric.meta,
        },
      );
    } else if (expandedKpi === "trades") {
      rows.push(
        {
          label: "ACTIVITY",
          value: formatPlainPercent(
            kpiValue(tradesStatsAll.data?.summary.tradeActivityPercent),
            0,
          ),
          tone: "neutral" as MetricTone,
          meta: "Trading Activity",
        },
        {
          label: "PER WEEK",
          value: formatRatioValue(tradesStatsAll.data?.summary.tradesPerWeek, 1),
          tone: "neutral" as MetricTone,
          meta: "Avg/week",
        },
        {
          label: "HOLDING",
          value: formatAverageHoldTime(
            tradesStatsAll.data?.summary.averageHoldHours,
          ),
          tone: "neutral" as MetricTone,
          meta: "Avg duration",
        },
      );
    } else if (expandedKpi === "opens") {
      const rawPl = liveLiveInfo?.profit ?? account.floating_pl;
      const rawMargin = liveLiveInfo?.margin ?? account.margin ?? 0;
      const effectiveEquity = liveLiveInfo?.equity ?? account.equity;
      const rawFree = liveLiveInfo?.freeMargin ?? effectiveEquity - rawMargin;
      const rawLevel =
        liveLiveInfo?.marginLevel ?? account.margin_level ?? 0;
      const freeRatioPct =
        effectiveEquity > 0 ? (rawFree / effectiveEquity) * 100 : 0;

      const marginTone: MetricTone =
        rawMargin === 0
          ? "muted"
          : rawMargin > account.balance
            ? "warning"
            : "neutral";
      const freeTone: MetricTone =
        rawFree === 0 ? "muted" : freeRatioPct < 50 ? "warning" : "neutral";
      const levelTone: MetricTone =
        rawLevel === 0
          ? "muted"
          : rawLevel > 1000
            ? "neutral"
            : rawLevel > 500
              ? "warning"
              : "negative";

      rows.push(
        {
          label: floatingPlMetric.label,
          value: formatCompactSignedNumber(kpiValue(rawPl), 1),
          tone: toneFromNumber(kpiValue(rawPl)),
          meta: floatingPlMetric.meta,
          flashClass: plFlashClass,
        },
        {
          label: marginMetric.label,
          value: formatCompactNumber(kpiValue(rawMargin), 1),
          tone: marginTone,
          meta: marginMetric.meta,
        },
        {
          label: freeMarginMetric.label,
          value: formatCompactNumber(kpiValue(rawFree), 1),
          tone: freeTone,
          meta: freeMarginMetric.meta,
        },
        {
          label: marginLevelMetric.label,
          value: formatPlainPercent(kpiValue(rawLevel), 0),
          tone: levelTone,
          meta: marginLevelMetric.meta,
        },
      );
    }

    return rows;
  }, [
    expandedKpi,
    overview.data,
    tradesStatsAll.data,
    liveLiveInfo,
    account,
    plFlashClass,
    commissionMetric,
    swapMetric,
    depositMetric,
    withdrawalMetric,
    floatingPlMetric,
    marginMetric,
    freeMarginMetric,
    marginLevelMetric,
  ]);

  const compactKpiPanel = (
    <>
      {expandedKpi === "pips" ? (
        <div className="sp-overlay-panel sp-overlay-panel--pips">
          <PipsPerformanceTable rows={pipsDetail.data?.rows ?? []} />
          <ProfitHeatmapPanel
            dailyPnl={tradesStatsAll.data?.summary.dailyPnl}
            loading={tradesStatsAll.loading}
            error={tradesStatsAll.error}
          />
        </div>
      ) : expandedKpi === "trades" ? (
        <div className="sp-overlay-panel">
          <TradeHistoryPanel
            accountId={account.id}
            timeframe={timeframe}
            page={tradesHistory.data}
            pageLoading={tradesHistory.loading}
            pageError={tradesHistory.error}
          />
        </div>
      ) : expandedKpi === "opens" ? (
        <div className="sp-overlay-panel">
          <OpenPositionsPanel
            positions={
              liveOpenPositions ??
              positionsDetail.data?.openPositions ??
              overview.data?.openPositions
            }
            loading={positionsDetail.loading || overview.loading}
            error={positionsDetail.error ?? overview.error}
            onOpenTechnicalAnalysis={() => setIsTechnicalAnalysisOpen(true)}
          />
        </div>
      ) : expandedKpi === "dd" ? (
        <div className="sp-overlay-panel">
          {ddSubPanel === "dd" && (
            <BotPnLPanel
              accountId={account.id}
              timeframe={timeframe}
              cardRef={cardRef}
            />
          )}
          {ddSubPanel === "abs" && (
            <DrawdownPanel balanceDetail={balanceDetail} timeframe={timeframe} />
          )}
          {ddSubPanel === "win" &&
            (overview.loading && !overview.data ? (
              <div
                className="skeleton-chart account-card__chart-skeleton"
                aria-hidden="true"
              />
            ) : (
              <PerformanceBars
                sharpeRatio={overview.data?.kpis.performance.sharpeRatio}
                profitFactor={overview.data?.kpis.performance.profitFactor}
                recoveryFactor={overview.data?.kpis.performance.recoveryFactor}
                averageProfitTrade={
                  overview.data?.kpis.performance.averageProfitTrade
                }
                averageLossTrade={
                  overview.data?.kpis.performance.averageLossTrade
                }
                longTradesTotal={overview.data?.kpis.performance.longTradesTotal}
                shortTradesTotal={
                  overview.data?.kpis.performance.shortTradesTotal
                }
                largestProfitTrade={
                  overview.data?.kpis.performance.largestProfitTrade
                }
                largestLossTrade={
                  overview.data?.kpis.performance.largestLossTrade
                }
                maximumConsecutiveWins={
                  overview.data?.kpis.performance.maximumConsecutiveWins
                }
                maximumConsecutiveLosses={
                  overview.data?.kpis.performance.maximumConsecutiveLosses
                }
                maxConsecutiveProfitAmount={
                  overview.data?.kpis.performance.maxConsecutiveProfitAmount
                }
                maxConsecutiveLossAmount={
                  overview.data?.kpis.performance.maxConsecutiveLossAmount
                }
                profitTradesCount={
                  overview.data?.kpis.performance.profitTradesCount
                }
                lossTradesCount={overview.data?.kpis.performance.lossTradesCount}
              />
            ))}
          {ddSubPanel === "expect" && (
            <PerformanceRadar
              balanceDetail={balanceDetail}
              overview={overview}
            />
          )}
          {ddSubPanel === "max" && (
            <TradeDistributionPanel balanceDetail={balanceDetail} />
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <article
        ref={cardRef}
        className={`card account-card ${active ? "account-card--active" : "account-card--inactive"}`}
      >
        <div className="sp-wrap">
          <AccountCardStrip
            account={overview.data?.account ?? account}
            active={active}
            equity={displayedBalance}
            equityMetricName={displayedBalanceMetricName}
            equityFlashClass={
              showLiveBridgeSnapshot && highlightedBalance === null
                ? balanceFlashClass
                : undefined
            }
          />

          <div className="tf-row">
            <TimeframeStrip
              active={timeframe}
              onChange={handleTimeframeChange}
              onIntent={prefetchTimeframe}
            />
          </div>

          <div
            className={`sp-canvas-stack${expandedKpi === "dd" ? " sp-canvas-stack--dd" : ""}`}
          >
            {overview.error ? (
              <InlineState
                tone="error"
                title="โหลดการ์ดไม่สำเร็จ"
                message={
                  overview.error === "Failed to fetch"
                    ? "เน็ตหลุดหรือเซิร์ฟเวอร์ไม่ตอบสนอง"
                    : (overview.error ?? "โหลดข้อมูลการ์ดไม่สำเร็จ")
                }
                action={{ label: "ลองใหม่", onClick: retryCard }}
              />
            ) : (overview.loading && !overview.data) ||
                (balanceDetail.loading && !balanceDetail.data) ? (
              <div
                className="skeleton-chart account-card__chart-skeleton"
                aria-hidden="true"
              />
            ) : (
              <BalancePanel
                accountId={account.id}
                points={sparklinePoints}
                active={active}
                timeframe={timeframe}
                onHighlightBalanceChange={handleHighlightBalanceChange}
                liveTimestamp={account.last_updated}
                liveBalance={account.balance}
                equityPoints={balanceDetail.data?.equityCurve}
                liveEquityValue={
                  openCount === 0
                    ? account.balance
                    : (liveLiveInfo?.equity ?? account.equity)
                }
                showLiveBeacon={showLiveBridgeSnapshot}
              />
            )}
            {compactKpiPanel}
          </div>
        </div>

        <div className="kpi-stack" role="region" aria-label="ตัวชี้วัดสำคัญ">
          <KpiChipGrid
            items={kpiItems}
            expandedKpi={expandedKpi}
            onToggle={handleChipToggle}
          />
        </div>

        {expandedKpi === "dd" ? (
          <section
            className="kpi-detail-panel"
            aria-label="Drawdown panel tabs"
          >
            <DdSubPanelChips
              absoluteDrawdown={balanceDetail.data?.summary.absoluteDrawdown}
              maximalDrawdownAmount={
                balanceDetail.data?.summary.maximalDrawdownAmount
              }
              winPercent={overview.data?.kpis.winPercent}
              expectedPayoff={positionsDetail.data?.summary.expectedPayoff}
              selected={ddSubPanel}
              onSelect={handleDdSubSelect}
              maxDrawdownLabel={maxBalanceDrawdownMetric.label}
              maxDrawdownMeta={maxBalanceDrawdownMetric.meta}
              maxDrawdownHint={maxBalanceDrawdownMetric.hint}
            />
          </section>
        ) : expandedKpi && detailRows.length ? (
          <section
            className="kpi-detail-panel"
            aria-label={`${kpiItems.find((item) => item.key === expandedKpi)?.label ?? "KPI"} details`}
          >
            <DetailChipsPanel
              rows={detailRows}
              error={detailState?.error ?? null}
              showSkeleton={Boolean(detailState?.loading && !detailState?.data)}
            />
          </section>
        ) : null}
      </article>
      <TradingViewAnalysisModal
        open={isTechnicalAnalysisOpen}
        onClose={() => setIsTechnicalAnalysisOpen(false)}
      />
    </>
  );
});

DashboardCard.displayName = "DashboardCard";
