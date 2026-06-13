"use client";

import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { AccountOverviewResponse, BalanceDetailResponse } from "@/lib/trading/types";
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
  height?: number | "auto";
}

const RADAR_BENCHMARK = [40, 38, 43, 50];
const RADAR_SERIES_COLORS = ["#4da8f5", "rgba(255,255,255,0.38)"];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function PerformanceRadarImpl({ balanceDetail, overview, height = 212 }: PerformanceRadarProps) {
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const sharpeRatio = balanceDetail.data?.summary.sharpeRatio;
  const profitFactor = balanceDetail.data?.summary.profitFactor;
  const recoveryFactor = balanceDetail.data?.summary.recoveryFactor;
  const winPercent = overview.data?.kpis.winPercent;

  const series = useMemo(() => {
    const norm = (value: number | null | undefined, max: number): number => {
      if (!isFiniteNumber(value)) return 0;
      return Math.round((Math.min(Math.max(value, 0), max) / max) * 100);
    };
    const pfSafe = profitFactor === Number.POSITIVE_INFINITY ? 4 : profitFactor;
    return [
      {
        name: "ผลจริง",
        data: [
          norm(sharpeRatio, 5),
          norm(pfSafe, 4),
          norm(recoveryFactor, 7),
          norm(winPercent, 100),
        ],
      },
      { name: "เกณฑ์", data: RADAR_BENCHMARK },
    ];
  }, [sharpeRatio, profitFactor, recoveryFactor, winPercent]);

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
        colors: RADAR_SERIES_COLORS,
        xaxis: {
          categories: ["SHARPE", "PROFIT F.", "RECOVERY", "WIN %"],
          labels: { show: true },
        },
        yaxis: { show: false, max: 100, min: 0 },
        stroke: {
          width: [1.5, 1],
          colors: RADAR_SERIES_COLORS,
          dashArray: [0, 4],
          lineCap: "round",
        },
        fill: {
          colors: ["#4da8f5", "rgba(255,255,255,0.12)"],
          opacity: [0.18, 0.08],
        },
        markers: {
          size: [3.5, 0],
          colors: ["#4da8f5", "transparent"],
          strokeColors: ["#08131f", "transparent"],
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
        tooltip: { enabled: true },
        legend: { show: false },
      }) satisfies ApexOptions,
    [chartId],
  );

  if (balanceDetail.error) {
    return <InlineState tone="error" title="Radar metrics unavailable" message={balanceDetail.error} />;
  }
  if (balanceDetail.loading && !balanceDetail.data) {
    return <div className="skeleton-chart account-card__chart-skeleton" />;
  }

  const hasAnyMetric =
    isFiniteNumber(sharpeRatio) ||
    profitFactor === Number.POSITIVE_INFINITY ||
    isFiniteNumber(profitFactor) ||
    isFiniteNumber(recoveryFactor) ||
    isFiniteNumber(winPercent);

  if (!hasAnyMetric) return null;

  return (
    <div className="perf-quality-panel perf-quality-panel--radar-only" role="region" aria-label="Performance radar">
      <div className="perf-radar">
        <Chart options={options} series={series} type="radar" height={height} width="100%" />
        <div className="perf-radar__legend">
          <span className="perf-radar__legend-item perf-radar__legend-item--actual">ผลจริง</span>
          <span className="perf-radar__legend-item perf-radar__legend-item--bench">เกณฑ์</span>
        </div>
      </div>
    </div>
  );
}

export const PerformanceRadar = memo(PerformanceRadarImpl);
