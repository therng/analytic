"use client";
import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type {
  AccountOverviewResponse,
  BalanceDetailResponse,
} from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/MonitorShared";

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

// Benchmarks: [Algo%, Win%, Loss%(raw), Activity%, MaxLoad(inv), MaxDD(inv)]
// Loss%(raw): lower raw value = better; benchmark 45 means "target <45% loss rate"
const RADAR_BENCHMARK = [60, 55, 45, 50, 70, 75];
// #4da8f5 = --neutral token; ApexCharts cannot resolve CSS custom properties
const RADAR_SERIES_COLORS = ["#4da8f5", "rgba(255,255,255,0.38)"];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function norm(value: number | null | undefined, max: number): number {
  if (!isFiniteNumber(value)) return 0;
  return Math.round((Math.min(Math.max(value, 0), max) / max) * 100);
}

function PerformanceRadarImpl({
  balanceDetail,
  overview,
  height = 212,
}: PerformanceRadarProps) {
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const algoTradingPct = overview.data?.kpis.performance.algoTradingPercent;
  const winPercent = overview.data?.kpis.winPercent;
  const tradeActivityPct = overview.data?.kpis.performance.tradeActivityPercent;
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
          norm(
            isFiniteNumber(maxDepositLoad) ? 100 - maxDepositLoad : null,
            100,
          ),
          norm(
            isFiniteNumber(maxDrawdownPct) ? 100 - maxDrawdownPct : null,
            100,
          ),
        ],
      },
      { name: "เกณฑ์", data: RADAR_BENCHMARK },
    ];
  }, [
    algoTradingPct,
    winPercent,
    tradeActivityPct,
    maxDepositLoad,
    maxDrawdownPct,
  ]);

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
          categories: [
            "ALGO",
            "WIN%",
            "LOSS%",
            "ACTIVITY",
            "MAX LOAD",
            "MAX DD",
          ],
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
            // Explicit size avoids ApexCharts v5 bug where globals.padding is
            // undefined at Radar init time, causing NaN coordinates for all vertices.
            size: 70,
            polygons: {
              strokeColors: "rgba(255,255,255,0.08)",
              connectorColors: "rgba(255,255,255,0.08)",
              fill: { colors: ["rgba(255,255,255,0.02)", "transparent"] },
            },
          },
        },
        grid: {
          padding: { top: 10, right: 10, bottom: 6, left: 10 },
        },
        tooltip: { enabled: true },
        legend: { show: false },
      }) satisfies ApexOptions,
    [chartId],
  );

  if (balanceDetail.error) {
    return (
      <InlineState
        tone="error"
        title="Radar metrics unavailable"
        message={balanceDetail.error}
      />
    );
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
    <div
      className="perf-quality-panel perf-quality-panel--radar-only"
      role="region"
      aria-label="Performance radar"
    >
      <div className="perf-radar">
        <Chart
          options={options}
          series={series}
          type="radar"
          height={height}
          width="100%"
        />
        <div className="perf-radar__legend">
          <span className="perf-radar__legend-item perf-radar__legend-item--actual">
            ผลจริง
          </span>
          <span className="perf-radar__legend-item perf-radar__legend-item--bench">
            เกณฑ์
          </span>
        </div>
      </div>
    </div>
  );
}

export const PerformanceRadar = memo(PerformanceRadarImpl);
