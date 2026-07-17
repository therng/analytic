"use client";

import { memo, useMemo } from "react";
import type { BalanceDetailResponse, ChartPoint } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/MonitorShared";

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Props {
  balanceDetail: ResourceState<BalanceDetailResponse>;
}

type ProjectedPoint = { x: number; y: number };

const WIDTH = 320;
const HEIGHT = 142;

function linePath(points: ProjectedPoint[]) {
  return points.length
    ? `M ${points.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")}`
    : "";
}

function projectSeries(points: ChartPoint[], values: number[]) {
  if (!points.length) return [];
  const timestamps = points.map((point) => new Date(point.x).getTime());
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const valueRange = maximum - minimum || 1;
  const timeRange = last - first || 1;

  return points.map((point, index) => ({
    x: 8 + ((timestamps[index]! - first) / timeRange) * (WIDTH - 16),
    y: 8 + (1 - (point.y - minimum) / valueRange) * (HEIGHT - 24),
  }));
}

function DrawdownEquityPanelImpl({ balanceDetail }: Props) {
  const { equityPoints, drawdownPoints, equityPath, drawdownPath } = useMemo(() => {
    const equity = balanceDetail.data?.equityCurve ?? [];
    const drawdown = balanceDetail.data?.equityDrawdownCurve ?? [];
    const equityValues = equity.map((point) => point.y).filter(Number.isFinite);
    const drawdownValues = drawdown.map((point) => point.y).filter(Number.isFinite);
    const equityPoints = projectSeries(equity, equityValues);
    const drawdownPoints = projectSeries(drawdown, drawdownValues);
    return {
      equityPoints,
      drawdownPoints,
      equityPath: linePath(equityPoints),
      drawdownPath: linePath(drawdownPoints),
    };
  }, [balanceDetail.data]);

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
    <div className="dd-equity-panel" role="region" aria-label="Equity and drawdown chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={equityPath} className="dd-equity-panel__equity" />
        {drawdownPath ? <path d={drawdownPath} className="dd-equity-panel__drawdown" /> : null}
        {equityPoints.length ? <circle {...equityPoints[equityPoints.length - 1]} r="2.8" className="dd-equity-panel__equity-dot" /> : null}
        {drawdownPoints.length ? <circle {...drawdownPoints[drawdownPoints.length - 1]} r="2.4" className="dd-equity-panel__drawdown-dot" /> : null}
      </svg>
    </div>
  );
}

export const DrawdownEquityPanel = memo(DrawdownEquityPanelImpl);
