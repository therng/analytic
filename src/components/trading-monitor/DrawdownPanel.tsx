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
  openCount?: number;
  liveBalance?: number;
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

function DrawdownPanelImpl({
  balanceDetail,
  timeframe = "1d",
  openCount,
  liveBalance,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // A stale index from before a timeframe switch or data refresh would point
  // into the old series' array, not the new one — clear it so the crosshair
  // never shows a value at the wrong position.
  useEffect(() => {
    setActiveIndex(null);
  }, [timeframe, balanceDetail.data]);

  const {
    equityPoints,
    drawdownPoints,
    equityPath,
    drawdownPath,
    correctedEquity,
    drawdown,
  } = useMemo(() => {
    const equity = balanceDetail.data?.equityCurve?.length
      ? balanceDetail.data.equityCurve
      : (balanceDetail.data?.balanceCurve ?? []);
    // Equity drawdown only covers EquitySnapshot's 7-day retention — fall
    // back to the balance-based drawdown curve when it's empty (e.g. any
    // timeframe beyond 1D, or a gap in equity sampling).
    const drawdown = balanceDetail.data?.equityDrawdownCurve?.length
      ? balanceDetail.data.equityDrawdownCurve
      : (balanceDetail.data?.drawdownCurve ?? []);
    // No open positions means floating P/L is zero, so equity equals balance —
    // override only the latest point since per-point open-position history
    // isn't available to correct earlier samples.
    const correctedEquity =
      openCount === 0 && Number.isFinite(liveBalance) && equity.length
        ? [
            ...equity.slice(0, -1),
            { ...equity[equity.length - 1]!, y: liveBalance! },
          ]
        : equity;

    // Match BalancePanel's projection: a daily hour-of-day window for 1D,
    // plain min/max scaling for every other timeframe.
    const equityProjection =
      timeframe === "1d"
        ? projectDailySeries(
            correctedEquity,
            computeDailyScale([correctedEquity], undefined),
            WIDTH,
            HEIGHT,
          )
        : buildSparkline(
            correctedEquity.map((point) => Number(point.y ?? 0)),
            WIDTH,
            HEIGHT,
          );
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

    return {
      equityPoints: equityProjection.points,
      drawdownPoints: drawdownProjection.points,
      equityPath: equityProjection.linePath,
      drawdownPath: drawdownProjection.linePath,
      correctedEquity,
      drawdown,
    };
  }, [balanceDetail.data, openCount, liveBalance, timeframe]);

  const startLabel = correctedEquity[0]
    ? formatSparklineXLabel(correctedEquity[0].x, timeframe)
    : null;
  const endLabel = correctedEquity[correctedEquity.length - 1]
    ? formatSparklineXLabel(correctedEquity[correctedEquity.length - 1]!.x, timeframe)
    : null;
  const midIndex = Math.floor(correctedEquity.length / 2);
  const midLabel = correctedEquity[midIndex]
    ? formatSparklineXLabel(correctedEquity[midIndex]!.x, timeframe)
    : null;
  const showEndLabel = endLabel !== null && endLabel !== startLabel;
  const showMidLabel =
    midLabel !== null && midLabel !== startLabel && midLabel !== endLabel;
  const startPoint = equityPoints[0];
  const midPoint = equityPoints[midIndex];
  const endPoint = equityPoints[equityPoints.length - 1];

  // Hover/tap crosshair — the last point by default so the panel always
  // reads a value, same convention as SparklineChart's activeIndex fallback.
  const lastIndex = equityPoints.length - 1;
  const activePointIndex = activeIndex ?? lastIndex;
  const activePoint = equityPoints[activePointIndex];
  const activeEquity = correctedEquity[activePointIndex];
  const activeDrawdown = activePoint
    ? drawdown[nearestIndexByX(drawdownPoints, activePoint.x)]
    : undefined;
  const tooltipTimeLabel = activeEquity
    ? timeframe === "1d"
      ? formatTooltipTimeLabel(activeEquity.x)
      : formatTooltipDateLabel(activeEquity.x)
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
  if (!equityPoints.length) {
    return <InlineState tone="empty" title="No equity history yet" message="" />;
  }

  return (
    <div className="dd-equity-panel" role="region" aria-label="Balance and drawdown chart">
      <div className="dd-equity-panel__legend" aria-hidden="true">
        <span className="dd-equity-panel__legend-item dd-equity-panel__legend-item--equity">
          Equity
        </span>
        <span className="dd-equity-panel__legend-item dd-equity-panel__legend-item--drawdown">
          Drawdown
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        onMouseLeave={() => setActiveIndex(null)}
      >
        <path d={equityPath} className="dd-equity-panel__equity" />
        {drawdownPath ? <path d={drawdownPath} className="dd-equity-panel__drawdown" /> : null}
        {activePoint ? (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1="0"
            y2={HEIGHT}
            className="dd-equity-panel__crosshair"
          />
        ) : null}
        {equityPoints.length ? (
          <circle
            {...equityPoints[equityPoints.length - 1]}
            r="2.8"
            className="dd-equity-panel__equity-dot"
          />
        ) : null}
        {drawdownPoints.length ? (
          <circle
            {...drawdownPoints[drawdownPoints.length - 1]}
            r="2.4"
            className="dd-equity-panel__drawdown-dot"
          />
        ) : null}
        {activePoint ? (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="3.4"
            className="dd-equity-panel__equity-dot dd-equity-panel__equity-dot--active"
          />
        ) : null}
        {equityPoints.map((point, index) => (
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
      {activeEquity ? (
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
            <span>Equity</span>
            <strong className="dd-equity-panel__tooltip-equity">
              {formatCurrency(activeEquity.y)}
            </strong>
          </div>
          <div className="dd-equity-panel__tooltip-row">
            <span>DD</span>
            <strong className="dd-equity-panel__tooltip-drawdown">
              {activeDrawdown ? formatCurrency(activeDrawdown.y) : "-"}
            </strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const DrawdownPanel = memo(DrawdownPanelImpl);
