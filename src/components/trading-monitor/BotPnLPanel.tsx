"use client";
import {
  memo,
  useMemo,
  useId,
  useState,
  useRef,
  useEffect,
  useCallback,
  startTransition,
  type CSSProperties,
} from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import type { ApexOptions } from "apexcharts";
import type { PositionsResponse, Timeframe } from "@/lib/trading/types";
import { formatCompactSignedNumber } from "@/components/trading-monitor/formatters";
import {
  getPnlToneClass,
  getSideToneClass,
  formatPositionSide,
  formatPlainNumberValue,
  formatSignedPlainAmountKpiValue,
  formatTradeExitReason,
  formatTradePrice,
  formatTradeHistoryDateTime,
  getTradeExitToneClass,
  positionHistoryNetPnl,
} from "@/components/trading-monitor/dashboardFormatters";
import {
  expandRow,
  tapRow,
  botSheetCardVariants,
  botSheetImgVariants,
  botSheetLineVariants,
  botSheetCountVariants,
  botSheetListVariants,
  botSheetRowVariants,
  botArtworkPreviewVariants,
} from "@/lib/animations";
import {
  getBotLabel,
  MANUAL_BOT_LABEL,
  BOT_REGISTRY,
  type BotMeta,
} from "@/lib/trading/bots";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

const POSITIVE_BORDER = "rgba(61, 214, 140, 1)";
const NEGATIVE_BORDER = "rgba(240, 77, 77, 1)";

function renderStars(rating: number): string {
  const rounded = Math.round(rating * 2) / 2;
  const full = Math.floor(rounded);
  const half = rounded % 1 !== 0;
  const empty = 5 - full - (half ? 1 : 0);
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(empty);
}

const MAX_VISIBLE_BOT_BARS = 16;
const MIN_BOT_CATEGORY_WIDTH = 48;
const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD_PX = 8;
const SHEET_HALF_FRAC = 0.52;
const SHEET_SNAP_THRESHOLD = 0.38;

type Position = NonNullable<PositionsResponse["historyPositions"]>[number];

interface DensityConfig {
  columnWidth: string;
  labelFontSize: string;
}

function getDensityConfig(count: number): DensityConfig {
  return {
    columnWidth: "55%",
    labelFontSize: count > 16 ? "8px" : "12px",
  };
}

function getBotPnlChartStyle(count: number): CSSProperties {
  return {
    width:
      count <= MAX_VISIBLE_BOT_BARS
        ? "100%"
        : `${(count / MAX_VISIBLE_BOT_BARS) * 100}%`,
    minWidth: `${count * MIN_BOT_CATEGORY_WIDTH}px`,
    height: "100%",
  };
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
    const name = getBotLabel(pos.comment);
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
  const bots = useMemo(() => aggregate(positions), [positions]);
  const rawId = useId();
  const chartId = useMemo(() => rawId.replace(/:/g, ""), [rawId]);
  const density = useMemo(() => getDensityConfig(bots.length), [bots.length]);
  const chartStyle = useMemo(
    () => getBotPnlChartStyle(bots.length),
    [bots.length],
  );

  const [selectedBot, setSelectedBot] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "win" | "loss">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [sheetSnap, setSheetSnap] = useState<"half" | "full">("half");
  const [liveH, setLiveH] = useState<number | null>(null);
  const [artworkPreview, setArtworkPreview] = useState<{
    meta: BotMeta;
    barCenterX: number;
    tapY: number;
  } | null>(null);
  const artworkDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const selectedMeta = useMemo<BotMeta | null>(() => {
    if (!selectedBot || selectedBot === MANUAL_BOT_LABEL) return null;
    return (
      Object.values(BOT_REGISTRY).find((m) => m.label === selectedBot) ?? null
    );
  }, [selectedBot]);

  const chartInstanceRef = useRef<unknown>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const sheetDragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    startTransition(() => setSelectedBot(null));
  }, [timeframe]);

  useEffect(() => {
    setSheetSnap("half");
    setLiveH(null);
    setExpandedRowId(null);
    setFilterMode("all");
    setSortOrder("newest");
    if (selectedBot) {
      sheetRef.current?.focus({ preventScroll: true });
    }
  }, [selectedBot]);

  const selectedPositions = useMemo(() => {
    if (!selectedBot || !positions?.length) return null;
    const forBot = positions.filter(
      (p) => getBotLabel(p.comment) === selectedBot,
    );
    const byOutcome =
      filterMode === "all"
        ? forBot
        : forBot.filter(
            (p) => positionHistoryNetPnl(p) >= 0 === (filterMode === "win"),
          );
    return [...byOutcome].sort((a, b) => {
      const ta = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const tb = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
  }, [selectedBot, positions, filterMode, sortOrder]);

  const dismissArtwork = useCallback(() => {
    if (artworkDismissRef.current) clearTimeout(artworkDismissRef.current);
    setArtworkPreview(null);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartRef.current = null;
  }, []);

  const hitTestBar = useCallback(
    (
      clientX: number,
      clientY: number,
    ): { idx: number; barCenterX: number; tapY: number } | null => {
      if (!canvasWrapRef.current) return null;
      const chart = chartInstanceRef.current as {
        w?: { globals?: Record<string, number> };
      } | null;
      const globals = chart?.w?.globals;
      const rect = canvasWrapRef.current.getBoundingClientRect();
      const relX = clientX - rect.left;
      const tapY = clientY - rect.top;
      const gridLeft = globals?.translateX ?? 0;
      const count = globals?.dataPoints ?? bots.length;
      if (!count) return null;
      const barWidth = (globals?.gridWidth ?? rect.width) / count;
      const idx = Math.floor((relX - gridLeft) / barWidth);
      if (idx < 0 || idx >= bots.length) return null;
      return { idx, barCenterX: gridLeft + (idx + 0.5) * barWidth, tapY };
    },
    [bots.length],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (artworkPreview) {
        dismissArtwork();
        return;
      }
      pressStartRef.current = { x: e.clientX, y: e.clientY };
      pressTimerRef.current = setTimeout(() => {
        if (!pressStartRef.current) return;
        const hit = hitTestBar(
          pressStartRef.current.x,
          pressStartRef.current.y,
        );
        if (hit) {
          const name = bots[hit.idx].name;
          setSelectedBot((prev) => (prev === name ? null : name));
        }
        pressStartRef.current = null;
      }, LONG_PRESS_MS);
    },
    [artworkPreview, dismissArtwork, hitTestBar, bots],
  );

  const handlePointerUp = useCallback(() => {
    if (!pressTimerRef.current || !pressStartRef.current) {
      pressStartRef.current = null;
      return;
    }
    // Timer still running = quick tap (< LONG_PRESS_MS)
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
    const startX = pressStartRef.current.x;
    const startY = pressStartRef.current.y;
    pressStartRef.current = null;

    const hit = hitTestBar(startX, startY);
    if (!hit) return;
    const meta = Object.values(BOT_REGISTRY).find(
      (m) => m.label === bots[hit.idx].name,
    );
    if (!meta?.image) return;

    setArtworkPreview({ meta, barCenterX: hit.barCenterX, tapY: hit.tapY });
    if (artworkDismissRef.current) clearTimeout(artworkDismissRef.current);
    artworkDismissRef.current = setTimeout(dismissArtwork, 2200);
  }, [hitTestBar, bots, dismissArtwork]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pressStartRef.current) return;
      const dx = Math.abs(e.clientX - pressStartRef.current.x);
      const dy = Math.abs(e.clientY - pressStartRef.current.y);
      if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) cancelLongPress();
    },
    [cancelLongPress],
  );

  const getSnapHeight = useCallback((snap: "half" | "full"): number => {
    const panelH = panelRef.current?.offsetHeight ?? 290;
    return snap === "full" ? panelH : Math.round(panelH * SHEET_HALF_FRAC);
  }, []);

  const handleSheetPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const startH = liveH ?? getSnapHeight(sheetSnap);
      sheetDragRef.current = { startY: e.clientY, startH };
    },
    [liveH, sheetSnap, getSnapHeight],
  );

  const handleSheetPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!sheetDragRef.current || !panelRef.current) return;
      const panelH = panelRef.current.offsetHeight;
      const dy = sheetDragRef.current.startY - e.clientY; // positive = drag up
      const newH = Math.max(
        60,
        Math.min(panelH, sheetDragRef.current.startH + dy),
      );
      setLiveH(newH);
    },
    [],
  );

  const handleSheetPointerUp = useCallback(() => {
    if (!sheetDragRef.current) return;
    const panelH = panelRef.current?.offsetHeight ?? 290;
    const halfH = Math.round(panelH * SHEET_HALF_FRAC);
    const currentH = liveH ?? getSnapHeight(sheetSnap);

    if (currentH < panelH * SHEET_SNAP_THRESHOLD) {
      setLiveH(null);
      setSelectedBot(null);
    } else if (currentH < halfH + (panelH - halfH) * 0.5) {
      setSheetSnap("half");
      setLiveH(null);
    } else {
      setSheetSnap("full");
      setLiveH(null);
    }
    sheetDragRef.current = null;
  }, [liveH, sheetSnap, getSnapHeight]);

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
        offsetY: -36,
        animations: {
          enabled: true,
          animateGradually: { enabled: false },
          dynamicAnimation: { enabled: false },
        },
        background: "transparent",
        fontFamily: "var(--font-mono)",
        events: {
          mounted: (chart) => {
            chartInstanceRef.current = chart;
          },
          updated: (chart) => {
            chartInstanceRef.current = chart;
          },
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
          formatter: (val) => (val === MANUAL_BOT_LABEL ? "😎" : String(val)),
          style: {
            colors: "rgba(255, 255, 255, 0.78)",
            fontSize: density.labelFontSize,
            fontWeight: 800,
          },
        },
      },
      yaxis: {
        tickAmount: 2,
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
        fontSize: "14px",
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        offsetX: -4,
        offsetY: 8,
        itemMargin: { horizontal: 8, vertical: 6 },
        markers: { size: 9 },
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
      <div
        className="bot-pnl-panel bot-pnl-panel--empty"
        role="region"
        aria-label="Bot performance"
      >
        No bot activity for this timeframe.
      </div>
    );
  }

  const historyLabel = selectedBot === MANUAL_BOT_LABEL ? "😎" : selectedBot;
  const sheetAnimateH =
    liveH != null
      ? liveH
      : sheetSnap === "full"
        ? "100%"
        : `${SHEET_HALF_FRAC * 100}%`;

  return (
    <div
      ref={panelRef}
      className="bot-pnl-panel"
      role="region"
      aria-label="Bot performance"
    >
      <div className="bot-pnl-scroll">
        <div
          ref={canvasWrapRef}
          className={`bot-pnl-canvas-wrap${selectedBot ? " bot-pnl-canvas-wrap--active" : ""}`}
          style={chartStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelLongPress}
        >
          <Chart
            options={options}
            series={series}
            type="bar"
            height="100%"
            width="100%"
          />
          <AnimatePresence>
            {artworkPreview && (
              <motion.div
                className="bot-pnl-artwork-preview"
                style={{
                  left: artworkPreview.barCenterX - 30,
                  top: Math.max(6, artworkPreview.tapY - 74),
                }}
                {...botArtworkPreviewVariants}
                aria-hidden="true"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artworkPreview.meta.image}
                  alt=""
                  width={60}
                  height={60}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {selectedBot && selectedPositions && (
          <motion.div
            ref={sheetRef}
            className="bot-pnl-sheet"
            role="dialog"
            aria-label={`${historyLabel} trade history`}
            tabIndex={-1}
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0, height: sheetAnimateH }}
            exit={{ opacity: 0, y: 80, transition: { duration: 0.18 } }}
            transition={
              liveH != null
                ? { duration: 0 }
                : {
                    type: "spring",
                    damping: 32,
                    stiffness: 400,
                    mass: 0.85,
                    opacity: { duration: 0.15 },
                  }
            }
            onKeyDown={(e) => e.key === "Escape" && setSelectedBot(null)}
          >
            {/* Drag handle bar */}
            <div
              className="bot-pnl-sheet__handle-bar"
              onPointerDown={handleSheetPointerDown}
              onPointerMove={handleSheetPointerMove}
              onPointerUp={handleSheetPointerUp}
              onPointerCancel={handleSheetPointerUp}
            >
              <div className="bot-pnl-sheet__grip" aria-hidden="true" />
              {selectedMeta ? (
                <motion.div
                  key={selectedBot}
                  className="bot-pnl-sheet__card"
                  variants={botSheetCardVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <motion.img
                    variants={botSheetImgVariants}
                    className="bot-pnl-sheet__bot-img"
                    src={selectedMeta.image}
                    alt={selectedMeta.name}
                    width={90}
                    height={90}
                    loading="lazy"
                  />
                  <div className="bot-pnl-sheet__bot-info">
                    <div className="bot-pnl-sheet__bot-lines">
                      <motion.div
                        variants={botSheetLineVariants}
                        className="bot-pnl-sheet__bot-name"
                      >
                        {selectedMeta.name}
                      </motion.div>
                      {selectedMeta.price === "—" && (
                        <motion.div
                          variants={botSheetLineVariants}
                          className="bot-pnl-sheet__delisted-row"
                        >
                          <span className="bot-pnl-sheet__delisted">
                            ไม่มีข้อมูล
                          </span>
                        </motion.div>
                      )}
                      {selectedMeta.rating > 0 && (
                        <motion.div
                          variants={botSheetLineVariants}
                          className="bot-pnl-sheet__bot-stars"
                        >
                          <span className="bot-pnl-sheet__bot-rating">
                            {renderStars(selectedMeta.rating)}
                          </span>
                          {selectedMeta.reviews > 0 && (
                            <span className="bot-pnl-sheet__bot-reviews">
                              ({selectedMeta.reviews})
                            </span>
                          )}
                        </motion.div>
                      )}
                      {selectedMeta.price !== "—" && (
                        <motion.div
                          variants={botSheetLineVariants}
                          className="bot-pnl-sheet__bot-price-row"
                        >
                          <span className="bot-pnl-sheet__bot-price">
                            {selectedMeta.price}
                          </span>
                        </motion.div>
                      )}
                    </div>
                    <motion.span
                      variants={botSheetCountVariants}
                      className="bot-pnl-sheet__count"
                    >
                      {selectedPositions.length}
                    </motion.span>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={selectedBot}
                  className="bot-pnl-sheet__header"
                  variants={botSheetCardVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <motion.span
                    variants={botSheetLineVariants}
                    className="bot-pnl-sheet__title"
                  >
                    {historyLabel}
                  </motion.span>
                  <motion.span
                    variants={botSheetCountVariants}
                    className="bot-pnl-sheet__count"
                  >
                    {selectedPositions.length}
                  </motion.span>
                </motion.div>
              )}
            </div>

            {/* Filter by outcome + sort order */}
            <div className="bot-pnl-sheet__toolbar">
              <div
                className="bot-pnl-sheet__filter-group"
                role="group"
                aria-label="Filter by outcome"
              >
                <button
                  type="button"
                  className={`bot-pnl-sheet__filter-btn${filterMode === "all" ? " is-active" : ""}`}
                  onClick={() => setFilterMode("all")}
                >
                  ALL
                </button>
                <button
                  type="button"
                  className={`bot-pnl-sheet__filter-btn bot-pnl-sheet__filter-btn--win${filterMode === "win" ? " is-active" : ""}`}
                  onClick={() => setFilterMode("win")}
                >
                  WIN
                </button>
                <button
                  type="button"
                  className={`bot-pnl-sheet__filter-btn bot-pnl-sheet__filter-btn--loss${filterMode === "loss" ? " is-active" : ""}`}
                  onClick={() => setFilterMode("loss")}
                >
                  LOSS
                </button>
              </div>
              <button
                type="button"
                className="bot-pnl-sheet__sort-btn"
                aria-label="Toggle sort order"
                onClick={() =>
                  setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))
                }
              >
                {sortOrder === "newest" ? "NEWEST ↓" : "OLDEST ↑"}
              </button>
            </div>

            {/* Scrollable trade list — reuses trade-history-row styles */}
            <motion.div
              key={`list-${selectedBot ?? "all"}`}
              className="bot-pnl-sheet__list"
              variants={botSheetListVariants}
              initial="hidden"
              animate="visible"
            >
              {!selectedPositions.length ? (
                <div className="bot-pnl-sheet__empty">
                  No trades match this filter.
                </div>
              ) : null}
              {selectedPositions.map((p) => {
                const rowKey =
                  p.positionId || `${p.symbol}-${p.closedAt}-${p.volume}`;
                const isExpanded = expandedRowId === rowKey;
                const sideLabel = formatPositionSide(p.type);
                const volumeLabel = formatPlainNumberValue(p.volume, 2);
                const net = positionHistoryNetPnl(p);
                const pnlTone = getPnlToneClass(net);
                const sideTone = getSideToneClass(sideLabel);

                return (
                  <motion.div
                    key={rowKey}
                    variants={botSheetRowVariants}
                    className={
                      isExpanded
                        ? "trade-history-row is-expanded"
                        : "trade-history-row"
                    }
                  >
                    <motion.button
                      {...tapRow}
                      type="button"
                      className="trade-history-row__summary"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedRowId((c) => (c === rowKey ? null : rowKey))
                      }
                    >
                      <div className="trade-history-row__line">
                        <div className="trade-history-row__instrument">
                          <strong>{p.symbol}</strong>
                          <span
                            className={`trade-history-row__side ${sideTone}`}
                          >
                            {sideLabel}
                          </span>
                          <span
                            className={`trade-history-row__volume ${sideTone}`}
                          >
                            {volumeLabel}
                          </span>
                        </div>
                        <div className={`trade-history-row__trail ${pnlTone}`}>
                          <strong>
                            {formatSignedPlainAmountKpiValue(net, 2)}
                          </strong>
                        </div>
                      </div>
                      <div className="trade-history-row__line trade-history-row__line--secondary">
                        <div className="trade-history-row__prices">
                          <span>{`${formatTradePrice(p.openPrice)} → ${formatTradePrice(p.closePrice)}`}</span>
                        </div>
                        <div className="trade-history-row__trail trade-history-row__trail--secondary">
                          <span>{formatTradeHistoryDateTime(p.closedAt)}</span>
                        </div>
                      </div>
                    </motion.button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          {...expandRow}
                          className="trade-history-row__details trade-history-row__details--2col"
                        >
                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              ∆pip
                            </span>
                            <span
                              className={`trade-history-row__val ${p.pips != null ? getPnlToneClass(p.pips) : ""}`}
                            >
                              {p.pips != null
                                ? formatPlainNumberValue(p.pips, 1)
                                : "—"}
                            </span>
                          </div>
                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              Open
                            </span>
                            <span className="trade-history-row__val">
                              {formatTradeHistoryDateTime(p.openedAt)}
                            </span>
                          </div>

                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              S/L
                            </span>
                            <span
                              className={`trade-history-row__val ${p.slHit ? "trade-history-row__val--sl-hit" : "trade-history-row__val--white"}`}
                            >
                              {formatTradePrice(p.sl)}
                            </span>
                          </div>
                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              Swap
                            </span>
                            <span className="trade-history-row__val trade-history-row__val--white">
                              {formatSignedPlainAmountKpiValue(p.swap, 1)}
                            </span>
                          </div>

                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              T/P
                            </span>
                            <span
                              className={`trade-history-row__val ${p.tpHit ? "trade-history-row__val--tp-hit" : "trade-history-row__val--white"}`}
                            >
                              {formatTradePrice(p.tp)}
                            </span>
                          </div>
                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              Charges
                            </span>
                            <span className="trade-history-row__val trade-history-row__val--white">
                              {formatSignedPlainAmountKpiValue(p.commission, 1)}
                            </span>
                          </div>

                          <div className="trade-history-row__detail">
                            <span className="trade-history-row__label">
                              Reason
                            </span>
                            <span
                              className={`trade-history-row__val ${getTradeExitToneClass(p)}`}
                            >
                              {formatTradeExitReason(p)}
                            </span>
                          </div>
                          <div className="trade-history-row__detail trade-history-row__detail--comment">
                            <span className="trade-history-row__label">
                              Comment
                            </span>
                            <span
                              className="trade-history-row__val trade-history-row__val--comment"
                              title={p.comment || undefined}
                            >
                              {p.comment?.trim() || "-"}
                            </span>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const BotPnLPanel = memo(BotPnLPanelImpl);
