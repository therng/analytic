"use client";

import { memo, useMemo } from "react";
import type { BalanceDetailResponse, Timeframe } from "@/lib/trading/types";
import {
  InlineState,
  buildSparkline,
  computeDailyScale,
  projectDailySeries,
} from "@/components/trading-monitor/MonitorShared";
import { formatSparklineXLabel } from "@/lib/time";

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

function DrawdownPanelImpl({
  balanceDetail,
  timeframe = "1d",
  openCount,
  liveBalance,
}: Props) {
  const { equityPoints, drawdownPoints, equityPath, drawdownPath, correctedEquity } =
    useMemo(() => {
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
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={equityPath} className="dd-equity-panel__equity" />
        {drawdownPath ? <path d={drawdownPath} className="dd-equity-panel__drawdown" /> : null}
        {equityPoints.length ? <circle {...equityPoints[equityPoints.length - 1]} r="2.8" className="dd-equity-panel__equity-dot" /> : null}
        {drawdownPoints.length ? <circle {...drawdownPoints[drawdownPoints.length - 1]} r="2.4" className="dd-equity-panel__drawdown-dot" /> : null}
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
    </div>
  );
}

export const DrawdownPanel = memo(DrawdownPanelImpl);
