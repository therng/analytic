"use client";

import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { InlineState } from "@/components/trading-monitor/MonitorShared";
import {
  formatCompactSignedNumber,
  formatSignedCurrency,
} from "@/components/trading-monitor/formatters";
import type { BalanceDetailResponse } from "@/lib/trading/types";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Props {
  balanceDetail: ResourceState<BalanceDetailResponse>;
}

type MaeMfePoint = Extract<
  BalanceDetailResponse["mfeMae"],
  { available: true }
>["points"][number];

type ScatterDatum = {
  x: number;
  y: number;
  netPnl: number;
};

// ApexCharts cannot reliably resolve CSS custom properties.
const WIN_COLOR = "#3dd68c";
const LOSS_COLOR = "#f04d4d";

function hasFiniteCoordinates(
  point: MaeMfePoint,
): point is MaeMfePoint & { mae: number; mfe: number } {
  return (
    point.mae != null &&
    point.mfe != null &&
    Number.isFinite(point.mae) &&
    Number.isFinite(point.mfe)
  );
}

function MaeMfePanelImpl({ balanceDetail }: Props) {
  const rawId = useId();
  const chartId = rawId.replace(/:/g, "");
  const mfeMae = balanceDetail.data?.mfeMae;

  const series = useMemo(() => {
    const plottable: ScatterDatum[] =
      mfeMae?.available === true
        ? mfeMae.points.filter(hasFiniteCoordinates).map((point) => ({
            x: point.mae,
            y: point.mfe,
            netPnl: point.netPnl,
          }))
        : [];

    return [
      {
        name: "Win",
        data: plottable.filter((point) => point.netPnl > 0),
      },
      {
        name: "Loss",
        data: plottable.filter((point) => point.netPnl <= 0),
      },
    ];
  }, [mfeMae]);

  const plottableCount = series[0].data.length + series[1].data.length;

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: `mae-mfe-${chartId}`,
        type: "scatter",
        background: "transparent",
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: "var(--font-mono)",
      },
      colors: [WIN_COLOR, LOSS_COLOR],
      dataLabels: { enabled: false },
      markers: {
        size: 6,
        strokeWidth: 0,
        hover: { sizeOffset: 2 },
      },
      xaxis: {
        type: "numeric",
        title: { text: "MAE" },
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          formatter: (value) => formatCompactSignedNumber(Number(value), 1),
          style: {
            colors: "rgba(240,242,245,0.38)",
            fontSize: "8px",
            fontFamily: "var(--font-mono)",
          },
        },
      },
      yaxis: {
        title: { text: "MFE" },
        labels: {
          formatter: (value) => formatCompactSignedNumber(value, 1),
          style: {
            colors: "rgba(240,242,245,0.38)",
            fontSize: "8px",
            fontFamily: "var(--font-mono)",
          },
        },
      },
      grid: {
        borderColor: "rgba(255,255,255,0.05)",
        padding: { top: 4, right: 8, bottom: 4, left: 4 },
      },
      tooltip: {
        enabled: true,
        shared: false,
        intersect: true,
        followCursor: false,
        custom: ({ seriesIndex, dataPointIndex }) => {
          const datum = series[seriesIndex]?.data[dataPointIndex];
          if (!datum) return "";

          return `<div class="mae-mfe-tooltip">
            <div><span>MAE</span><strong>${formatSignedCurrency(datum.x, 2)}</strong></div>
            <div><span>MFE</span><strong>${formatSignedCurrency(datum.y, 2)}</strong></div>
            <div><span>Net P/L</span><strong>${formatSignedCurrency(datum.netPnl, 2)}</strong></div>
          </div>`;
        },
      },
      legend: {
        show: true,
        position: "bottom",
        horizontalAlign: "center",
        fontFamily: "var(--font-mono)",
        fontSize: "9px",
        labels: { colors: "rgba(240,242,245,0.65)" },
      },
    }),
    [chartId, series],
  );

  if (balanceDetail.error) {
    return (
      <InlineState
        tone="error"
        title="MAE/MFE chart unavailable"
        message={balanceDetail.error}
      />
    );
  }

  if (balanceDetail.loading && !balanceDetail.data) {
    return <div className="skeleton-chart account-card__chart-skeleton" />;
  }

  if (!mfeMae) {
    return (
      <InlineState
        tone="empty"
        title="MAE/MFE unavailable"
        message="No balance detail is available."
      />
    );
  }

  if (!mfeMae.available) {
    return (
      <InlineState
        tone="empty"
        title="MAE/MFE unavailable"
        message={mfeMae.reason}
      />
    );
  }

  if (plottableCount === 0) {
    return (
      <InlineState
        tone="empty"
        title="No excursion samples yet"
        message="Closed trades appear here after excursion samples are recorded."
      />
    );
  }

  return (
    <div className="mae-mfe-panel" role="region" aria-label="MAE MFE scatter">
      {mfeMae.truncated ? (
        <span className="mae-mfe-panel__limit">Showing latest 500 trades</span>
      ) : null}
      <Chart
        options={options}
        series={series}
        type="scatter"
        height="100%"
        width="100%"
      />
    </div>
  );
}

export const MaeMfePanel = memo(MaeMfePanelImpl);
