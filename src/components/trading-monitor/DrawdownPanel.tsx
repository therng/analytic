"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { BalanceDetailResponse, Timeframe } from "@/lib/trading/types";
import {
  InlineState,
  buildSparkline,
  computeDailyScale,
  projectDailySeries,
} from "@/components/trading-monitor/MonitorShared";
import {
  formatSparklineXLabel,
  formatTooltipDateLabel,
  formatTooltipTimeLabel,
} from "@/lib/time";
import { formatCurrency } from "@/components/trading-monitor/formatters";

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Props {
  balanceDetail: ResourceState<BalanceDetailResponse>;
  timeframe?: Timeframe;
}

const WIDTH = 320;
const HEIGHT = 142;

function nearestIndexByX(points: Array<{ x: number }>, targetX: number) {
  let best = 0;
  let bestDist = Infinity;
  points.forEach((point, index) => {
    const dist = Math.abs(point.x - targetX);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  return best;
}

function DrawdownPanelImpl({ balanceDetail, timeframe = "1d" }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // A stale index from before a timeframe switch or data refresh would point
  // into the old series' array, not the new one — clear it so the crosshair
  // never shows a value at the wrong position.
  useEffect(() => {
    setActiveIndex(null);
  }, [timeframe, balanceDetail.data]);

  const { drawdownPoints, depositLoadPoints, drawdownPath, depositLoadPath, drawdown, depositLoad } =
    useMemo(() => {
      // Equity drawdown only covers EquitySnapshot's 7-day retention — fall
      // back to the balance-based drawdown curve when it's empty (e.g. any
      // timeframe beyond 1D, or a gap in equity sampling).
      const drawdown = balanceDetail.data?.equityDrawdownCurve?.length
        ? balanceDetail.data.equityDrawdownCurve
        : (balanceDetail.data?.drawdownCurve ?? []);
      const depositLoad = balanceDetail.data?.depositLoadCurve ?? [];

      // Match BalancePanel's projection: a daily hour-of-day window for 1D,
      // plain min/max scaling for every other timeframe.
      const drawdownProjection =
        timeframe === "1d"
          ? projectDailySeries(
              drawdown,
              computeDailyScale([drawdown], undefined),
              WIDTH,
              HEIGHT,
            )
          : buildSparkline(
              drawdown.map((point) => Number(point.y ?? 0)),
              WIDTH,
              HEIGHT,
            );
      const depositLoadProjection =
        timeframe === "1d"
          ? projectDailySeries(
              depositLoad,
              computeDailyScale([depositLoad], undefined),
              WIDTH,
              HEIGHT,
            )
          : buildSparkline(
              depositLoad.map((point) => Number(point.y ?? 0)),
              WIDTH,
              HEIGHT,
            );

      return {
        drawdownPoints: drawdownProjection.points,
        depositLoadPoints: depositLoadProjection.points,
        drawdownPath: drawdownProjection.linePath,
        depositLoadPath: depositLoadProjection.linePath,
        drawdown,
        depositLoad,
      };
    }, [balanceDetail.data, timeframe]);

  const startLabel = drawdown[0]
    ? formatSparklineXLabel(drawdown[0].x, timeframe)
    : null;
  const endLabel = drawdown[drawdown.length - 1]
    ? formatSparklineXLabel(drawdown[drawdown.length - 1]!.x, timeframe)
    : null;
  const midIndex = Math.floor(drawdown.length / 2);
  const midLabel = drawdown[midIndex]
    ? formatSparklineXLabel(drawdown[midIndex]!.x, timeframe)
    : null;
  const showEndLabel = endLabel !== null && endLabel !== startLabel;
  const showMidLabel =
    midLabel !== null && midLabel !== startLabel && midLabel !== endLabel;
  const startPoint = drawdownPoints[0];
  const midPoint = drawdownPoints[midIndex];
  const endPoint = drawdownPoints[drawdownPoints.length - 1];

  // Hover/tap crosshair — the last point by default so the panel always
  // reads a value, same convention as SparklineChart's activeIndex fallback.
  const lastIndex = drawdownPoints.length - 1;
  const activePointIndex = activeIndex ?? lastIndex;
  const activePoint = drawdownPoints[activePointIndex];
  const activeDrawdown = drawdown[activePointIndex];
  const activeDepositLoad = activePoint
    ? depositLoad[nearestIndexByX(depositLoadPoints, activePoint.x)]
    : undefined;
  const tooltipTimeLabel = activeDrawdown
    ? timeframe === "1d"
      ? formatTooltipTimeLabel(activeDrawdown.x)
      : formatTooltipDateLabel(activeDrawdown.x)
    : null;
  const tooltipLeftPct = activePoint ? (activePoint.x / WIDTH) * 100 : 50;
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
  if (!drawdownPoints.length) {
    return <InlineState tone="empty" title="No drawdown history yet" message="" />;
  }

  return (
    <div className="dd-equity-panel" role="region" aria-label="Drawdown and deposit load chart">
      <div className="dd-equity-panel__legend" aria-hidden="true">
        <span className="dd-equity-panel__legend-item dd-equity-panel__legend-item--drawdown">
          Drawdown
        </span>
        <span className="dd-equity-panel__legend-item dd-equity-panel__legend-item--deposit-load">
          Deposit Load
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        onMouseLeave={() => setActiveIndex(null)}
      >
        {drawdownPath ? <path d={drawdownPath} className="dd-equity-panel__drawdown" /> : null}
        {depositLoadPath ? (
          <path d={depositLoadPath} className="dd-equity-panel__deposit-load" />
        ) : null}
        {activePoint ? (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1="0"
            y2={HEIGHT}
            className="dd-equity-panel__crosshair"
          />
        ) : null}
        {drawdownPoints.length ? (
          <circle
            {...drawdownPoints[drawdownPoints.length - 1]}
            r="2.8"
            className="dd-equity-panel__drawdown-dot"
          />
        ) : null}
        {depositLoadPoints.length ? (
          <circle
            {...depositLoadPoints[depositLoadPoints.length - 1]}
            r="2.4"
            className="dd-equity-panel__deposit-load-dot"
          />
        ) : null}
        {activePoint ? (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="3.4"
            className="dd-equity-panel__drawdown-dot dd-equity-panel__drawdown-dot--active"
          />
        ) : null}
        {drawdownPoints.map((point, index) => (
          <circle
            key={`${point.x}-${point.y}-${index}-hit`}
            cx={point.x}
            cy={point.y}
            r="11"
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
          style={{ left: `${(startPoint.x / WIDTH) * 100}%`, transform: "translateX(0)" }}
          aria-hidden="true"
        >
          {startLabel}
        </span>
      ) : null}
      {showMidLabel && midPoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={{ left: `${(midPoint.x / WIDTH) * 100}%`, transform: "translateX(-50%)" }}
          aria-hidden="true"
        >
          {midLabel}
        </span>
      ) : null}
      {showEndLabel && endPoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={{ left: `${(endPoint.x / WIDTH) * 100}%`, transform: "translateX(-100%)" }}
          aria-hidden="true"
        >
          {endLabel}
        </span>
      ) : null}
      {activeDrawdown ? (
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
            <span>DD</span>
            <strong className="dd-equity-panel__tooltip-drawdown">
              {formatCurrency(activeDrawdown.y)}
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
