"use client";
import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type {
  AccountOverviewResponse,
  BalanceDetailResponse,
} from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/MonitorShared";
import { formatPlainPercent } from "@/components/trading-monitor/dashboardFormatters";

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

// Radar axes map every metric onto a 0-100 score where a larger vertex reads
// as better — except LOSS%, which plots the raw loss rate (lower is better;
// its benchmark 45 is a raw ceiling, not a floor to beat). MAX LOAD / MAX DD
// invert their percent inputs (score = 100 - value).
//
// Caveats the polygon cannot encode visually (the tooltip carries the real
// values instead):
// - MAX LOAD is the interim broker margin/equity peak and may legitimately
//   exceed 100 (pre-stop-out); such values saturate the axis at its center.
//   Scoped timeframes are also bounded by EquitySnapshot's 7-day row
//   retention, while "all" reads the persisted high-water mark
//   (see preaggregated/algo-summary.ts).
// - MAX DD follows MT5 Balance Drawdown Maximal, so withdrawals count toward
//   it; and a 0% drawdown in a window with no closed positions is "no data",
//   not a perfect score.
// - Missing inputs score 0 (center) on every axis and read "-" in the tooltip.
//
// Benchmarks (commit e96dbdc; each value lives on its own axis's scale):
// ALGO >= 60% | WIN >= 55% | LOSS <= 45% (raw) | ACTIVITY >= 50% |
// MAX LOAD inv-score >= 70 (load <= 30%) | MAX DD inv-score >= 75 (dd <= 25%)
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

interface RadarAxis {
  label: string;
  /** Plotted 0-100 score; 0 (center) also means "no data". */
  score: number;
  /** Real metric value for the tooltip; "-" when missing. */
  display: string;
  lowerIsBetter: boolean;
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
  const closedTrades = overview.data?.kpis.trades;
  const maxDepositLoad = balanceDetail.data?.summary.maximalDepositLoad;
  const maxDrawdownPct = balanceDetail.data?.summary.maximalDrawdownPct;

  // A 0% drawdown is "no data", not a perfect score, unless the window has
  // closed trades behind it: `kpis.trades` is null when nothing traded at all
  // and 0 when positions opened but none has closed yet (empty balance curve).
  const maxDrawdownKnown =
    isFiniteNumber(maxDrawdownPct) &&
    (maxDrawdownPct !== 0 || (isFiniteNumber(closedTrades) && closedTrades > 0));

  const radarAxes = useMemo<RadarAxis[]>(() => {
    const lossRate = isFiniteNumber(winPercent) ? 100 - winPercent : null;
    const drawdownKnown = maxDrawdownKnown ? maxDrawdownPct : null;

    return [
      {
        label: "ALGO",
        score: norm(algoTradingPct, 100),
        display: formatPlainPercent(algoTradingPct),
        lowerIsBetter: false,
      },
      {
        label: "WIN%",
        score: norm(winPercent, 100),
        display: formatPlainPercent(winPercent),
        lowerIsBetter: false,
      },
      {
        label: "LOSS%",
        score: norm(lossRate, 100),
        display: formatPlainPercent(lossRate),
        lowerIsBetter: true,
      },
      {
        label: "ACTIVITY",
        score: norm(tradeActivityPct, 100),
        display: formatPlainPercent(tradeActivityPct),
        lowerIsBetter: false,
      },
      {
        label: "MAX LOAD",
        score: norm(
          isFiniteNumber(maxDepositLoad) ? 100 - maxDepositLoad : null,
          100,
        ),
        display: formatPlainPercent(maxDepositLoad),
        lowerIsBetter: true,
      },
      {
        label: "MAX DD",
        score: norm(
          isFiniteNumber(drawdownKnown) ? 100 - drawdownKnown : null,
          100,
        ),
        display: formatPlainPercent(drawdownKnown),
        lowerIsBetter: true,
      },
    ];
  }, [
    algoTradingPct,
    winPercent,
    tradeActivityPct,
    maxDepositLoad,
    maxDrawdownPct,
    maxDrawdownKnown,
  ]);

  const series = useMemo(
    () => [
      { name: "ผลจริง", data: radarAxes.map((axis) => axis.score) },
      { name: "เกณฑ์", data: RADAR_BENCHMARK },
    ],
    [radarAxes],
  );

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
          categories: radarAxes.map((axis) => axis.label),
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
            // Explicit size is REQUIRED on apexcharts 5.16: radar sizing reads
            // w.layout.gridWidth/gridHeight before the layout pass has run in
            // this card, yielding a ~0 radius (collapsed polygon). The raw
            // value is an absolute pixel radius, so the polygon is pinned at
            // 2x this width instead of scaling with the container — verified
            // visually; removing it collapses the chart entirely.
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
        tooltip: {
          enabled: true,
          shared: false,
          intersect: true,
          followCursor: false,
          theme: "dark",
          custom: ({ dataPointIndex }) => {
            const axis = radarAxes[dataPointIndex];
            if (!axis) return "";

            const hint =
              axis.display === "-"
                ? "ไม่มีข้อมูล"
                : `คะแนน ${axis.score} · ${axis.lowerIsBetter ? "ยิ่งต่ำยิ่งดี" : "ยิ่งสูงยิ่งดี"}`;

            return `
              <div class="perf-radar-tooltip">
                <span class="perf-radar-tooltip__axis">${axis.label}</span>
                <span class="perf-radar-tooltip__value">${axis.display}</span>
                <span class="perf-radar-tooltip__hint">${hint}</span>
              </div>
            `;
          },
        },
        legend: { show: false },
      }) satisfies ApexOptions,
    [chartId, radarAxes],
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

  // maxDrawdownKnown, not the raw pct: a window whose only finite metric is a
  // suppressed 0% drawdown counts as "no data" and returns null above instead
  // of rendering an all-center polygon.
  const hasAnyMetric =
    isFiniteNumber(algoTradingPct) ||
    isFiniteNumber(winPercent) ||
    isFiniteNumber(tradeActivityPct) ||
    isFiniteNumber(maxDepositLoad) ||
    maxDrawdownKnown;

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
