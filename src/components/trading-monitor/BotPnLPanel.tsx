"use client";
import { memo, useMemo, useId } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { PositionsResponse } from "@/lib/trading/types";
import { formatSignedCurrency, formatCompactSignedNumber } from "@/components/trading-monitor/formatters";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const SEP_REGEX = /[-_ #[(.]/;
const MANUAL_LABEL = "Manual";
const BOT_LABELS = [
  { label: "Axon", patterns: ["axonshift", "axon"] },
  { label: "QQ", patterns: ["qq"] },
  { label: "BB", patterns: ["bb_return", "bb"] },
  { label: "Full", patterns: ["full throttle", "full"] },
  { label: "Twi", patterns: ["twister", "twist"] },
  { label: "Wall", patterns: ["wall street", "wall"] },
  { label: "Gold", patterns: ["gold house", "gold"] },
  { label: "Aur", patterns: ["aurora", "aur"] },
];

const HASH_ID_REGEX = /^#\d+\|(.+)$/;

const POSITIVE_BORDER = "rgba(61, 214, 140, 1)";
const NEGATIVE_BORDER = "rgba(240, 77, 77, 1)";


function normalizeBotName(comment: string | null | undefined): string {
  if (!comment) return MANUAL_LABEL;
  const trimmed = comment.trim();
  if (!trimmed) return MANUAL_LABEL;

  const hashMatch = HASH_ID_REGEX.exec(trimmed);
  if (hashMatch) return hashMatch[1].trim() || MANUAL_LABEL;

  const normalized = trimmed.toLowerCase();
  const matched = BOT_LABELS.find(({ patterns }) =>
    patterns.some((pattern) => normalized.startsWith(pattern)),
  );
  if (matched) return matched.label;

  const sepIdx = SEP_REGEX.exec(trimmed)?.index ?? -1;
  const name = (sepIdx === -1 ? trimmed : trimmed.slice(0, sepIdx)).trim();
  return name || MANUAL_LABEL;
}

interface BotStat {
  name: string;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
}

function aggregate(positions: PositionsResponse["historyPositions"] | null | undefined): BotStat[] {
  if (!positions || !positions.length) return [];
  const map = new Map<string, BotStat>();
  for (const pos of positions) {
    const name = normalizeBotName(pos.comment);
    const net = pos.profit + (pos.swap ?? 0) + (pos.commission ?? 0);
    let stat = map.get(name);
    if (!stat) {
      stat = { name, grossProfit: 0, grossLoss: 0, netPnl: 0, trades: 0, wins: 0, losses: 0, winRate: 0 };
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
    stat.trades += 1;
  }
  for (const stat of map.values()) {
    stat.winRate = stat.trades > 0 ? stat.wins / stat.trades : 0;
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
  const chartId = useId();

  const series = useMemo(() => [
    {
      name: "Profit",
      data: bots.map(b => b.grossProfit)
    },
    {
      name: "Loss",
      data: bots.map(b => Math.abs(b.grossLoss))
    }
  ], [bots]);

  const options = useMemo<ApexOptions>(() => ({
    chart: {
      id: `bot-pnl-${chartId}`,
      type: 'bar',
      toolbar: { show: false },
      animations: { enabled: true, speed: 220 },
      background: 'transparent',
      fontFamily: 'var(--font-mono)',
      sparkline: { enabled: false }
    },
    colors: [POSITIVE_BORDER, NEGATIVE_BORDER],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '70%',
        borderRadius: 2,
        borderRadiusApplication: 'around'
      }
    },
    dataLabels: { enabled: false },
    stroke: {
      show: true,
      width: 2,
      colors: ['transparent']
    },
    xaxis: {
      categories: bots.map(b => b.name),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: {
          colors: 'rgba(255, 255, 255, 0.92)',
          fontSize: '9px',
          fontWeight: 600
        },
        offsetY: -2
      }
    },
    yaxis: {
      labels: {
        formatter: (val) => formatTick(val),
        style: {
          colors: 'rgba(255, 255, 255, 0.42)',
          fontSize: '8px'
        },
        offsetX: -2,
        minWidth: 34
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      padding: { top: 0, right: 0, bottom: 0, left: 10 },
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } }
    },
    legend: { show: false },
    tooltip: {
      shared: false,
      intersect: true,
      theme: 'dark',
      custom: ({ seriesIndex, dataPointIndex }) => {
        const bot = bots[dataPointIndex];
        if (!bot) return "";
        
        const isProfit = seriesIndex === 0;
        const val = isProfit ? bot.grossProfit : bot.grossLoss;
        const count = isProfit ? bot.wins : bot.losses;
        const color = isProfit ? POSITIVE_BORDER : NEGATIVE_BORDER;
        
        const formattedValue = formatCompactSignedNumber(val, 1);

        return `
          <div style="padding: 4px 8px; font-family: var(--font-mono); font-size: 11px; background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px;">
            <span style="color: ${color}; font-weight: 700;">${formattedValue}</span>
            <span style="color: #FFEB3B; font-weight: 600; margin-left: 4px;">(${count})</span>
          </div>
        `;
      }
    }
  }), [bots, chartId]);

  if (!bots.length) {
    return (
      <div className="bot-pnl-panel bot-pnl-panel--empty" role="region" aria-label="Bot performance">
        No bot activity for this timeframe.
      </div>
    );
  }

  const MAX_VISIBLE_BOTS = 5;
  const PX_PER_BOT = 48;
  const chartWidth = bots.length > MAX_VISIBLE_BOTS ? bots.length * PX_PER_BOT : '100%';

  return (
    <div className="bot-pnl-panel" role="region" aria-label="Bot performance">
      <div className="bot-pnl-scroll">
        <div className="bot-pnl-canvas-wrap" style={{ width: chartWidth }}>
          <Chart
            options={options}
            series={series}
            type="bar"
            height="100%"
            width="100%"
          />
        </div>
      </div>
      <div className="bot-pnl-legend">
        <div className="bot-pnl-legend-item">
          <span className="bot-pnl-legend-marker" style={{ backgroundColor: POSITIVE_BORDER }} />
          <span>Profit</span>
        </div>
        <div className="bot-pnl-legend-item">
          <span className="bot-pnl-legend-marker" style={{ backgroundColor: NEGATIVE_BORDER }} />
          <span>Loss</span>
        </div>
      </div>
      <ul className="bot-pnl-a11y-list" aria-label="Bot performance details">
        {bots.map((bot) => (
          <li key={bot.name}>
            {`${bot.name}: profit ${formatSignedCurrency(bot.grossProfit, 2)}, loss ${formatSignedCurrency(bot.grossLoss, 2)}, net ${formatSignedCurrency(bot.netPnl, 2)}, ${bot.trades} trades`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const BotPnLPanel = memo(BotPnLPanelImpl);
