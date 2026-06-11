"use client";
import { memo, useMemo, useId, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from 'apexcharts';
import type { PositionsResponse } from "@/lib/trading/types";
import { formatCompactSignedNumber } from "@/components/trading-monitor/formatters";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const MANUAL_LABEL = "Manual";
const HASH_ID_REGEX = /^#\d+\|\s*(.+)$/;
const LEADING_ALNUM_REGEX = /^[A-Za-z0-9]{1,3}/;

const POSITIVE_BORDER = "rgba(61, 214, 140, 1)";
const NEGATIVE_BORDER = "rgba(240, 77, 77, 1)";

const MAX_VISIBLE_BOT_BARS = 16;
const MIN_BOT_CATEGORY_WIDTH = 35;
const DENSITY_THRESHOLD = 720;

type Position = NonNullable<PositionsResponse["historyPositions"]>[number];

interface DensityConfig {
  columnWidth: string;
  borderRadius: number;
  labelFontSize: string;
}

function getDensityConfig(count: number): DensityConfig {
  return {
    columnWidth: "55%",
    borderRadius: 4,
    labelFontSize: count > DENSITY_THRESHOLD ? "8px" : "9px",
  };
}

function getBotPnlChartStyle(count: number): CSSProperties {
  return {
    width: count <= MAX_VISIBLE_BOT_BARS ? "100%" : `${(count / MAX_VISIBLE_BOT_BARS) * 100}%`,
    minWidth: `${count * MIN_BOT_CATEGORY_WIDTH}px`,
    height: "100%",
  };
}

function normalizeBotName(comment: string | null | undefined): string {
  if (!comment) return MANUAL_LABEL;

  let trimmed = comment.trim();
  if (!trimmed) return MANUAL_LABEL;

  const hashMatch = HASH_ID_REGEX.exec(trimmed);
  if (hashMatch) trimmed = hashMatch[1].trim();
  if (!trimmed) return MANUAL_LABEL;

  const match = LEADING_ALNUM_REGEX.exec(trimmed);
  return match ? match[0] : MANUAL_LABEL;
}

interface BotStat {
  name: string;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  wins: number;
  losses: number;
}

function emptyStat(name: string): BotStat {
  return { name, grossProfit: 0, grossLoss: 0, netPnl: 0, wins: 0, losses: 0 };
}

function aggregate(positions: Position[] | null | undefined): BotStat[] {
  if (!positions?.length) return [];

  const map = new Map<string, BotStat>();
  for (const pos of positions) {
    const name = normalizeBotName(pos.comment);
    const net = pos.profit + (pos.swap ?? 0) + (pos.commission ?? 0);

    let stat = map.get(name);
    if (!stat) {
      stat = emptyStat(name);
      map.set(name, stat);
    }

    if (net >= 0) {
      stat.grossProfit += net;
      stat.wins += 1;
    } else {
      stat.grossLoss += net;
      stat.losses += 1;
    }
    stat.netPnl += net;
  }

  return Array.from(map.values()).sort((a, b) => b.netPnl - a.netPnl);
}

function formatTick(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const v = value / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const v = value / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return value.toString();
}

interface Props {
  positions: PositionsResponse["historyPositions"] | null | undefined;
}

function BotPnLPanelImpl({ positions }: Props) {
  const bots = useMemo(() => aggregate(positions), [positions]);
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);
  const density = useMemo(() => getDensityConfig(bots.length), [bots.length]);
  const chartStyle = useMemo(() => getBotPnlChartStyle(bots.length), [bots.length]);

  const series = useMemo(
    () => [
      { name: "+", data: bots.map((b) => b.grossProfit) },
      { name: "-", data: bots.map((b) => Math.abs(b.grossLoss)) },
    ],
    [bots],
  );

  const options = useMemo<ApexOptions>(
    () => ({
      chart: {
        id: `bot-pnl-${chartId}`,
        type: "bar",
        zoom: { enabled: true },
        toolbar: { show: false },
        offsetY: -4,
        animations: {
          enabled: false,
          animateGradually: { enabled: false },
          dynamicAnimation: { enabled: false },
        },
        background: "transparent",
        fontFamily: "var(--font-mono)",
      },
      colors: [POSITIVE_BORDER, NEGATIVE_BORDER],
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: density.columnWidth,   
          distributed: false,      
          borderRadius: 2,         
          borderRadiusApplication: 'around',
          borderRadiusWhenStacked: 'last', // 'all' | 'last'
         
        }  
      },
      dataLabels: { enabled: false },
      stroke: { show: false},
      states: {
        hover: { filter: { type: "lighten", value: 10 } },
        active: { filter: { type: "none", value: 10 } },
      },
      xaxis: {
        categories: bots.map((b) => b.name),
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          show: true,
          rotate: 0,
          hideOverlappingLabels: false,
          trim: false,
          maxHeight: 8,
          offsetY: -4,
          formatter: (val) => (val === MANUAL_LABEL ? "👤" : String(val)),
          style: {
            colors: "rgba(255, 255, 255, 0.78)",
            fontSize: density.labelFontSize,
            fontWeight: 800,
          },
        },
      },
      yaxis: {
        labels: {
          formatter: formatTick,
          style: { colors: "rgba(255, 255, 255, 0.6)", fontSize: "8px" },
          minWidth: 0,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      grid: {
        borderColor: "rgba(255, 255, 255, 0.055)",
        padding: { top: 2, right: 2, bottom: 0, left: 0 },
        yaxis: { lines: { show: false } },
        xaxis: { lines: { show: false } },
      },
      legend: {
        show: true,
        position: "bottom",
        horizontalAlign: "left",
        fontSize: "12px",
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        offsetX: -4,
        offsetY: 8,
        itemMargin: { horizontal:6, vertical: 6 },
        markers: { size: 7 },
        labels: { colors: "rgba(255, 255, 255, 0.7)" },
      },
      tooltip: {
        enabled: true,
        shared: false,
        intersect: true,
        theme: "dark",
        followCursor: false,
        onDatasetHover: { highlightDataSeries: false },
        custom: ({ seriesIndex, dataPointIndex }) => {
          const bot = bots[dataPointIndex];
          if (!bot) return "";

          const isProfit = seriesIndex === 0;
          const val = isProfit ? bot.grossProfit : -Math.abs(bot.grossLoss);
          const count = isProfit ? bot.wins : bot.losses;
          const color = isProfit ? POSITIVE_BORDER : NEGATIVE_BORDER;

          return `
            <div class="bot-pnl-tooltip">
              <span style=" color: ${color}; font-size: 14px; font-weight: 600;">${formatCompactSignedNumber(val, 1)}</span>
              <span style="color: #FFEB3B; font-size: 14px;font-weight: 600;"> (${count})</span>
            </div>
          `;
        },
      },
    }),
    [bots, chartId, density],
  );

  if (!bots.length) {
    return (
      <div className="bot-pnl-panel bot-pnl-panel--empty" role="region" aria-label="Bot performance">
        No bot activity for this timeframe.
      </div>
    );
  }

  return (
    <div className="bot-pnl-panel" role="region" aria-label="Bot performance">
      <div className="bot-pnl-scroll">
        <div className="bot-pnl-canvas-wrap" style={chartStyle}>
          <Chart options={options} series={series} type="bar" height="100%" width="100%" />
        </div>
      </div>
    </div>
  );
}

export const BotPnLPanel = memo(BotPnLPanelImpl);
