"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import type { BalanceDetailResponse, PositionsResponse } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/shared";
import { KpiPreviewCard, useKpiHint, type KpiHintContent } from "@/components/trading-monitor/SummaryChip";
import {
  formatCompactNumber,
  formatCompactSignedNumber,
  formatWholeNumber,
  type MetricTone,
} from "@/components/trading-monitor/formatters";

interface ComparisonBarMetricConfig {
  value: string;
  tone: MetricTone;
}

interface ComparisonBarConfig {
  key: string;
  title: string;
  ariaLabel: string;
  left: ComparisonBarMetricConfig;
  right: ComparisonBarMetricConfig;
  leftWidth: number;
  rightWidth: number;
  leftColor: string;
  rightColor: string;
  hasValue: boolean;
  hint?: KpiHintContent;
}

interface PerformanceBarsProps {
  averageProfitTrade?: number | null | undefined;
  averageLossTrade?: number | null | undefined;
  longTradesTotal?: number | null | undefined;
  shortTradesTotal?: number | null | undefined;
  largestProfitTrade?: number | null | undefined;
  largestLossTrade?: number | null | undefined;
  maximumConsecutiveWins?: number | null | undefined;
  maximumConsecutiveLosses?: number | null | undefined;
  maxConsecutiveProfitAmount?: number | null | undefined;
  maxConsecutiveLossAmount?: number | null | undefined;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteOrNull(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? value : null;
}

function toAbsFiniteOrNull(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? Math.abs(value) : null;
}

function formatNegativeCompactValue(value: number | null | undefined, digits = 1) {
  if (!isFiniteNumber(value)) return "-";

  const amount = Math.abs(value);
  return amount > 0 ? `-${formatCompactNumber(amount, digits)}` : formatCompactNumber(0, digits);
}

function buildSplitWidths(leftValue: number | null | undefined, rightValue: number | null | undefined) {
  const hasLeft = isFiniteNumber(leftValue);
  const hasRight = isFiniteNumber(rightValue);
  const leftAmount = hasLeft ? Math.abs(leftValue) : 0;
  const rightAmount = hasRight ? Math.abs(rightValue) : 0;
  const hasValue = hasLeft || hasRight;

  if (!hasValue) return { hasValue, leftWidth: 50, rightWidth: 50 };

  const total = leftAmount + rightAmount;
  if (total <= 0) return { hasValue, leftWidth: 50, rightWidth: 50 };

  return {
    hasValue,
    leftWidth: hasLeft ? (leftAmount / total) * 100 : 0,
    rightWidth: hasRight ? (rightAmount / total) * 100 : 0,
  };
}

function buildAverageProfitLossBar(input: Pick<PerformanceBarsProps, "averageProfitTrade" | "averageLossTrade">): ComparisonBarConfig {
  const profitValue = toFiniteOrNull(input.averageProfitTrade);
  const lossValue = toAbsFiniteOrNull(input.averageLossTrade);
  const widths = buildSplitWidths(profitValue, lossValue);

  return {
    key: "avg-profit-loss",
    title: "AVG P/L",
    hint: { definition: "เปรียบเทียบกำไรเฉลี่ยกับขาดทุนเฉลี่ย" },
    ariaLabel: `Average profit ${profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "no data"} average loss ${lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "no data"}`,
    left: {
      value: profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "—",
      tone: profitValue == null ? "muted" : profitValue > 0 ? "positive" : profitValue < 0 ? "negative" : "neutral",
    },
    right: {
      value: lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "—",
      tone: lossValue == null ? "muted" : lossValue > 0 ? "negative" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

function buildLongShortTradeBar(input: Pick<PerformanceBarsProps, "longTradesTotal" | "shortTradesTotal">): ComparisonBarConfig {
  const longValue = toFiniteOrNull(input.longTradesTotal);
  const shortValue = toFiniteOrNull(input.shortTradesTotal);
  const widths = buildSplitWidths(longValue, shortValue);
  const totalTrades = (longValue ?? 0) + (shortValue ?? 0);

  return {
    key: "long-short",
    title: "LONG / SHORT",
    hint: { definition: "จำนวน Buy กับ Sell" },
    ariaLabel: `Long trades ${longValue != null ? formatWholeNumber(longValue) : "no data"} short trades ${shortValue != null ? formatWholeNumber(shortValue) : "no data"} total ${totalTrades > 0 ? formatWholeNumber(totalTrades) : "no data"}`,
    left: {
      value: longValue != null ? formatWholeNumber(longValue) : "—",
      tone: longValue == null ? "muted" : "neutral",
    },
    right: {
      value: shortValue != null ? formatWholeNumber(shortValue) : "—",
      tone: shortValue == null ? "muted" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--neutral)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

function buildBestWorstTradeBar(input: Pick<PerformanceBarsProps, "largestProfitTrade" | "largestLossTrade">): ComparisonBarConfig {
  const bestValue = toFiniteOrNull(input.largestProfitTrade);
  const worstValue = toAbsFiniteOrNull(input.largestLossTrade);
  const widths = buildSplitWidths(bestValue, worstValue);

  return {
    key: "best-worst",
    title: "BEST / WORST",
    hint: { definition: "กำไรสูงสุดและขาดทุนสูงสุดต่อการเทรด" },
    ariaLabel: `Best trade ${bestValue != null ? formatCompactSignedNumber(bestValue, 1) : "no data"} worst trade ${worstValue != null ? formatNegativeCompactValue(worstValue, 1) : "no data"}`,
    left: {
      value: bestValue != null ? formatCompactSignedNumber(bestValue, 1) : "—",
      tone: bestValue == null ? "muted" : bestValue > 0 ? "positive" : "neutral",
    },
    right: {
      value: worstValue != null ? formatNegativeCompactValue(worstValue, 1) : "—",
      tone: worstValue == null ? "muted" : worstValue > 0 ? "negative" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

function buildConsecutiveWinsLossesBar(input: Pick<PerformanceBarsProps, "maximumConsecutiveWins" | "maximumConsecutiveLosses">): ComparisonBarConfig {
  const winsValue = toFiniteOrNull(input.maximumConsecutiveWins);
  const lossesValue = toFiniteOrNull(input.maximumConsecutiveLosses);
  const widths = buildSplitWidths(winsValue, lossesValue);

  return {
    key: "consec-wins-losses",
    title: "STREAK",
    hint: { definition: "จำนวนชนะและแพ้ติดต่อกันสูงสุด" },
    ariaLabel: `Max consecutive wins ${winsValue != null ? formatWholeNumber(winsValue) : "no data"} max consecutive losses ${lossesValue != null ? formatWholeNumber(lossesValue) : "no data"}`,
    left: {
      value: winsValue != null ? formatWholeNumber(winsValue) : "—",
      tone: winsValue == null ? "muted" : "positive",
    },
    right: {
      value: lossesValue != null ? formatWholeNumber(lossesValue) : "—",
      tone: lossesValue == null ? "muted" : "negative",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

function buildConsecutiveProfitLossBar(input: Pick<PerformanceBarsProps, "maxConsecutiveProfitAmount" | "maxConsecutiveLossAmount">): ComparisonBarConfig {
  const profitValue = toFiniteOrNull(input.maxConsecutiveProfitAmount);
  const lossValue = toFiniteOrNull(input.maxConsecutiveLossAmount);
  const widths = buildSplitWidths(profitValue, lossValue);

  return {
    key: "consec-profit-loss",
    title: "CONSEC P/L",
    hint: { definition: "กำไรและขาดทุนสะสมสูงสุดจากการเทรดต่อเนื่อง" },
    ariaLabel: `Max consecutive profit ${profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "no data"} max consecutive loss ${lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "no data"}`,
    left: {
      value: profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "—",
      tone: profitValue == null ? "muted" : profitValue > 0 ? "positive" : "neutral",
    },
    right: {
      value: lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "—",
      tone: lossValue == null ? "muted" : lossValue > 0 ? "negative" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

function ComparisonBar({ config }: { config: ComparisonBarConfig }) {
  const {
    chipRef: triggerRef,
    sheetOpen,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  } = useKpiHint(Boolean(config.hint));

  return (
    <motion.div
      whileTap={config.hint ? { scale: 0.985 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      ref={triggerRef as React.RefObject<HTMLDivElement>}
      className={`comparison-bar${config.hint ? " comparison-bar--hintable" : ""}`}
      role="img"
      aria-label={config.ariaLabel}
      onClick={wrapClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
    >
      <div className="comparison-bar__title-row">
        <span className="comparison-bar__title">{config.title}</span>
      </div>
      <div className="comparison-bar__track" data-empty={!config.hasValue ? "true" : undefined}>
        <div className="comparison-bar__segment comparison-bar__segment--left" style={{ width: `${config.leftWidth}%`, background: config.leftColor }} />
        <div className="comparison-bar__segment comparison-bar__segment--right" style={{ width: `${config.rightWidth}%`, background: config.rightColor }} />
      </div>
      <div className="comparison-bar__values">
        <span className="comparison-bar__item">
          <span className={`comparison-bar__value tone-${config.left.tone}`} style={{ color: config.leftColor }}>
            {config.left.value}
          </span>
        </span>
        <span className="comparison-bar__item comparison-bar__item--right">
          <span className={`comparison-bar__value tone-${config.right.tone}`} style={{ color: config.rightColor }}>
            {config.right.value}
          </span>
        </span>
      </div>
      {config.hint && sheetOpen ? (
        <KpiPreviewCard hint={config.hint} label={config.title} onClose={closeSheet} triggerRef={triggerRef} />
      ) : null}
    </motion.div>
  );
}

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface PerformanceBarsResourceProps {
  variant: "load";
  balanceDetail?: ResourceState<BalanceDetailResponse>;
  positionsDetail: ResourceState<PositionsResponse>;
}

function PerformanceBarsImpl(props: PerformanceBarsProps) {
  const bars = [
    props.averageProfitTrade !== undefined || props.averageLossTrade !== undefined
      ? buildAverageProfitLossBar(props)
      : null,
    props.longTradesTotal !== undefined || props.shortTradesTotal !== undefined
      ? buildLongShortTradeBar(props)
      : null,
    props.largestProfitTrade !== undefined || props.largestLossTrade !== undefined
      ? buildBestWorstTradeBar(props)
      : null,
    props.maximumConsecutiveWins !== undefined || props.maximumConsecutiveLosses !== undefined
      ? buildConsecutiveWinsLossesBar(props)
      : null,
    props.maxConsecutiveProfitAmount !== undefined || props.maxConsecutiveLossAmount !== undefined
      ? buildConsecutiveProfitLossBar(props)
      : null,
  ].filter((config): config is ComparisonBarConfig => config !== null);

  return (
    <div className="perf-quality-panel perf-quality-panel--bars" role="region" aria-label="Performance comparison bars">
      {bars.map((config) => (
        <ComparisonBar key={config.key} config={config} />
      ))}
    </div>
  );
}

function PerformanceBarsResourceImpl({ variant, balanceDetail, positionsDetail }: PerformanceBarsResourceProps) {
  const errorMsg = positionsDetail.error ?? balanceDetail?.error;
  if (errorMsg) {
    return <InlineState tone="error" title="Metrics unavailable" message={errorMsg} />;
  }
  const loading =
    (positionsDetail.loading && !positionsDetail.data) ||
    (balanceDetail ? balanceDetail.loading && !balanceDetail.data : false);
  if (loading) {
    return <div className="skeleton-chart account-card__chart-skeleton" aria-hidden="true" />;
  }

  return (
    <PerformanceBarsImpl
      largestProfitTrade={positionsDetail.data?.summary.largestProfitTrade}
      largestLossTrade={positionsDetail.data?.summary.largestLossTrade}
      maximumConsecutiveWins={positionsDetail.data?.summary.maximumConsecutiveWins}
      maximumConsecutiveLosses={positionsDetail.data?.summary.maximumConsecutiveLosses}
      maxConsecutiveProfitAmount={positionsDetail.data?.summary.maxConsecutiveProfitAmount}
      maxConsecutiveLossAmount={positionsDetail.data?.summary.maxConsecutiveLossAmount}
    />
  );
}

export const PerformanceBars = memo(PerformanceBarsImpl);
export const PerformanceBarsPanel = memo(PerformanceBarsResourceImpl);
