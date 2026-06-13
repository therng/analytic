"use client";

import { memo, startTransition, useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trackKpiExpand, trackTimeframeChange } from "@/lib/analytics";

import type {
  AccountOverviewResponse,
  BalanceDetailResponse,
  PipsSummaryResponse,
  PositionsResponse,
  ProfitDetailResponse,
  SerializedAccount,
  Timeframe,
} from "@/lib/trading/types";

import {
  formatCompactCount,
  absDrawdownTone,
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
} from "@/components/trading-monitor/shared";
import {
  ExpandableKpiKey,
  formatCompactPercent,
  formatPlainNumberValue,
  formatSignedPlainNumberValue,
} from "@/components/trading-monitor/DashboardFormatters";
import { SummaryChip } from "@/components/trading-monitor/SummaryChip";
import { OpenPositionsPanel } from "@/components/trading-monitor/OpenPositionsPanel";
import { TradeHistoryPanel } from "@/components/trading-monitor/TradeHistoryPanel";
import { PipsPerformanceTable } from "@/components/trading-monitor/PipsPerformanceTable";
import { ProfitHeatmapPanel } from "@/components/trading-monitor/ProfitHeatmapPanel";
import { BotPnLPanel } from "@/components/trading-monitor/BotPnLPanel";
import { PerformanceRadar } from "@/components/trading-monitor/PerformanceRadar";
import { PerformanceBars, PerformanceBarsPanel } from "@/components/trading-monitor/PerformanceBars";
import { PerformanceQualityPanel } from "@/components/trading-monitor/PerformanceQualityPanel";
import { PiePanel } from "@/components/trading-monitor/PiePanel";
import { TradingViewAnalysisModal } from "@/components/trading-monitor/TradingViewAnalysisModal";
import { useApiResource } from "@/components/trading-monitor/useApiResource";
import { EmojiReactionBar } from "@/components/social/EmojiReactionBar";

function formatRatioValue(value: number | null | undefined, digits = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return formatPlainNumberValue(value, digits);
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

export const DashboardCard = memo(function DashboardCard({
  account,
  refreshKey,
  onRequestStateChange,
}: {
  account: SerializedAccount;
  refreshKey: number;
  onRequestStateChange: (request: { loading: boolean; refreshKey: number }) => void;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [expandedKpi, setExpandedKpi] = useState<ExpandableKpiKey | null>(null);
  const [highlightedBalanceState, setHighlightedBalanceState] = useState<{
    scope: "overall" | "timeframe";
    value: number | null;
  }>({ scope: "timeframe", value: null });
  const [ddSubPanel, setDdSubPanel] = useState<"dd" | "abs" | "max" | "load" | "expect">("dd");
  const [isTechnicalAnalysisOpen, setIsTechnicalAnalysisOpen] = useState(false);

  const handleTimeframeChange = useCallback((value: Timeframe) => {
    trackTimeframeChange(account.id, value);
    startTransition(() => {
      setTimeframe(value);
      setHighlightedBalanceState({ scope: "timeframe", value: null });
    });
  }, [account.id]);

  const handleChipToggle = useCallback((key: ExpandableKpiKey) => {
    setExpandedKpi((current) => {
      const next = current === key ? null : key;
      if (next) {
        trackKpiExpand(account.id, next);
      }
      return next;
    });
  }, [account.id]);

  const overview = useApiResource<AccountOverviewResponse>(
    `/api/accounts/${account.id}/overview?timeframe=${timeframe}`,
    { refreshKey, onRequestStateChange }
  );

  const balanceDetail = useApiResource<BalanceDetailResponse>(
    `/api/accounts/${account.id}/balance?timeframe=${timeframe}`,
    { refreshKey, onRequestStateChange }
  );

  const pipsDetail = useApiResource<PipsSummaryResponse>(
    `/api/accounts/${account.id}/pips?timeframe=${timeframe}`,
    { refreshKey, onRequestStateChange }
  );

  const positionsDetail = useApiResource<PositionsResponse>(
    `/api/accounts/${account.id}/positions`,
    { refreshKey, onRequestStateChange }
  );

  const profitDetail = useApiResource<ProfitDetailResponse>(
    `/api/accounts/${account.id}/profit?timeframe=${timeframe}`,
    { refreshKey, onRequestStateChange }
  );

  const accountSource = account;
  const active = account.status === "Active";
  const accountLabel = account.account_number ? `#${account.account_number}` : "Unnumbered";
  const accountDisplayName = displayName(account);

  const growthTone = overview.data ? drawdownTone(overview.data.kpis.periodGrowth) : "muted";
  const displayedGrowth = formatPercent(overview.data?.kpis.periodGrowth, 1);

  const highlightedBalance = highlightedBalanceState.value;
  const highlightedBalanceScope = highlightedBalanceState.scope;
  const displayedBalance = highlightedBalance !== null ? highlightedBalance : accountSource.balance;
  const displayedBalanceLabel = formatCurrency(displayedBalance, 2);

  const sparklinePoints = balanceDetail.data?.balanceCurve ?? [];

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
      key: "growth",
      label: "GROWTH",
      value: formatPercent(overview.data?.kpis.periodGrowth, 1),
      tone: overview.data ? drawdownTone(overview.data.kpis.periodGrowth) : "muted",
      meta: "Since inception",
      fullValue: formatPercent(overview.data?.kpis.periodGrowth, 2),
      hint: "กำไรรวมตั้งแต่เริ่มต้นบัญชี",
    },
    {
      key: "pips",
      label: "PIPS",
      value: formatCompactSignedNumber(overview.data?.kpis.netPips),
      tone: toneFromNumber(overview.data?.kpis.netPips),
      meta: "Total points",
      fullValue: formatPlainNumberValue(overview.data?.kpis.netPips, 0),
      expandKey: "pips" as ExpandableKpiKey,
      hint: "ผลรวมระยะการเทรด (Points/Pips)",
    },
    {
      key: "profit",
      label: "PROFIT",
      value: formatCompactSignedNumber(overview.data?.kpis.netProfit, 1),
      tone: toneFromNumber(overview.data?.kpis.netProfit),
      meta: "Net income",
      fullValue: formatSignedCurrency(overview.data?.kpis.netProfit, 2),
      expandKey: "profit" as ExpandableKpiKey,
      hint: "กำไรสุทธิหลังหักค่าธรรมเนียม",
    },
    {
      key: "opens",
      label: "OPENS",
      value: formatCompactCount(positionsDetail.data?.openPositions?.length),
      tone: (positionsDetail.data?.openPositions?.length ?? 0) > 0 ? "info" : "neutral",
      meta: "Live trades",
      fullValue: `${positionsDetail.data?.openPositions?.length ?? 0} active positions`,
      expandKey: "opens" as ExpandableKpiKey,
      hint: "จำนวนออเดอร์ที่กำลังถือครองอยู่",
    },
    {
      key: "dd",
      label: "DRAWDOWN",
      value: formatPercent(overview.data?.kpis.drawdown, 1),
      tone: overview.data ? absDrawdownTone(overview.data.kpis.drawdown) : "muted",
      meta: "Max floating",
      fullValue: formatPercent(overview.data?.kpis.drawdown, 2),
      expandKey: "dd" as ExpandableKpiKey,
      hint: "ความเสี่ยงสูงสุด (ติดลบที่เคยเกิดขึ้น)",
    },
  ];

  const kpiRows = [
    kpiItems.slice(0, 3),
    kpiItems.slice(3),
  ];

  const detailState =
    expandedKpi === "pips" ? pipsDetail :
    expandedKpi === "profit" ? profitDetail :
    expandedKpi === "opens" ? positionsDetail :
    null;

  const detailRows: {
    label: string;
    value: string;
    tone?: any;
    meta?: string;
    fullValue?: string;
    hint?: any;
    onClick?: () => void;
  }[] = [];

  if (expandedKpi === "pips") {
    detailRows.push(
      { label: "WIN RATE", value: formatPercent(overview.data?.kpis.winPercent, 0), meta: "Probability" },
      { label: "AVG WIN", value: formatPlainNumberValue(positionsDetail.data?.summary.averageWinningPips, 1), tone: "positive", meta: "Points" },
      { label: "NET PIPS", value: formatPlainNumberValue(overview.data?.kpis.netPips, 0), tone: toneFromNumber(overview.data?.kpis.netPips), meta: "Total" },
    );
  } else if (expandedKpi === "profit" && profitDetail.data) {
    detailRows.push(
      { label: "PROFIT FACTOR", value: formatRatioValue(profitDetail.data.summary.profitFactor), meta: "Risk/Reward" },
      { label: "SHARPE", value: formatRatioValue(positionsDetail.data?.summary.sharpeRatio), meta: "Efficiency" },
      { label: "HOLDING", value: formatAverageHoldTime(positionsDetail.data?.summary.averageHoldHours), meta: "Duration" },
    );
  }

  const compactKpiPanel = (
    <AnimatePresence mode="wait">
      {expandedKpi === "pips" ? (
        <motion.div key="pips" className="sp-panel-overlay" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }}>
          <PipsPerformanceTable rows={pipsDetail.data?.rows ?? []} />
        </motion.div>
      ) : expandedKpi === "profit" ? (
        <motion.div key="profit" className="sp-panel-overlay" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }}>
          <ProfitHeatmapPanel positions={positionsDetail.data?.historyPositions} loading={profitDetail.loading} />
        </motion.div>
      ) : expandedKpi === "opens" ? (
        <motion.div key="opens" className="sp-panel-overlay" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }}>
          <OpenPositionsPanel
            positions={positionsDetail.data?.openPositions}
            loading={positionsDetail.loading}
            error={positionsDetail.error}
            onOpenTechnicalAnalysis={() => setIsTechnicalAnalysisOpen(true)}
          />
        </motion.div>
      ) : expandedKpi === "dd" ? (
        <motion.div key={`dd-${ddSubPanel}`} className="sp-panel-overlay" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }}>
          {ddSubPanel === "dd" && (
            <BotPnLPanel positions={positionsDetail.data?.historyPositions} />
          )}
          {ddSubPanel === "abs" && (
            <PerformanceRadar balanceDetail={balanceDetail} overview={overview} />
          )}
          {ddSubPanel === "max" && (
            <PerformanceQualityPanel
              sharpeRatio={positionsDetail.data?.summary.sharpeRatio}
              profitFactor={positionsDetail.data?.summary.profitFactor}
              recoveryFactor={positionsDetail.data?.summary.recoveryFactor}
              winPercent={overview.data?.kpis.winPercent}
              averageProfitTrade={positionsDetail.data?.summary.averageProfitTrade}
              averageLossTrade={balanceDetail.data?.summary.averageLossTrade}
              longTradesTotal={positionsDetail.data?.summary.longTradesTotal}
              shortTradesTotal={positionsDetail.data?.summary.shortTradesTotal}
              largestProfitTrade={positionsDetail.data?.summary.largestProfitTrade}
              largestLossTrade={positionsDetail.data?.summary.largestLossTrade}
              maximumConsecutiveWins={positionsDetail.data?.summary.maximumConsecutiveWins}
              maximumConsecutiveLosses={positionsDetail.data?.summary.maximumConsecutiveLosses}
              maxConsecutiveProfitAmount={positionsDetail.data?.summary.maxConsecutiveProfitAmount}
              maxConsecutiveLossAmount={positionsDetail.data?.summary.maxConsecutiveLossAmount}
              variant="gauges"
            />
          )}
          {ddSubPanel === "load" && (
            positionsDetail.loading && !positionsDetail.data ? (
              <div className="skeleton-chart account-card__chart-skeleton" aria-hidden="true" />
            ) : (
              <PerformanceBars
                averageProfitTrade={positionsDetail.data?.summary.averageProfitTrade}
                averageLossTrade={balanceDetail.data?.summary.averageLossTrade}
                longTradesTotal={positionsDetail.data?.summary.longTradesTotal}
                shortTradesTotal={positionsDetail.data?.summary.shortTradesTotal}
                largestProfitTrade={positionsDetail.data?.summary.largestProfitTrade}
                largestLossTrade={positionsDetail.data?.summary.largestLossTrade}
                maximumConsecutiveWins={positionsDetail.data?.summary.maximumConsecutiveWins}
                maximumConsecutiveLosses={positionsDetail.data?.summary.maximumConsecutiveLosses}
                maxConsecutiveProfitAmount={positionsDetail.data?.summary.maxConsecutiveProfitAmount}
                maxConsecutiveLossAmount={positionsDetail.data?.summary.maxConsecutiveLossAmount}
              />
            )
          )}
          {ddSubPanel === "expect" && (
            <PiePanel positionsDetail={positionsDetail} />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  const opensIsEmpty =
    expandedKpi === "opens" &&
    !positionsDetail.loading &&
    !positionsDetail.error &&
    (positionsDetail.data?.openPositions?.length ?? 0) === 0 &&
    !!positionsDetail.data;

  return (
    <>
      <article className={`card account-card ${active ? "account-card--active" : "account-card--inactive"}`}>
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
                  className={active && highlightedBalance === null ? "sp-balance is-current-live" : "sp-balance"}
                  aria-label={`Balance ${displayedBalanceLabel}`}
                >
                  <strong>{displayedBalanceLabel}</strong>
                </div>
              </div>
            </div>

            <div className="tf-row">
              <TimeframeStrip active={timeframe} onChange={handleTimeframeChange} />
            </div>
          </div>

          <div style={{ padding: "4px 12px 6px" }}>
            <EmojiReactionBar targetType="ACCOUNT" targetId={account.id} compact />
          </div>

          <div
            className={`sp-canvas-stack${expandedKpi === "pips" ? " sp-canvas-stack--pips" : ""}${expandedKpi === "dd" ? " sp-canvas-stack--dd" : ""}`}
          >
            {overview.error ? (
              <InlineState tone="error" title="Card unavailable" message={overview.error ?? "Failed to load dashboard card."} />
            ) : overview.loading && !overview.data ? (
              <div className="skeleton-chart account-card__chart-skeleton" aria-hidden="true" />
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
                  />
                </div>
              </div>
            )}
            <AnimatePresence mode="sync">
              {compactKpiPanel}
            </AnimatePresence>
          </div>
        </div>

        <div className="kpi-stack">
          {kpiRows.map((row, rowIndex) => (
            <div key={`kpi-row-${rowIndex}`} className={`kgrid ${rowIndex > 0 ? "kgrid--subrow" : ""}`}>
              {row.map((item) => {
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
          ))}
        </div>

        <AnimatePresence>
          {opensIsEmpty ? (
            <motion.section key="opens-empty" className="kpi-detail-panel"
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
              <button
                type="button"
                className="open-positions-empty__cta"
                onClick={() => setIsTechnicalAnalysisOpen(true)}
              >
                <span className="open-positions-empty__cta-title">วิเคราะห์ทางเทคนิค</span>
                <span className="open-positions-empty__cta-symbol">XAUUSD</span>
              </button>
            </motion.section>
          ) : expandedKpi === "dd" ? (
            <motion.section key="dd-tabs" className="kpi-detail-panel"
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              aria-label="Drawdown panel tabs">
              <div className="kpi-detail-grid">
                <SummaryChip
                  label="DD"
                  value={formatPercent(overview.data?.kpis.drawdown, 1)}
                  tone={overview.data ? absDrawdownTone(overview.data.kpis.drawdown) : "muted"}
                  meta="Bot PnL"
                  isSelected={ddSubPanel === "dd"}
                  onClick={() => setDdSubPanel("dd")}
                />
                <SummaryChip
                  label="ABS"
                  value={formatRatioValue(positionsDetail.data?.summary.sharpeRatio)}
                  tone="neutral"
                  meta="Sharpe"
                  isSelected={ddSubPanel === "abs"}
                  onClick={() => setDdSubPanel("abs")}
                />
                <SummaryChip
                  label="MAX"
                  value={formatRatioValue(positionsDetail.data?.summary.profitFactor)}
                  tone="neutral"
                  meta="Profit F."
                  isSelected={ddSubPanel === "max"}
                  onClick={() => setDdSubPanel("max")}
                />
                <SummaryChip
                  label="LOAD"
                  value={formatPercent(balanceDetail.data?.summary.maximalDepositLoad, 0)}
                  tone="neutral"
                  meta="Deposit"
                  isSelected={ddSubPanel === "load"}
                  onClick={() => setDdSubPanel("load")}
                />
                <SummaryChip
                  label="EXPECT"
                  value={formatCompactSignedNumber(positionsDetail.data?.summary.expectedPayoff, 1)}
                  tone={toneFromNumber(positionsDetail.data?.summary.expectedPayoff)}
                  meta="Per trade"
                  isSelected={ddSubPanel === "expect"}
                  onClick={() => setDdSubPanel("expect")}
                />
              </div>
            </motion.section>
          ) : (expandedKpi && detailRows.length && !opensIsEmpty) ? (
            <motion.section key={`detail-${expandedKpi}`} className="kpi-detail-panel"
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              aria-label={`${kpiItems.find((item) => item.key === expandedKpi)?.label ?? "KPI"} details`}>
              {detailState?.error ? (
                <InlineState tone="error" title="KPI unavailable" message={detailState.error} />
              ) : detailState?.loading && !detailState?.data ? (
                <div className="kpi-detail-grid" aria-hidden="true">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="kpi-detail-item kpi-detail-item--skeleton" />
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
                    />
                  ))}
                </div>
              )}
            </motion.section>
          ) : null}
        </AnimatePresence>
      </article>
      <TradingViewAnalysisModal
        open={isTechnicalAnalysisOpen}
        onClose={() => setIsTechnicalAnalysisOpen(false)}
      />
    </>
  );
});

DashboardCard.displayName = "DashboardCard";
