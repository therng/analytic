"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { BalanceDetailResponse, Timeframe } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/MonitorShared";
import {
  formatSparklineXLabel,
  formatTooltipDateLabel,
  formatTooltipTimeLabel,
} from "@/lib/time";
import {
  formatCompactNumber,
  formatCurrency,
} from "@/components/trading-monitor/formatters";
import {
  DRAWDOWN_CHART_HEIGHT,
  DRAWDOWN_CHART_WIDTH,
  buildBalanceDepositLoadChart,
  nearestProjectedPointByX,
} from "@/components/trading-monitor/drawdown-chart";

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Props {
  balanceDetail: ResourceState<BalanceDetailResponse>;
  timeframe?: Timeframe;
}

function DrawdownPanelImpl({ balanceDetail, timeframe = "1d" }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // A stale index from before a timeframe switch or data refresh would point
  // into the old series' array, not the new one — clear it so the crosshair
  // never shows a value at the wrong position.
  useEffect(() => {
    setActiveIndex(null);
  }, [timeframe, balanceDetail.data]);

  const { balance, depositLoad, chart } = useMemo(() => {
    const balance = balanceDetail.data?.balanceCurve ?? [];
    const depositLoad = balanceDetail.data?.depositLoadCurve ?? [];
    return {
      balance,
      depositLoad,
      chart: buildBalanceDepositLoadChart(balance, depositLoad, timeframe),
    };
  }, [balanceDetail.data, timeframe]);

  const startLabel = balance[0]
    ? formatSparklineXLabel(balance[0].x, timeframe)
    : null;
  const endLabel = balance[balance.length - 1]
    ? formatSparklineXLabel(balance[balance.length - 1]!.x, timeframe)
    : null;
  const midIndex = Math.floor(balance.length / 2);
  const midLabel = balance[midIndex]
    ? formatSparklineXLabel(balance[midIndex]!.x, timeframe)
    : null;
  const showEndLabel = endLabel !== null && endLabel !== startLabel;
  const showMidLabel =
    midLabel !== null && midLabel !== startLabel && midLabel !== endLabel;
  const startPoint = chart.balancePoints[0];
  const midPoint = chart.balancePoints[midIndex];
  const endPoint = chart.balancePoints[chart.balancePoints.length - 1];

  // Hover/tap crosshair — the last point by default so the panel always
  // reads a value, same convention as SparklineChart's activeIndex fallback.
  const lastIndex = chart.balancePoints.length - 1;
  const activePointIndex = activeIndex ?? lastIndex;
  const activePoint = chart.balancePoints[activePointIndex];
  const activeBalance = activePoint
    ? balance[activePoint.sourceIndex]
    : undefined;
  const activeDepositLoadPoint = activePoint
    ? nearestProjectedPointByX(chart.depositLoadPoints, activePoint.x)
    : undefined;
  const activeDepositLoad = activeDepositLoadPoint
    ? depositLoad[activeDepositLoadPoint.sourceIndex]
    : undefined;
  const tooltipTimeLabel = activeBalance
    ? timeframe === "1d"
      ? formatTooltipTimeLabel(activeBalance.x)
      : formatTooltipDateLabel(activeBalance.x)
    : null;
  const tooltipLeftPct = activePoint
    ? (activePoint.x / DRAWDOWN_CHART_WIDTH) * 100
    : 50;
  const tooltipNearLeft = tooltipLeftPct < 30;
  const tooltipTransform =
    tooltipLeftPct > 70
      ? "translate(-100%, 0)"
      : tooltipNearLeft
        ? "translate(0, 0)"
        : "translate(-50%, 0)";
  // Near-left tooltip shares top:0/left:2px with the legend — drop it below
  // the legend row so the two don't overlap.
  const tooltipTop = tooltipNearLeft ? 16 : 0;

  if (balanceDetail.error) {
    return <InlineState tone="error" title="Drawdown unavailable" message={balanceDetail.error} />;
  }
  if (balanceDetail.loading && !balanceDetail.data) {
    return <div className="skeleton-chart account-card__chart-skeleton" />;
  }
  if (!chart.balancePoints.length) {
    return <InlineState tone="empty" title="No balance history yet" message="" />;
  }

  return (
    <div
      className="dd-equity-panel"
      role="region"
      aria-label="Balance and deposit load chart"
    >
      <div className="dd-equity-panel__legend" aria-hidden="true">
        <span className="dd-equity-panel__legend-item dd-equity-panel__legend-item--balance">
          Balance
        </span>
        <span className="dd-equity-panel__legend-item dd-equity-panel__legend-item--deposit-load">
          Deposit Load
        </span>
      </div>
      <div className="dd-equity-panel__axis dd-equity-panel__axis--balance" aria-hidden="true">
        {chart.balanceTicks.map((tick) => (
          <span
            key={tick.value}
            style={{
              top: `${(tick.y / DRAWDOWN_CHART_HEIGHT) * 100}%`,
            }}
          >
            {formatCompactNumber(tick.value, 1)}
          </span>
        ))}
      </div>
      <div className="dd-equity-panel__axis dd-equity-panel__axis--deposit-load" aria-hidden="true">
        {chart.depositLoadTicks.map((tick) => (
          <span
            key={tick.value}
            style={{
              top: `${(tick.y / DRAWDOWN_CHART_HEIGHT) * 100}%`,
            }}
          >
            {formatCompactNumber(tick.value, 1)}%
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${DRAWDOWN_CHART_WIDTH} ${DRAWDOWN_CHART_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        onMouseLeave={() => setActiveIndex(null)}
      >
        {chart.depositLoadAreaPath ? (
          <path
            d={chart.depositLoadAreaPath}
            className="dd-equity-panel__deposit-load-area"
          />
        ) : null}
        {chart.balancePath ? (
          <path d={chart.balancePath} className="dd-equity-panel__balance" />
        ) : null}
        {chart.depositLoadPath ? (
          <path
            d={chart.depositLoadPath}
            className="dd-equity-panel__deposit-load"
          />
        ) : null}
        {activePoint ? (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1="0"
            y2={DRAWDOWN_CHART_HEIGHT}
            className="dd-equity-panel__crosshair"
          />
        ) : null}
        {chart.balancePoints.length ? (
          <circle
            cx={chart.balancePoints[chart.balancePoints.length - 1]!.x}
            cy={chart.balancePoints[chart.balancePoints.length - 1]!.y}
            r="2.8"
            className="dd-equity-panel__balance-dot"
          />
        ) : null}
        {chart.depositLoadPoints.length ? (
          <circle
            cx={
              chart.depositLoadPoints[chart.depositLoadPoints.length - 1]!.x
            }
            cy={
              chart.depositLoadPoints[chart.depositLoadPoints.length - 1]!.y
            }
            r="2.4"
            className="dd-equity-panel__deposit-load-dot"
          />
        ) : null}
        {activePoint ? (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="3.4"
            className="dd-equity-panel__balance-dot dd-equity-panel__balance-dot--active"
          />
        ) : null}
        {chart.balancePoints.map((point, index) => (
          <circle
            key={`${point.x}-${point.y}-${index}-hit`}
            cx={point.x}
            cy={point.y}
            r="22"
            className="dd-equity-panel__hit"
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() =>
              setActiveIndex((current) => (current === index ? null : index))
            }
            onTouchStart={(event) => {
              event.preventDefault();
              setActiveIndex((current) => (current === index ? null : index));
            }}
          />
        ))}
      </svg>
      {startLabel && startPoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={{
            left: `${(startPoint.x / DRAWDOWN_CHART_WIDTH) * 100}%`,
            transform: "translateX(0)",
          }}
          aria-hidden="true"
        >
          {startLabel}
        </span>
      ) : null}
      {showMidLabel && midPoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={{
            left: `${(midPoint.x / DRAWDOWN_CHART_WIDTH) * 100}%`,
            transform: "translateX(-50%)",
          }}
          aria-hidden="true"
        >
          {midLabel}
        </span>
      ) : null}
      {showEndLabel && endPoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={{
            left: `${(endPoint.x / DRAWDOWN_CHART_WIDTH) * 100}%`,
            transform: "translateX(-100%)",
          }}
          aria-hidden="true"
        >
          {endLabel}
        </span>
      ) : null}
      {activeBalance ? (
        <div
          className="sparkline-tooltip dd-equity-panel__tooltip"
          style={{
            left: `${tooltipLeftPct}%`,
            top: tooltipTop,
            transform: tooltipTransform,
          }}
        >
          <span>{tooltipTimeLabel}</span>
          <div className="dd-equity-panel__tooltip-row">
            <span>Balance</span>
            <strong className="dd-equity-panel__tooltip-balance">
              {formatCurrency(activeBalance.balance)}
            </strong>
          </div>
          <div className="dd-equity-panel__tooltip-row">
            <span>Load</span>
            <strong className="dd-equity-panel__tooltip-deposit-load">
              {activeDepositLoad ? `${activeDepositLoad.y.toFixed(1)}%` : "-"}
            </strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const DrawdownPanel = memo(DrawdownPanelImpl);
