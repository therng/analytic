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

// Benchmarks: [Algo%, Win%, Loss%(raw), Activity%, MaxLoad(inv), MaxDD(inv)]
const RADAR_BENCHMARK = [60, 55, 45, 50, 70, 75];
const RADAR_SERIES_COLORS = ["#4da8f5", "rgba(255,255,255,0.38)"];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function norm(value: number | null | undefined, max: number): number {
  if (!isFiniteNumber(value)) return 0;
  return Math.round((Math.min(Math.max(value, 0), max) / max) * 100);
}

function PerformanceRadarImpl({ balanceDetail, overview, positionsDetail, height = 212 }: PerformanceRadarProps) {
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const algoTradingPct = positionsDetail.data?.summary.algoTradingPercent;
  const winPercent = overview.data?.kpis.winPercent;
  const tradeActivityPct = positionsDetail.data?.summary.tradeActivityPercent;
  const maxDepositLoad = balanceDetail.data?.summary.maximalDepositLoad;
  const maxDrawdownPct = balanceDetail.data?.summary.maximalDrawdownPct;

  const series = useMemo(() => {
    const lossRate = isFiniteNumber(winPercent) ? 100 - winPercent : null;

    return [
      {
        name: "ผลจริง",
        data: [
          norm(algoTradingPct, 100),
          norm(winPercent, 100),
          norm(lossRate, 100),
          norm(tradeActivityPct, 100),
          norm(isFiniteNumber(maxDepositLoad) ? 100 - maxDepositLoad : null, 100),
          norm(isFiniteNumber(maxDrawdownPct) ? 100 - maxDrawdownPct : null, 100),
        ],
      },
      { name: "เกณฑ์", data: RADAR_BENCHMARK },
    ];
  }, [algoTradingPct, winPercent, tradeActivityPct, maxDepositLoad, maxDrawdownPct]);

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
          categories: ["ALGO", "Profit", "Loss", "Activity", "M.DEPOSIT", "MAX DD"],
          labels: { show: true },
        },
        yaxis: { show: false, max: 100, min: 0 },
        stroke: {
          width: [2, 1],
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
            size: 80,
            polygons: {
              strokeColors: "rgba(255,255,255,0.08)",
              connectorColors: "rgba(255,255,255,0.08)",
              fill: { colors: ["rgba(255,255,255,0.02)", "transparent"] },
            },
          },
        },
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
    isFiniteNumber(algoTradingPct) ||
    isFiniteNumber(winPercent) ||
    isFiniteNumber(tradeActivityPct) ||
    isFiniteNumber(maxDepositLoad) ||
    isFiniteNumber(maxDrawdownPct);

  if (!hasAnyMetric) return null;

  return (
    <div className="perf-quality-panel perf-quality-panel--radar-only" role="region" aria-label="Performance radar">
      <div className="perf-radar">
        <Chart options={options} series={series} type="radar" height="100%" width="100%" />
      </div>
    </div>
  );
}

export const PerformanceRadar = memo(PerformanceRadarImpl);
