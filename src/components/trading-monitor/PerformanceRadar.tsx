"use client";

import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { AccountOverviewResponse, BalanceDetailResponse, PositionsResponse } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/shared";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface PerformanceRadarProps {
  balanceDetail: ResourceState<BalanceDetailResponse>;
  overview: ResourceState<AccountOverviewResponse>;
  positionsDetail: ResourceState<PositionsResponse>;
  height?: number | "auto";
}

const RADAR_SERIES_COLOR = "#4da8f5";
const RADAR_CATEGORIES = [
  "Algo Trading",
  "Profit Trades",
  "Loss Trades",
  "Trading Activity",
  "Max Deposit Load",
  "Maximum Drawdown",

];

function clamp100(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 100));
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function PerformanceRadarImpl({ balanceDetail, overview, positionsDetail, height = 212 }: PerformanceRadarProps) {
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const winPercent = overview.data?.kpis.winPercent;
  const tradeActivityPercent = positionsDetail.data?.summary.tradeActivityPercent;
  const maxDepositLoad = balanceDetail.data?.summary.maximalDepositLoad;
  const relativeDrawdownPct = balanceDetail.data?.summary.relativeDrawdownPct;
  const eaPercent = positionsDetail.data?.summary.eaPercent;

  const series = useMemo(() => {
    return [
      {
        name: "ผลจริง",
        data: [
          isFiniteNumber(winPercent) ? clamp100(winPercent) : 0,
          isFiniteNumber(winPercent) ? clamp100(100 - winPercent) : 0,
          isFiniteNumber(tradeActivityPercent) ? clamp100(tradeActivityPercent) : 0,
          isFiniteNumber(maxDepositLoad) ? clamp100(100 - maxDepositLoad) : 0,
          isFiniteNumber(relativeDrawdownPct) ? clamp100(100 - relativeDrawdownPct) : 0,
          isFiniteNumber(eaPercent) ? clamp100(eaPercent) : 0,
        ],
      },
    ];
  }, [winPercent, tradeActivityPercent, maxDepositLoad, relativeDrawdownPct, eaPercent]);

  const options = useMemo(
    () =>
      ({
        chart: {
          id: `performance-radar-${chartId}`,
          type: "radar",
          background: "transparent",
          toolbar: { show: false },
          animations: { enabled: true },
          sparkline: { enabled: false },
          fontFamily: "var(--font-mono)",
        },
        colors: [RADAR_SERIES_COLOR],
        xaxis: {
          categories: RADAR_CATEGORIES,
          labels: { show: true },
        },
        yaxis: { show: false, max: 100, min: 0 },
        stroke: {
          width: [1.5],
          colors: [RADAR_SERIES_COLOR],
          dashArray: [0],
          lineCap: "round",
        },
        fill: {
          colors: [RADAR_SERIES_COLOR],
          opacity: [0.18],
        },
        markers: {
          size: [3.5],
          colors: [RADAR_SERIES_COLOR],
          strokeColors: ["#08131f"],
          strokeWidth: 1.5,
          hover: { size: 5 },
        },
        plotOptions: {
          radar: {
            size: 70,
            polygons: {
              strokeColors: "rgba(255,255,255,0.08)",
              connectorColors: "rgba(255,255,255,0.08)",
              fill: { colors: ["rgba(255,255,255,0.02)", "transparent"] },
            },
          },
        },
        grid: { padding: { top: 10, right: 10, bottom: 6, left: 10 } },
        tooltip: {
          enabled: true,
          y: {
            formatter: (val: number, opts?: { dataPointIndex?: number }) => {
              const idx = opts?.dataPointIndex;
              // Axes 3 and 4 display inverted values; show the actual metric value in tooltip
              if (idx === 3 || idx === 4) return `${100 - val}%`;
              return `${val}%`;
            },
          },
        },
        legend: { show: false },
      }) satisfies ApexOptions,
    [chartId],
  );

  if (balanceDetail.error || positionsDetail.error) {
    return <InlineState tone="error" title="Radar metrics unavailable" message={balanceDetail.error ?? positionsDetail.error!} />;
  }
  if ((balanceDetail.loading && !balanceDetail.data) || (positionsDetail.loading && !positionsDetail.data)) {
    return <div className="skeleton-chart account-card__chart-skeleton" />;
  }

  const hasAnyMetric =
    isFiniteNumber(winPercent) ||
    isFiniteNumber(tradeActivityPercent) ||
    isFiniteNumber(maxDepositLoad) ||
    isFiniteNumber(relativeDrawdownPct) ||
    isFiniteNumber(eaPercent);

  if (!hasAnyMetric) return null;

  return (
    <div className="perf-quality-panel perf-quality-panel--radar-only" role="region" aria-label="Performance radar">
      <div className="perf-radar">
        <Chart options={options} series={series} type="radar" height={height} width="100%" />
      </div>
    </div>
  );
}

export const PerformanceRadar = memo(PerformanceRadarImpl);
