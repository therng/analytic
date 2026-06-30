"use client";

import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { PositionsResponse } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/MonitorShared";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const MAX_SLICES = 7;
const DONUT_COLORS = [
  "#4da8f5", "#3dd68c", "#f5a623", "#e05a5a", "#a78bfa",
  "#34d4d4", "#f472b6", "#94a3b8",
];

function PiePanelImpl({ positionsDetail }: { positionsDetail: ResourceState<PositionsResponse> }) {
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);

  const { labels, series } = useMemo(() => {
    const positions = positionsDetail.data?.historyPositions ?? [];
    if (!positions.length) return { labels: [] as string[], series: [] as number[] };

    const counts: Record<string, number> = {};
    for (const pos of positions) {
      const sym = (pos.symbol ?? "Unknown").toUpperCase();
      counts[sym] = (counts[sym] ?? 0) + 1;
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, MAX_SLICES);
    const rest = sorted.slice(MAX_SLICES);
    if (rest.length > 0) {
      top.push(["Other", rest.reduce((s, [, v]) => s + v, 0)]);
    }

    return {
      labels: top.map(([sym]) => sym),
      series: top.map(([, count]) => count),
    };
  }, [positionsDetail.data]);

  const options = useMemo(
    () =>
      ({
        chart: {
          id: `symbol-pie-${chartId}`,
          type: "donut",
          background: "transparent",
          toolbar: { show: false },
          animations: { enabled: true },
          fontFamily: "var(--font-mono)",
        },
        colors: DONUT_COLORS,
        labels,
        dataLabels: {
          enabled: true,
          formatter: (val: number) => `${Math.round(val)}%`,
          style: { fontSize: "11px", fontWeight: "600" },
          dropShadow: { enabled: false },
        },
        plotOptions: {
          pie: {
            donut: {
              size: "62%",
              labels: {
                show: true,
                total: {
                  show: true,
                  label: "Trades",
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.5)",
                  formatter: (w: { globals: { seriesTotals: number[] } }) =>
                    String(w.globals.seriesTotals.reduce((a, b) => a + b, 0)),
                },
              },
            },
          },
        },
        stroke: { width: 1.5, colors: ["#0a1628"] },
        legend: {
          show: true,
          position: "bottom",
          fontSize: "11px",
          labels: { colors: "rgba(255,255,255,0.6)" },
          markers: { size: 8 },
          itemMargin: { horizontal: 6, vertical: 2 },
        },
        tooltip: {
          y: { formatter: (val: number) => `${val} trades` },
        },
      }) satisfies ApexOptions,
    [chartId, labels],
  );

  if (positionsDetail.error) {
    return <InlineState tone="error" title="Symbol data unavailable" message={positionsDetail.error} />;
  }
  if (positionsDetail.loading && !positionsDetail.data) {
    return <div className="skeleton-chart account-card__chart-skeleton" aria-hidden="true" />;
  }
  if (!series.length) return null;

  return (
    <div className="perf-quality-panel perf-quality-panel--radar-only" role="region" aria-label="Symbol trade ratio">
      <Chart options={options} series={series} type="donut" height={240} width="100%" />
    </div>
  );
}

export const PiePanel = memo(PiePanelImpl);
