"use client";
import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { getUTCDateKey } from "@/lib/time";
import type { PositionsResponse } from "@/lib/trading/types";

interface Props {
  positions: PositionsResponse["historyPositions"] | null | undefined;
  loading?: boolean;
  error?: string | null;
  landscape?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["", "M", "", "W", "", "F", ""];

function getCurrentUTCYear(): number {
  return new Date().getUTCFullYear();
}

function buildDailyMap(
  positions: PositionsResponse["historyPositions"],
  year: number,
): Map<string, { pnl: number; count: number }> {
  const map = new Map<string, { pnl: number; count: number }>();
  const prefix = `${year}-`;
  for (const pos of positions) {
    if (!pos.closedAt) continue;
    const key = getUTCDateKey(pos.closedAt);
    if (!key || !key.startsWith(prefix)) continue;
    const netPnl = pos.profit + (pos.swap ?? 0) + (pos.commission ?? 0);
    const existing = map.get(key);
    if (existing) {
      existing.pnl += netPnl;
      existing.count += 1;
    } else {
      map.set(key, { pnl: netPnl, count: 1 });
    }
  }
  return map;
}

type WeekColumn = {
  monthLabel?: string;
  days: Array<{ dateKey: string | null }>;
};

function buildWeekGrid(year: number): WeekColumn[] {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1MonDay = jan1.getUTCDay(); // Sun=0 … Sat=6

  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const totalDays = isLeap ? 366 : 365;
  const totalWeeks = Math.ceil((jan1MonDay + totalDays) / 7);

  const weeks: WeekColumn[] = [];

  for (let w = 0; w < totalWeeks; w++) {
    const days: WeekColumn["days"] = [];
    let monthLabel: string | undefined;

    for (let d = 0; d < 7; d++) {
      const dayOffset = w * 7 + d - jan1MonDay;
      if (dayOffset < 0 || dayOffset >= totalDays) {
        days.push({ dateKey: null });
        continue;
      }
      const date = new Date(Date.UTC(year, 0, 1 + dayOffset));
      const m = date.getUTCMonth() + 1;
      const dd = date.getUTCDate();
      const dateKey = `${year}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      days.push({ dateKey });
      if (dd === 1 && monthLabel === undefined) {
        monthLabel = MONTHS[m - 1];
      }
    }

    weeks.push({ days, monthLabel });
  }

  return weeks;
}

function getIntensityClass(pnl: number): string {
  if (pnl === 0) return "";
  const abs = Math.abs(pnl);
  // Levels by order of magnitude: <10 → 1 (units), 10–99 → 2 (tens),
  // 100–999 → 3 (hundreds), 1000–9999 → 4 (thousands), ≥10000 → 5 (ten-thousands+).
  const level = abs < 100 ? 1 : abs < 1000 ? 2 : abs < 10000 ? 3 : 4;
  return pnl > 0 ? `heatmap-cell--pos-${level}` : `heatmap-cell--neg-${level}`;
}

export function ProfitHeatmapPanel({ positions, loading, error, landscape }: Props) {
  const currentYear = useMemo(() => getCurrentUTCYear(), []);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [activeDateKey, setActiveDateKey] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const fsPanelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fsScrollRef = useRef<HTMLDivElement>(null);

  const availableYears = useMemo(() => {
    if (!positions?.length) return [currentYear];
    const years = new Set<number>([currentYear]);
    for (const pos of positions) {
      if (!pos.closedAt) continue;
      const key = getUTCDateKey(pos.closedAt);
      if (key) years.add(parseInt(key.slice(0, 4)));
    }
    return Array.from(years).sort((a, b) => a - b);
  }, [positions, currentYear]);

  const dailyMap = useMemo(() => {
    if (!positions) return new Map<string, { pnl: number; count: number }>();
    return buildDailyMap(positions, selectedYear);
  }, [positions, selectedYear]);

  const weekGrid = useMemo(() => buildWeekGrid(selectedYear), [selectedYear]);

  const prevYear = [...availableYears].reverse().find((y) => y < selectedYear);
  const nextYear = availableYears.find((y) => y > selectedYear);

  function autoScroll(ref: React.RefObject<HTMLDivElement | null>, colWidth: number, halfCell: number) {
    if (!ref.current || loading) return;
    const currentKey = getUTCDateKey(new Date());
    let weekIndex = -1;
    if (currentKey) {
      weekIndex = weekGrid.findIndex((w) => w.days.some((d) => d.dateKey === currentKey));
    }
    if (weekIndex !== -1) {
      const scrollWidth = ref.current.clientWidth;
      const targetScroll = weekIndex * colWidth - scrollWidth / 2 + halfCell;
      ref.current.scrollLeft = Math.max(0, targetScroll);
    } else {
      ref.current.scrollLeft = ref.current.scrollWidth;
    }
  }

  // Normal: 11px cell + 2px gap = 13px col, half cell = 5.5
  useEffect(() => {
    autoScroll(scrollRef, 13, 5.5);
  }, [selectedYear, loading, weekGrid]);

  // Fullscreen: 14px cell + 3px gap = 17px col, half cell = 7
  useEffect(() => {
    if (!fullscreen) return;
    const timer = setTimeout(() => autoScroll(fsScrollRef, 17, 7), 30);
    return () => clearTimeout(timer);
  }, [fullscreen, selectedYear, loading, weekGrid]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFullscreen(false); setActiveDateKey(null); setTooltipPos(null); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (error) return null;

  const activeData = activeDateKey ? dailyMap.get(activeDateKey) : null;

  function renderCells(containerRef: React.RefObject<HTMLDivElement | null>) {
    return weekGrid.flatMap((week, wi) =>
      week.days.map((day, di) => {
        if (!day.dateKey) {
          return <div key={`${wi}-${di}`} className="heatmap-cell heatmap-cell--empty" />;
        }
        const data = dailyMap.get(day.dateKey);
        const intensityClass = data ? getIntensityClass(data.pnl) : "";
        const tooltipText = data
          ? `${day.dateKey}  ${data.pnl >= 0 ? "+" : ""}${data.pnl.toFixed(2)}  (${data.count} trade${data.count !== 1 ? "s" : ""})`
          : day.dateKey;
        const isActive = activeDateKey === day.dateKey;
        return (
          <div
            key={`${wi}-${di}`}
            className={`heatmap-cell${intensityClass ? ` ${intensityClass}` : ""}${isActive ? " is-active" : ""}`}
            title={tooltipText ?? undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (isActive) {
                setActiveDateKey(null);
                setTooltipPos(null);
              } else {
                setActiveDateKey(day.dateKey);
                if (containerRef.current) {
                  const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const panelRect = containerRef.current.getBoundingClientRect();
                  setTooltipPos({
                    x: cellRect.left + cellRect.width / 2 - panelRect.left,
                    y: cellRect.top - panelRect.top,
                  });
                }
              }
            }}
          />
        );
      }),
    );
  }

  function renderBody(
    scrollRefArg: React.RefObject<HTMLDivElement | null>,
    containerRefArg: React.RefObject<HTMLDivElement | null>,
    fsMode = false,
  ) {
    return (
      <div className="heatmap-body">
        <div className="heatmap-day-labels" aria-hidden="true">
          {DAY_LABELS.map((label, i) => (
            <span key={i} className="heatmap-day-label">
              {label}
            </span>
          ))}
        </div>
        <div className={`heatmap-scroll${fsMode ? " heatmap-scroll--fs" : ""}`} ref={scrollRefArg}>
          <div className="heatmap-months" aria-hidden="true">
            {weekGrid.map((week, wi) => (
              <span key={wi} className="heatmap-month-cell">
                {week.monthLabel ?? ""}
              </span>
            ))}
          </div>
          <div className="heatmap-grid">
            {renderCells(containerRefArg)}
          </div>
        </div>
      </div>
    );
  }

  function renderYearNav(stopPropagation = false) {
    const wrap = (fn: () => void) => (e: React.MouseEvent) => {
      if (stopPropagation) e.stopPropagation();
      fn();
    };
    return (
      <>
        <button
          className="heatmap-year-btn"
          disabled={!prevYear}
          onClick={wrap(() => { if (prevYear !== undefined) { setSelectedYear(prevYear); setActiveDateKey(null); } })}
          aria-label="Previous year"
        >
          ‹
        </button>
        <span className="heatmap-year-label">{selectedYear}</span>
        <button
          className="heatmap-year-btn"
          disabled={!nextYear}
          onClick={wrap(() => { if (nextYear !== undefined) { setSelectedYear(nextYear); setActiveDateKey(null); } })}
          aria-label="Next year"
        >
          ›
        </button>
      </>
    );
  }

  const tooltip = activeDateKey && tooltipPos && (
    <div
      className="sparkline-tooltip"
      style={{
        position: "absolute",
        left: tooltipPos.x,
        top: tooltipPos.y,
        transform: "translate(-50%, calc(-100% - 8px))",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <span>{activeDateKey}</span>
      <strong>{activeData ? (activeData.pnl >= 0 ? "+" : "") + activeData.pnl.toFixed(2) : "0.00"}</strong>
      {activeData && <span>{activeData.count} trade{activeData.count !== 1 ? "s" : ""}</span>}
    </div>
  );

  return (
    <>
      <div
        ref={panelRef}
        className="profit-heatmap-panel"
        aria-label="Yearly profit heatmap"
        onClick={() => { setActiveDateKey(null); setTooltipPos(null); }}
      >
        <div className="heatmap-header">
          {renderYearNav(true)}
          {landscape && (
            <button
              className="heatmap-expand-btn"
              onClick={(e) => { e.stopPropagation(); setFullscreen(true); setActiveDateKey(null); setTooltipPos(null); }}
              aria-label="Expand heatmap fullscreen"
            >
              ⤢
            </button>
          )}
        </div>
        {loading ? (
          <div className="heatmap-skeleton" aria-hidden="true" />
        ) : (
          renderBody(scrollRef, panelRef)
        )}
        {!fullscreen && tooltip}
      </div>

      {fullscreen && createPortal(
        <div
          className="heatmap-fs-overlay"
          onClick={() => { setFullscreen(false); setActiveDateKey(null); setTooltipPos(null); }}
        >
          <div
            ref={fsPanelRef}
            className="heatmap-fs-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="heatmap-fs-header">
              {renderYearNav(false)}
              <button
                className="heatmap-fs-close"
                onClick={() => { setFullscreen(false); setActiveDateKey(null); setTooltipPos(null); }}
                aria-label="Close fullscreen heatmap"
              >
                ✕
              </button>
            </div>
            {loading ? (
              <div className="heatmap-skeleton" aria-hidden="true" />
            ) : (
              renderBody(fsScrollRef, fsPanelRef, true)
            )}
            {tooltip}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
