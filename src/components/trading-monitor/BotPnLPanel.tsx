"use client";
import { memo, useMemo, useId, useState, useRef, useEffect, startTransition, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import type { ApexOptions } from 'apexcharts';
import type { PositionsResponse, Timeframe } from "@/lib/trading/types";
import { formatCompactSignedNumber } from "@/components/trading-monitor/formatters";
import { getSinceDate } from "@/lib/trading/analytics";
import { getBangkokDateParts } from "@/lib/time";
import { getPnlToneClass } from "@/components/trading-monitor/DashboardFormatters";
import { expandRow, tapRow } from "@/lib/animations";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const MANUAL_LABEL = "Manual";
const HASH_ID_REGEX = /^#\d+\|\s*(.+)$/;
const ALNUM_TOKEN_REGEX = /[A-Za-z0-9]+/g;

const POSITIVE_BORDER = "rgba(61, 214, 140, 1)";
const NEGATIVE_BORDER = "rgba(240, 77, 77, 1)";

const MAX_VISIBLE_BOT_BARS = 16;
const MIN_BOT_CATEGORY_WIDTH = 48;
const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD_PX = 8;

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
    labelFontSize: count > 16 ? "8px" : "12px",
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

  const tokens = trimmed.match(ALNUM_TOKEN_REGEX) ?? [];
  const first = tokens[0] ?? "";
  const token = first.toLowerCase() === "gold" ? (tokens[1] ?? first) : first;
  if (token) return token.slice(0, 3).toUpperCase();
  return "?";
}

function shortBkkDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const p = getBangkokDateParts(value);
  if (!p) return "-";
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}`;
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
  timeframe?: Timeframe;
}

function BotPnLPanelImpl({ positions, timeframe = "all" }: Props) {
  const filteredPositions = useMemo(() => {
    if (!positions?.length) return positions;
    const since = getSinceDate(timeframe);
    if (!since) return positions;
    return positions.filter((p) => p.closedAt != null && new Date(p.closedAt) >= since);
  }, [positions, timeframe]);

  const bots = useMemo(() => aggregate(filteredPositions), [filteredPositions]);
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);
  const density = useMemo(() => getDensityConfig(bots.length), [bots.length]);
  const chartStyle = useMemo(() => getBotPnlChartStyle(bots.length), [bots.length]);

  const [selectedBot, setSelectedBot] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const chartInstanceRef = useRef<unknown>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { startTransition(() => setSelectedBot(null)); }, [timeframe]);

  const selectedPositions = useMemo(() => {
    if (!selectedBot || !filteredPositions?.length) return null;
    return [...filteredPositions]
      .filter((p) => normalizeBotName(p.comment) === selectedBot)
      .sort((a, b) => {
        const ta = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const tb = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return tb - ta;
      });
  }, [selectedBot, filteredPositions]);

  const cancelLongPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    pressTimerRef.current = setTimeout(() => {
      if (!pressStartRef.current || !canvasWrapRef.current) return;
      const chart = chartInstanceRef.current as { w?: { globals?: Record<string, number> } } | null;
      const globals = chart?.w?.globals;
      const rect = canvasWrapRef.current.getBoundingClientRect();
      const relX = pressStartRef.current.x - rect.left;
      const gridLeft = globals?.translateX ?? 0;
      const count = globals?.dataPoints ?? bots.length;
      if (!count) return;
      const barWidth = (globals?.gridWidth ?? rect.width) / count;
      const idx = Math.floor((relX - gridLeft) / barWidth);
      if (idx >= 0 && idx < bots.length) {
        const name = bots[idx].name;
        setSelectedBot((prev) => (prev === name ? null : name));
      }
      pressStartRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressStartRef.current) return;
    const dx = Math.abs(e.clientX - pressStartRef.current.x);
    const dy = Math.abs(e.clientY - pressStartRef.current.y);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) cancelLongPress();
  };

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
        zoom: { enabled: false },
        toolbar: { show: false },
        offsetY: -4,
        animations: {
          enabled: true,
          animateGradually: { enabled: false },
          dynamicAnimation: { enabled: false },
        },
        background: "transparent",
        fontFamily: "var(--font-mono)",
        events: {
          mounted: (chart) => { chartInstanceRef.current = chart; },
          updated: (chart) => { chartInstanceRef.current = chart; },
        },
      },
      colors: [POSITIVE_BORDER, NEGATIVE_BORDER],
      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: density.columnWidth,
          distributed: false,
          borderRadius: 2,
          borderRadiusApplication: "around",
          borderRadiusWhenStacked: "all",
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      states: {
        hover: { filter: { type: "lighten", value: 30 } },
        active: { filter: { type: "lighten", value: 10 } },
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
          formatter: (val) => (val === MANUAL_LABEL ? "😎" : String(val)),
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
        itemMargin: { horizontal: 6, vertical: 6 },
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
              <span style="color: ${color}; font-size: 14px; font-weight: 600;">${formatCompactSignedNumber(val, 1)}</span>
              <span style="color: #FFEB3B; font-size: 14px; font-weight: 600;"> (${count})</span>
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

  const historyLabel = selectedBot === MANUAL_LABEL ? "😎" : selectedBot;

  return (
    <div className="bot-pnl-panel" role="region" aria-label="Bot performance">
      <div className="bot-pnl-scroll">
        <div
          ref={canvasWrapRef}
          className="bot-pnl-canvas-wrap"
          style={chartStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
        >
          <Chart options={options} series={series} type="bar" height="100%" width="100%" />
        </div>
      </div>

      {selectedBot && selectedPositions && (
        <div className="bot-pnl-history" role="region" aria-label={`${historyLabel} trade history`} onClick={() => setSelectedBot(null)}>
          {selectedPositions.map((p) => {
            const rowKey = p.positionId || `${p.symbol}-${p.closedAt}-${p.volume}`;
            const isExpanded = expandedRowId === rowKey;
            const net = p.profit + (p.swap ?? 0) + (p.commission ?? 0);
            const pnlTone = getPnlToneClass(net);
            return (
              <div key={rowKey} className={isExpanded ? "bot-pnl-history-row is-expanded" : "bot-pnl-history-row"}>
                <motion.button
                  {...tapRow}
                  type="button"
                  className="bot-pnl-history-row__summary"
                  aria-expanded={isExpanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedRowId((current) => (current === rowKey ? null : rowKey));
                  }}
                >
                  <div className="bot-pnl-history-row__line">
                    <span className="bot-pnl-history-row__symbol">{p.symbol}</span>
                    <span className="bot-pnl-history-row__type">{p.type?.slice(0, 1).toUpperCase() || "?"}</span>
                  </div>
                  <div className={`bot-pnl-history-row__pnl ${pnlTone}`}>
                    {formatCompactSignedNumber(net, 1)}
                  </div>
                </motion.button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      {...expandRow}
                      className="bot-pnl-history-row__details"
                    >
                      <div className="bot-pnl-history-row__detail">
                        <span className="bot-pnl-history-row__label">Pips</span>
                        <span className={`bot-pnl-history-row__val ${p.pips != null ? getPnlToneClass(p.pips) : ""}`}>
                          {p.pips != null ? (p.pips >= 0 ? "+" : "") + p.pips.toFixed(1) : "—"}
                        </span>
                      </div>
                      <div className="bot-pnl-history-row__detail">
                        <span className="bot-pnl-history-row__label">Date</span>
                        <span className="bot-pnl-history-row__val">{shortBkkDate(p.closedAt)}</span>
                      </div>
                      {p.swap != null && (
                        <div className="bot-pnl-history-row__detail">
                          <span className="bot-pnl-history-row__label">Swap</span>
                          <span className="bot-pnl-history-row__val">{formatCompactSignedNumber(p.swap, 1)}</span>
                        </div>
                      )}
                      {p.commission != null && (
                        <div className="bot-pnl-history-row__detail">
                          <span className="bot-pnl-history-row__label">Fee</span>
                          <span className="bot-pnl-history-row__val">{formatCompactSignedNumber(p.commission, 1)}</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const BotPnLPanel = memo(BotPnLPanelImpl);
