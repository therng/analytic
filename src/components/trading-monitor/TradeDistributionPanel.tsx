"use client";

import { memo, useEffect, useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { InlineState } from "@/components/trading-monitor/MonitorShared";
import {
  formatSignedCurrency,
  formatWholeNumber,
} from "@/components/trading-monitor/formatters";
import { formatBangkokDateTime } from "@/lib/time";
import type { BalanceDetailResponse } from "@/lib/trading/types";
import {
  buildTradeDistributionSeries,
  formatHoldingDuration,
  getModeCopy,
  type TradeDistributionMode,
} from "@/components/trading-monitor/trade-distribution-chart";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Props {
  balanceDetail: ResourceState<BalanceDetailResponse>;
}

// ApexCharts cannot reliably resolve CSS custom properties.
const WIN_COLOR = "#3dd68c";
const LOSS_COLOR = "#f04d4d";
const REGRESSION_COLOR = "rgba(240,242,245,0.55)";
const IDEAL_COLOR = "rgba(93,156,255,0.55)";

const MODE_TABS: Array<{ mode: TradeDistributionMode; label: string }> = [
  { mode: "mfe-profit", label: "MFE" },
  { mode: "mae-profit", label: "MAE" },
  { mode: "profit-time", label: "TIME" },
];

const EMPTY_STATE_COPY: Record<TradeDistributionMode, { title: string; message: string }> = {
  "mfe-profit": {
    title: "MFE unavailable",
    message: "No fully closed positions with MFE values exist in this timeframe.",
  },
  "mae-profit": {
    title: "MAE unavailable",
    message: "No fully closed positions with MAE values exist in this timeframe.",
  },
  "profit-time": {
    title: "Holding time unavailable",
    message: "No fully closed positions have valid opening and closing timestamps.",
  },
};

function formatModeXValue(mode: TradeDistributionMode, x: number): string {
  if (mode === "profit-time") return formatHoldingDuration(x);
  return formatSignedCurrency(x, 2);
}

function modeXLabel(mode: TradeDistributionMode): string {
  if (mode === "mfe-profit") return "MFE";
  if (mode === "mae-profit") return "MAE";
  return "Holding time";
}

function TradeDistributionPanelImpl({ balanceDetail }: Props) {
  const rawId = useId();
  const chartId = rawId.replace(/:/g, "");
  const [mode, setMode] = useState<TradeDistributionMode>("mfe-profit");

  const detail = balanceDetail.data?.tradeDistributions;
  const copy = useMemo(() => getModeCopy(mode), [mode]);

  // ApexCharts' `responsive` breakpoint array has a known bug where leaving a
  // breakpoint (crossing back above it) causes an internal Utils.clone stack
  // overflow while merging the override back out. Track the breakpoint in
  // React instead so ApexCharts never exercises that merge path.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 480px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const result = useMemo(() => {
    if (!detail) return { hasData: false, data: [], series: [], regression: null };
    return buildTradeDistributionSeries(mode, detail);
  }, [mode, detail]);

  const options = useMemo<ApexOptions>(() => {
    const seriesCount = result.series.length;
    const hasIdeal = result.series.some((entry) => entry.name === "Ideal 45°");
    const colors = [WIN_COLOR, LOSS_COLOR, REGRESSION_COLOR, ...(hasIdeal ? [IDEAL_COLOR] : [])];
    const strokeWidth = [0, 0, 2, ...(hasIdeal ? [1] : [])];
    const dashArray = [0, 0, 0, ...(hasIdeal ? [6] : [])];
    const baseMarkerSize = [5, 5, 0, ...(hasIdeal ? [0] : [])];
    const markerSize = isMobile
      ? baseMarkerSize.map((size) => (size === 0 ? 0 : 4))
      : baseMarkerSize;

    return {
      chart: {
        id: `trade-distribution-${chartId}`,
        type: "line",
        background: "transparent",
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: false },
        fontFamily: "var(--font-mono)",
      },
      colors: colors.slice(0, seriesCount),
      dataLabels: { enabled: false },
      stroke: {
        width: strokeWidth.slice(0, seriesCount),
        curve: "straight",
        dashArray: dashArray.slice(0, seriesCount),
      },
      markers: {
        size: markerSize.slice(0, seriesCount),
        strokeWidth: 0,
        hover: { sizeOffset: 2 },
      },
      xaxis: {
        type: "numeric",
        title: {
          text: copy.xAxis,
          style: {
            color: "rgba(240,242,245,0.65)",
            fontSize: "9px",
            fontFamily: "var(--font-mono)",
          },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          formatter: (value) => formatModeXValue(mode, Number(value)),
          style: {
            colors: "rgba(240,242,245,0.38)",
            fontSize: "8px",
            fontFamily: "var(--font-mono)",
          },
        },
      },
      yaxis: {
        title: {
          text: copy.yAxis,
          style: {
            color: "rgba(240,242,245,0.65)",
            fontSize: "9px",
            fontFamily: "var(--font-mono)",
          },
        },
        labels: {
          formatter: (value) => formatSignedCurrency(value, 1),
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
      annotations: {
        xaxis:
          mode === "mae-profit"
            ? [{ x: 0, borderColor: "rgba(240,242,245,0.20)" }]
            : [],
        yaxis: [{ y: 0, borderColor: "rgba(240,242,245,0.20)" }],
      },
      tooltip: {
        enabled: true,
        shared: false,
        intersect: true,
        followCursor: false,
        custom: ({ seriesIndex, dataPointIndex, w }) => {
          const seriesEntry = result.series[seriesIndex];
          if (!seriesEntry || seriesEntry.name === "Regression" || seriesEntry.name === "Ideal 45°") {
            return "";
          }

          const isLoss = seriesEntry.name === "Loss";
          const netPnlBucket = isLoss ? result.data.filter((d) => d.y <= 0) : result.data.filter((d) => d.y > 0);
          const datum = netPnlBucket[dataPointIndex];
          if (!datum || !detail?.available) return "";

          const point = detail.points[datum.pointIndex];
          if (!point) return "";

          void w;

          return `<div class="trade-distribution-tooltip">
            <div><span>Symbol</span><strong>${point.symbol}</strong></div>
            <div><span>Ticket</span><strong>${point.positionId}</strong></div>
            <div><span>${modeXLabel(mode)}</span><strong>${formatModeXValue(mode, datum.x)}</strong></div>
            <div><span>Net P/L</span><strong>${formatSignedCurrency(point.netPnl, 2)}</strong></div>
            <div><span>Profit</span><strong>${formatSignedCurrency(point.profit, 2)}</strong></div>
            <div><span>Swap</span><strong>${formatSignedCurrency(point.swap, 2)}</strong></div>
            <div><span>Commission</span><strong>${formatSignedCurrency(point.commission, 2)}</strong></div>
            <div><span>Open time</span><strong>${formatBangkokDateTime(point.openTime)}</strong></div>
            <div><span>Close time</span><strong>${formatBangkokDateTime(point.closeTime)}</strong></div>
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
    };
  }, [chartId, copy, mode, result, detail, isMobile]);

  if (balanceDetail.error) {
    return (
      <InlineState
        tone="error"
        title="Trade distribution chart unavailable"
        message={balanceDetail.error}
      />
    );
  }

  if (balanceDetail.loading && !balanceDetail.data) {
    return <div className="skeleton-chart account-card__chart-skeleton" />;
  }

  if (!detail) {
    return (
      <InlineState
        tone="empty"
        title="Trade distribution unavailable"
        message="No balance detail is available."
      />
    );
  }

  if (!detail.available) {
    return (
      <InlineState
        tone="empty"
        title="Trade distribution unavailable"
        message={detail.reason}
      />
    );
  }

  const modeEmpty = EMPTY_STATE_COPY[mode];

  return (
    <div className="trade-distribution-panel" role="region" aria-label="Trade distribution">
      <div role="tablist" aria-label="Trade distribution chart" className="trade-distribution-panel__tabs">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.mode}
            type="button"
            role="tab"
            aria-selected={mode === tab.mode}
            className="trade-distribution-panel__tab"
            onClick={() => setMode(tab.mode)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="trade-distribution-panel__header">
        <strong>{copy.title}</strong>
        <span>{copy.description}</span>
      </div>

      {!result.hasData ? (
        <InlineState tone="empty" title={modeEmpty.title} message={modeEmpty.message} />
      ) : (
        <div className="trade-distribution-panel__body">
          <div className="trade-distribution-panel__summary">
            {result.regression ? (
              <span>
                Slope {result.regression.slope.toFixed(2)} · R² {result.regression.rSquared.toFixed(2)} · n{" "}
                {formatWholeNumber(result.regression.sampleSize)}
                {mode === "mfe-profit" ? " · Ideal slope: 1.00" : ""}
              </span>
            ) : null}
          </div>

          {detail.truncated ? (
            <span className="trade-distribution-panel__truncation">
              Showing {formatWholeNumber(detail.plottedPositions)} sampled positions from{" "}
              {formatWholeNumber(detail.totalPositions)}; regression uses all valid positions.
            </span>
          ) : null}

          <Chart
            className="trade-distribution-panel__chart"
            options={options}
            series={result.series}
            type="line"
            height="100%"
            width="100%"
          />
        </div>
      )}
    </div>
  );
}

export const TradeDistributionPanel = memo(TradeDistributionPanelImpl);
