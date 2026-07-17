"use client";

import { memo, startTransition, useCallback, useRef, useState } from "react";
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
import { useLiveData } from "@/hooks/useLiveData";
import { useValueFlash } from "@/hooks/useValueFlash";
import { useApiResource } from "@/components/trading-monitor/useApiResource";

import {
  formatCompactCount,
  formatCompactNumber,
  drawdownTone,
  displayName,
  formatCompactSignedNumber,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  toneFromNumber,
  type MetricTone,
} from "@/components/trading-monitor/formatters";

import {
  InlineState,
  SparklineChart,
  TimeframeStrip,
} from "@/components/trading-monitor/MonitorShared";
import {
  ExpandableKpiKey,
  formatPlainNumberValue,
  formatPlainPercent,
} from "@/components/trading-monitor/dashboardFormatters";
import { SummaryChip } from "@/components/trading-monitor/SummaryChip";
import { OpenPositionsPanel } from "@/components/trading-monitor/OpenPositionsPanel";
import { TradeHistoryPanel } from "@/components/trading-monitor/TradeHistoryPanel";
import { PipsPerformanceTable } from "@/components/trading-monitor/PipsPerformanceTable";
import { ProfitHeatmapPanel } from "@/components/trading-monitor/ProfitHeatmapPanel";
import { BotPnLPanel } from "@/components/trading-monitor/BotPnLPanel";
import { DrawdownEquityPanel } from "@/components/trading-monitor/DrawdownEquityPanel";
import { MaeMfePanel } from "@/components/trading-monitor/MaeMfePanel";
import { PerformanceBars } from "@/components/trading-monitor/PerformanceBars";
import { PerformanceRadar } from "@/components/trading-monitor/PerformanceRadar";
import { TradingViewAnalysisModal } from "@/components/trading-monitor/TradingViewAnalysisModal";
import { getBangkokDateKey } from "@/lib/time";
import { getDashboardMetric } from "@/lib/trading/metric-registry";

function formatRatioValue(value: number | null | undefined, digits = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return formatPlainNumberValue(value, digits);
}

function kpiValue(value: number | null | undefined): number | null | undefined {
  return value ? value : null;
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
const HEATMAP_HISTORY_PAGE_LIMIT = 100000;

function mapLivePositions(
  data: Mt5LiveData | null | undefined,
): SerializedOpenPosition[] | null {
  if (!data || data.stale || !data.positions.length) return null;
  return data.positions.map((p: Mt5Position) => ({
    positionId: String(p.ticket),
    openedAt: new Date(p.openTime * 1000),
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
  if (value == null) return null;
  const timestamp =
    typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

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
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [expandedKpi, setExpandedKpi] = useState<ExpandableKpiKey | null>(null);
  const [highlightedBalanceState, setHighlightedBalanceState] = useState<{
    scope: "overall" | "timeframe";
    value: number | null;
  }>({ scope: "timeframe", value: null });
  const [ddSubPanel, setDdSubPanel] = useState<
    "dd" | "abs" | "max" | "win" | "expect"
  >("dd");
  const [isTechnicalAnalysisOpen, setIsTechnicalAnalysisOpen] = useState(false);

  const handleTimeframeChange = useCallback(
    (value: Timeframe) => {
      trackTimeframeChange(account.id, value);
      startTransition(() => {
        setTimeframe(value);
        setHighlightedBalanceState({ scope: "timeframe", value: null });
      });
    },
    [account.id],
  );

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

  const resourceOptions = { refreshKey, onRequestStateChange };

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

  const needsPositionSummary =
    expandedKpi === "opens" ||
    (expandedKpi === "dd" && !["abs", "max"].includes(ddSubPanel));

  const positionsDetail = useApiResource<PositionsResponse>(
    needsPositionSummary
      ? `/api/accounts/${account.id}/positions?timeframe=${timeframe}&history=0`
      : null,
    resourceOptions,
  );

  // Activity/Per-week/Holding are lifetime stats, not scoped to the card's timeframe.
  const tradesStatsAll = useApiResource<PositionsResponse>(
    expandedKpi === "trades"
      ? `/api/accounts/${account.id}/positions?timeframe=all&history=0`
      : null,
    resourceOptions,
  );

  const allPositions = useApiResource<PositionsResponse>(
    expandedKpi === "pips"
      ? `/api/accounts/${account.id}/positions?timeframe=all&limit=${HEATMAP_HISTORY_PAGE_LIMIT}`
      : null,
    resourceOptions,
  );

  const liveData = useLiveData(account.id);
  const liveOpenPositions = mapLivePositions(liveData);
  const liveLiveInfo = liveData?.live ?? null;

  // Compute P/L at top level — needed for useValueFlash (hooks can't be called conditionally)
  const rawPlForFlash = liveLiveInfo?.profit ?? account.floating_pl;
  const plFlashClass = useValueFlash(rawPlForFlash);

  // Balance flash tracks live equity — needed at top level for useValueFlash (hooks can't be called conditionally)
  const rawBalanceForFlash = liveLiveInfo?.equity ?? account.equity;
  const balanceFlashClass = useValueFlash(rawBalanceForFlash);

  const accountSource = account;
  const hasLiveBridgeConnection =
    liveData !== null && liveLiveInfo !== null && !liveData.stale;
  const liveSnapshotMs = timestampMs(liveLiveInfo?.timestamp);
  const lastReportMs = timestampMs(accountSource.last_updated);
  const showLiveBridgeSnapshot =
    hasLiveBridgeConnection &&
    liveSnapshotMs !== null &&
    lastReportMs !== null &&
    liveSnapshotMs > lastReportMs;
  const active = liveLiveInfo?.terminalConnected === true;
  const accountLabel = account.account_number
    ? `#${account.account_number}`
    : "Unnumbered";
  const accountDisplayName = displayName(account);

  const growthTone = toneFromNumber(kpiValue(overview.data?.kpis.periodGrowth));
  const displayedGrowth = formatPercent(
    kpiValue(overview.data?.kpis.periodGrowth),
    1,
  );

  const highlightedBalance = highlightedBalanceState.value;
  const liveEquity = liveLiveInfo?.equity ?? accountSource.equity;
  const displayedBalance =
    highlightedBalance !== null ? highlightedBalance : liveEquity;
  const displayedBalanceLabel = formatCurrency(displayedBalance, 2);
  const displayedBalanceMetricName =
    highlightedBalance !== null ? "Balance" : "Equity";

  const sparklinePoints = balanceDetail.data?.balanceCurve ?? [];
  const gainMetric = getDashboardMetric("gain")!;
  const ddMetric = getDashboardMetric("dd")!;
  const maeMfeMetric = getDashboardMetric("mae-mfe")!;
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

  const kpiItems: Array<{
    key: string;
    label: string;
    value: string;
    tone?: MetricTone;
    meta?: string;
    fullValue?: string;
    hint?: string;
    expandKey?: ExpandableKpiKey;
  }> = [
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
      value: formatCompactCount(
        liveOpenPositions?.length ?? overview.data?.kpis.openCount,
      ),
      tone:
        (liveOpenPositions?.length ?? overview.data?.kpis.openCount ?? 0) > 0
          ? "info"
          : "neutral",
      meta: opensMetric.meta,
      fullValue: (() => {
        const count =
          liveOpenPositions?.length ?? overview.data?.kpis.openCount;
        return (count ?? 0) > 0 ? `${count} active positions` : undefined;
      })(),
      expandKey: "opens" as ExpandableKpiKey,
      hint: opensMetric.hint,
    },
  ];

  const detailState = expandedKpi === "trades" ? tradesStatsAll : null;

  const detailRows: {
    label: string;
    value: string;
    tone?: any;
    meta?: string;
    fullValue?: string;
    hint?: any;
    onClick?: () => void;
    flashClass?: string;
  }[] = [];

  if (expandedKpi === "gain" && overview.data) {
    detailRows.push(
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
    detailRows.push(
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
    const rawPl = liveLiveInfo?.profit ?? accountSource.floating_pl;
    const rawMargin = liveLiveInfo?.margin ?? accountSource.margin ?? 0;
    const effectiveEquity = liveLiveInfo?.equity ?? accountSource.equity;
    const rawFree = liveLiveInfo?.freeMargin ?? effectiveEquity - rawMargin;
    const rawLevel =
      liveLiveInfo?.marginLevel ?? accountSource.margin_level ?? 0;
    const freeRatioPct =
      effectiveEquity > 0 ? (rawFree / effectiveEquity) * 100 : 0;

    const marginTone: MetricTone =
      rawMargin === 0
        ? "muted"
        : rawMargin > accountSource.balance
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

    detailRows.push(
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

  const compactKpiPanel = (
    <>
      {expandedKpi === "pips" ? (
        <div className="sp-overlay-panel sp-overlay-panel--pips">
          <PipsPerformanceTable rows={pipsDetail.data?.rows ?? []} />
          <ProfitHeatmapPanel
            positions={allPositions.data?.historyPositions}
            loading={allPositions.loading}
          />
        </div>
      ) : expandedKpi === "trades" ? (
        <div className="sp-overlay-panel">
          <TradeHistoryPanel accountId={account.id} timeframe={timeframe} />
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
            <DrawdownEquityPanel balanceDetail={balanceDetail} />
          )}
          {ddSubPanel === "win" &&
            (positionsDetail.loading && !positionsDetail.data ? (
              <div
                className="skeleton-chart account-card__chart-skeleton"
                aria-hidden="true"
              />
            ) : (
              <PerformanceBars
                sharpeRatio={positionsDetail.data?.summary.sharpeRatio}
                profitFactor={positionsDetail.data?.summary.profitFactor}
                recoveryFactor={positionsDetail.data?.summary.recoveryFactor}
                averageProfitTrade={
                  positionsDetail.data?.summary.averageProfitTrade
                }
                averageLossTrade={
                  positionsDetail.data?.summary.averageLossTrade
                }
                longTradesTotal={positionsDetail.data?.summary.longTradesTotal}
                shortTradesTotal={
                  positionsDetail.data?.summary.shortTradesTotal
                }
                largestProfitTrade={
                  positionsDetail.data?.summary.largestProfitTrade
                }
                largestLossTrade={
                  positionsDetail.data?.summary.largestLossTrade
                }
                maximumConsecutiveWins={
                  positionsDetail.data?.summary.maximumConsecutiveWins
                }
                maximumConsecutiveLosses={
                  positionsDetail.data?.summary.maximumConsecutiveLosses
                }
                maxConsecutiveProfitAmount={
                  positionsDetail.data?.summary.maxConsecutiveProfitAmount
                }
                maxConsecutiveLossAmount={
                  positionsDetail.data?.summary.maxConsecutiveLossAmount
                }
                profitTradesCount={
                  positionsDetail.data?.summary.profitTradesCount
                }
                lossTradesCount={positionsDetail.data?.summary.lossTradesCount}
              />
            ))}
          {ddSubPanel === "expect" && (
            <PerformanceRadar
              balanceDetail={balanceDetail}
              overview={overview}
              positionsDetail={positionsDetail}
            />
          )}
          {ddSubPanel === "max" && (
            <MaeMfePanel balanceDetail={balanceDetail} />
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
          <div className="sp-header">
            <div className="sp-top sp-top--compact">
              <div className="sp-identity sp-identity--header">
                <div className="sp-name">{accountDisplayName}</div>
                <div className="sp-account">
                  <span>{accountLabel}</span>
                  <span
                    className={`sp-account-status ${active ? "is-active" : "is-inactive"}`}
                    aria-label={`Account status ${active ? "Active" : "Inactive"}`}
                  />
                </div>
              </div>

              <div className="sp-side">
                <div
                  className={`sp-growth tone-${growthTone}`}
                  aria-label={`Growth ${displayedGrowth}`}
                >
                  <strong>{displayedGrowth}</strong>
                </div>

                <div
                  className={
                    showLiveBridgeSnapshot && highlightedBalance === null
                      ? `sp-balance is-current-live ${balanceFlashClass}`.trim()
                      : "sp-balance"
                  }
                  aria-label={`${displayedBalanceMetricName} ${displayedBalanceLabel}`}
                >
                  <strong>{displayedBalanceLabel}</strong>
                </div>
              </div>
            </div>

            <div className="tf-row">
              <TimeframeStrip
                active={timeframe}
                onChange={handleTimeframeChange}
              />
            </div>
          </div>

          <div
            className={`sp-canvas-stack${expandedKpi === "pips" ? " sp-canvas-stack--pips" : ""}${expandedKpi === "dd" ? " sp-canvas-stack--dd" : ""}`}
          >
            {overview.error ? (
              <InlineState
                tone="error"
                title="Card unavailable"
                message={overview.error ?? "Failed to load dashboard card."}
              />
            ) : overview.loading && !overview.data ? (
              <div
                className="skeleton-chart account-card__chart-skeleton"
                aria-hidden="true"
              />
            ) : (
              <div className="sp-canvas">
                <div className="sp-canvas__chart">
                  <SparklineChart
                    points={sparklinePoints}
                    active={active}
                    tone="neutral"
                    onHighlightBalanceChange={(value) => {
                      setHighlightedBalanceState({
                        scope: "overall",
                        value,
                      });
                    }}
                    timeframe={timeframe}
                    liveTimestamp={accountSource.last_updated}
                    liveBalance={accountSource.balance}
                    equityPoints={
                      timeframe === "1d"
                        ? balanceDetail.data?.equityCurve
                        : undefined
                    }
                    liveEquityValue={
                      timeframe === "1d"
                        ? (liveLiveInfo?.equity ?? accountSource.equity)
                        : undefined
                    }
                    showLiveBeacon={
                      timeframe === "1d" && showLiveBridgeSnapshot
                    }
                    showAxisLabels
                    reactionTarget={(() => {
                      if (timeframe !== "1d") return undefined;
                      const dateKey = getBangkokDateKey(new Date());
                      return dateKey
                        ? { accountId: account.id, date: dateKey }
                        : undefined;
                    })()}
                  />
                </div>
              </div>
            )}
            {compactKpiPanel}
          </div>
        </div>

        <div className="kpi-stack" role="region" aria-label="ตัวชี้วัดสำคัญ">
          <div className="kgrid">
            {kpiItems.map((item) => {
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
                  onClick={() => handleChipToggle(expandKey)}
                  isSelected={expandedKpi === expandKey}
                />
              );
            })}
          </div>
        </div>

        {expandedKpi === "dd" ? (
          <section
            className="kpi-detail-panel"
            aria-label="Drawdown panel tabs"
          >
            <div className="kpi-detail-grid">
              <SummaryChip
                label="ABS"
                value={formatCompactNumber(
                  kpiValue(balanceDetail.data?.summary.absoluteDrawdown),
                  1,
                )}
                tone={drawdownTone(
                  kpiValue(balanceDetail.data?.summary.absoluteDrawdown),
                )}
                meta="Abs DD"
                isSelected={ddSubPanel === "abs"}
                onClick={() =>
                  setDdSubPanel(ddSubPanel === "abs" ? "dd" : "abs")
                }
              />
              <SummaryChip
                label={maeMfeMetric.label}
                value={
                  balanceDetail.data?.mfeMae?.available
                    ? balanceDetail.data.mfeMae.truncated
                      ? "500+"
                      : String(
                          balanceDetail.data.mfeMae.points.filter(
                            (point) =>
                              point.mae != null &&
                              point.mfe != null &&
                              Number.isFinite(point.mae) &&
                              Number.isFinite(point.mfe),
                          ).length,
                        )
                    : "-"
                }
                tone="neutral"
                meta={maeMfeMetric.meta}
                hint={maeMfeMetric.hint}
                isSelected={ddSubPanel === "max"}
                onClick={() =>
                  setDdSubPanel(ddSubPanel === "max" ? "dd" : "max")
                }
              />
              <SummaryChip
                label="WIN"
                value={formatPlainPercent(
                  kpiValue(overview.data?.kpis.winPercent),
                  1,
                )}
                tone={winRateTone(overview.data?.kpis.winPercent)}
                meta="Win %"
                isSelected={ddSubPanel === "win"}
                onClick={() =>
                  setDdSubPanel(ddSubPanel === "win" ? "dd" : "win")
                }
              />
              <SummaryChip
                label="EXPECT"
                value={formatCompactSignedNumber(
                  positionsDetail.data?.summary.expectedPayoff,
                  1,
                )}
                tone={toneFromNumber(
                  positionsDetail.data?.summary.expectedPayoff,
                )}
                meta="Per trade"
                isSelected={ddSubPanel === "expect"}
                onClick={() =>
                  setDdSubPanel(ddSubPanel === "expect" ? "dd" : "expect")
                }
              />
            </div>
          </section>
        ) : expandedKpi && detailRows.length ? (
          <section
            className="kpi-detail-panel"
            aria-label={`${kpiItems.find((item) => item.key === expandedKpi)?.label ?? "KPI"} details`}
          >
            {detailState?.error ? (
              <InlineState
                tone="error"
                title="KPI unavailable"
                message={detailState.error}
              />
            ) : detailState?.loading && !detailState?.data ? (
              <div className="kpi-detail-grid" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="kpi-detail-item kpi-detail-item--skeleton"
                  />
                ))}
              </div>
            ) : (
              <div className="kpi-detail-grid">
                {detailRows.map((row) => (
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
            )}
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
