"use client";
import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { BalanceDetailResponse } from "@/lib/trading/types";
import { normalizeExcludeTransfers, buildDrawdownPercentSeries } from "@/lib/trading/analytics";
import { InlineState } from "@/components/trading-monitor/MonitorShared";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Props {
  balanceDetail: ResourceState<BalanceDetailResponse>;
  excludeTransfers?: boolean;
}

// #4da8f5 = --neutral token; ApexCharts cannot resolve CSS custom properties
const BALANCE_COLOR = "#4da8f5";
const DD_COLOR = "#f04d4d";

function formatBalance(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function DrawdownEquityPanelImpl({ balanceDetail, excludeTransfers = false }: Props) {
  const rawId = useId();
  const chartId = rawId.replace(/:/g, "");

  const { balanceSeries, ddSeries } = useMemo(() => {
    const bc = balanceDetail.data?.balanceCurve ?? [];
    if (excludeTransfers) {
      const skipSeedDeposit = balanceDetail.data?.timeframe === "all";
      const normalized = normalizeExcludeTransfers(bc, skipSeedDeposit);
      return {
        balanceSeries: normalized.map((p) => ({ x: p.x, y: p.balance })),
        ddSeries: buildDrawdownPercentSeries(normalized),
      };
    }
    const dc = balanceDetail.data?.drawdownCurve ?? [];
    return {
      balanceSeries: bc.map((p) => ({ x: new Date(p.x).getTime(), y: p.balance })),
      // negate drawdown so it plots below the zero baseline on the right axis
      ddSeries: dc.map((p) => ({ x: new Date(p.x).getTime(), y: -p.y })),
    };
  }, [balanceDetail.data, excludeTransfers]);

  const series = useMemo(
    () => [
      { name: "Equity", type: "line" as const, data: balanceSeries },
      { name: "DD%", type: "area" as const, data: ddSeries },
    ],
    [balanceSeries, ddSeries],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: `dd-equity-${chartId}`,
        type: "line",
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: true, animateGradually: { enabled: false } },
        fontFamily: "var(--font-mono)",
        zoom: { enabled: false },
        sparkline: { enabled: false },
      },
      colors: [BALANCE_COLOR, DD_COLOR],
      stroke: {
        curve: "smooth",
        width: [1.5, 1],
        colors: [BALANCE_COLOR, DD_COLOR],
        dashArray: [0, 0],
      },
      fill: {
        type: ["solid", "gradient"],
        opacity: [0, 1],
        gradient: {
          type: "vertical",
          shade: "dark",
          gradientToColors: [DD_COLOR],
          opacityFrom: 0.55,
          opacityTo: 0.04,
          stops: [0, 100],
        },
      },
      xaxis: {
        type: "datetime",
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          show: true,
          style: { colors: "rgba(255,255,255,0.30)", fontSize: "8px", fontFamily: "var(--font-mono)" },
          datetimeFormatter: { year: "yyyy", month: "MMM 'yy", day: "d MMM", hour: "HH:mm" },
          datetimeUTC: false,
        },
      },
      yaxis: [
        {
          seriesName: "Equity",
          show: true,
          labels: {
            formatter: formatBalance,
            style: { colors: "rgba(77,168,245,0.55)", fontSize: "8px", fontFamily: "var(--font-mono)" },
            offsetX: -4,
          },
          axisBorder: { show: false },
          axisTicks: { show: false },
        },
        {
          seriesName: "DD%",
          opposite: true,
          max: 0,
          labels: {
            formatter: (v) => `${Math.abs(v).toFixed(0)}%`,
            style: { colors: "rgba(240,77,77,0.65)", fontSize: "8px", fontFamily: "var(--font-mono)" },
            offsetX: 4,
          },
          axisBorder: { show: false },
          axisTicks: { show: false },
        },
      ],
      grid: {
        borderColor: "rgba(255,255,255,0.05)",
        padding: { top: 4, right: 8, bottom: 0, left: 0 },
        yaxis: { lines: { show: false } },
        xaxis: { lines: { show: false } },
      },
      markers: { size: 0 },
      dataLabels: { enabled: false },
      tooltip: {
        enabled: true,
        shared: true,
        x: { format: "d MMM yyyy" },
        theme: "dark",
        y: [
          { formatter: (v) => formatBalance(v) },
          { formatter: (v) => `${Math.abs(v).toFixed(2)}%` },
        ],
      },
      legend: { show: false },
    }),
    [chartId],
  );

  if (balanceDetail.error) {
    return <InlineState tone="error" title="Drawdown chart unavailable" message={balanceDetail.error} />;
  }
  if (balanceDetail.loading && !balanceDetail.data) {
    return <div className="skeleton-chart account-card__chart-skeleton" />;
  }

  if (!balanceSeries.length) return null;

  return (
    <div className="dd-equity-panel" role="region" aria-label="Drawdown on equity">
      {excludeTransfers && (
        <div className="dd-equity-panel__badge" aria-label="Transfers excluded from calculation">
          excl. transfers
        </div>
      )}
      <Chart options={options} series={series} type="line" height="100%" width="100%" />
    </div>
  );
}

export const DrawdownEquityPanel = memo(DrawdownEquityPanelImpl);
