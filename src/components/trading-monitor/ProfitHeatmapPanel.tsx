"use client";
import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { heatmapCell, heatmapTodayTransition } from "@/lib/animations";
import { getBangkokDateKey, getBangkokYear } from "@/lib/time";
import type { PositionsResponse } from "@/lib/trading/types";

interface Props {
  positions: PositionsResponse["historyPositions"] | null | undefined;
  loading?: boolean;
  error?: string | null;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_LABELS = ["", "M", "", "W", "", "F", ""];

function getCurrentBangkokYear(): number {
  return getBangkokYear(new Date()) ?? new Date().getUTCFullYear();
}

function buildDailyMap(
  positions: PositionsResponse["historyPositions"],
  year: number,
): Map<string, { pnl: number; count: number }> {
  const map = new Map<string, { pnl: number; count: number }>();
  const prefix = `${year}-`;
  for (const pos of positions) {
    if (!pos.closedAt) continue;
    const key = getBangkokDateKey(pos.closedAt);
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

const EMPTY_POSITIONS: NonNullable<PositionsResponse["historyPositions"]> = [];

export function ProfitHeatmapPanel({ positions, loading, error }: Props) {
  const currentYear = useMemo(() => getCurrentBangkokYear(), []);
  const todayKey = useMemo(() => getBangkokDateKey(new Date()), []);
  const reduceMotion = useReducedMotion();
  const [activeDateKey, setActiveDateKey] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const scopedPositions = positions ?? EMPTY_POSITIONS;

  const dailyMap = useMemo(() => {
    return buildDailyMap(scopedPositions, currentYear);
  }, [scopedPositions, currentYear]);

  const weekGrid = useMemo(() => buildWeekGrid(currentYear), [currentYear]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current && !loading) {
      const currentKey = getBangkokDateKey(new Date());
      let weekIndex = -1;
      if (currentKey) {
        weekIndex = weekGrid.findIndex((w) =>
          w.days.some((d) => d.dateKey === currentKey),
        );
      }

      if (weekIndex !== -1) {
        // Grid columns are 11px wide with 2px gap (auto-columns: 11px, gap: 2px)
        const columnWidth = 11 + 2;
        const scrollWidth = scrollRef.current.clientWidth;
        const targetScroll = weekIndex * columnWidth - scrollWidth / 2 + 5.5; // 5.5 is half of column width
        scrollRef.current.scrollLeft = Math.max(0, targetScroll);
      } else {
        scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
      }
    }
  }, [loading, weekGrid]);

  // Cells near the panel's left/right edge would otherwise center the
  // tooltip past the panel bounds (worst on narrow portrait screens) —
  // clamp against the tooltip's actual measured width after it mounts.
  useLayoutEffect(() => {
    if (!activeDateKey || !tooltipPos) return;
    const panelEl = panelRef.current;
    const tooltipEl = tooltipRef.current;
    if (!panelEl || !tooltipEl) return;
    const half = tooltipEl.offsetWidth / 2;
    const margin = 4;
    const min = half + margin;
    const max = panelEl.clientWidth - half - margin;
    const clampedX = Math.min(Math.max(tooltipPos.x, min), max);
    if (Math.abs(clampedX - tooltipPos.x) > 0.5) {
      setTooltipPos({ x: clampedX, y: tooltipPos.y });
    }
  }, [activeDateKey, tooltipPos]);

  if (error) return null;

  const activeData = activeDateKey ? dailyMap.get(activeDateKey) : null;

  const handleCellClick = (
    e: React.MouseEvent<HTMLElement>,
    dateKey: string,
    isActive: boolean,
  ) => {
    e.stopPropagation();
    if (isActive) {
      setActiveDateKey(null);
      setTooltipPos(null);
      return;
    }
    setActiveDateKey(dateKey);
    if (panelRef.current) {
      const cellRect = e.currentTarget.getBoundingClientRect();
      const panelRect = panelRef.current.getBoundingClientRect();
      setTooltipPos({
        x: cellRect.left + cellRect.width / 2 - panelRect.left,
        y: cellRect.top - panelRect.top,
      });
    }
  };

  // Amber breathing ring — subtle glow, not aggressive flash.
  const todayPulse = {
    boxShadow: [
      "0 0 0 1px rgba(251,191,36,0.85)",
      "0 0 0 1px rgba(251,191,36,1), 0 0 4px 1px rgba(251,191,36,0.35)",
      "0 0 0 1px rgba(251,191,36,0.85)",
    ],
  };

  return (
    <div
      ref={panelRef}
      className="profit-heatmap-panel"
      aria-label="Yearly profit heatmap"
      onClick={() => {
        setActiveDateKey(null);
        setTooltipPos(null);
      }}
    >

      {loading ? (
        <div className="heatmap-skeleton" aria-hidden="true" />
      ) : (
        <div className="heatmap-body">
          <div className="heatmap-day-labels" aria-hidden="true">
            {DAY_LABELS.map((label, i) => (
              <span key={i} className="heatmap-day-label">
                {label}
              </span>
            ))}
          </div>
          <div className="heatmap-scroll" ref={scrollRef}>
            <div className="heatmap-months" aria-hidden="true">
              {weekGrid.map((week, wi) => (
                <span key={wi} className="heatmap-month-cell">
                  {week.monthLabel ?? ""}
                </span>
              ))}
            </div>
            <div className="heatmap-grid">
              {weekGrid.flatMap((week, wi) =>
                week.days.map((day, di) => {
                  if (!day.dateKey) {
                    return (
                      <div
                        key={`${wi}-${di}`}
                        className="heatmap-cell heatmap-cell--empty"
                      />
                    );
                  }
                  const data = dailyMap.get(day.dateKey);
                  const intensityClass = data
                    ? getIntensityClass(data.pnl)
                    : "";
                  const tooltipText = data
                    ? `${day.dateKey}  ${data.pnl >= 0 ? "+" : ""}${data.pnl.toFixed(2)}  (${data.count} trade${data.count !== 1 ? "s" : ""})`
                    : day.dateKey;
                  const isActive = activeDateKey === day.dateKey;
                  const isToday = day.dateKey === todayKey;
                  if (isToday) {
                    return (
                      <motion.div
                        key={`${wi}-${di}`}
                        className={`heatmap-cell heatmap-cell--today${intensityClass ? ` ${intensityClass}` : ""}${isActive ? " is-active" : ""}`}
                        style={{ position: "relative", zIndex: 2 }}
                        title={tooltipText ?? undefined}
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.9 }}
                        animate={reduceMotion ? undefined : todayPulse}
                        transition={
                          reduceMotion ? undefined : heatmapTodayTransition
                        }
                        onClick={(e) =>
                          handleCellClick(e, day.dateKey!, isActive)
                        }
                      />
                    );
                  }
                  return (
                    <motion.div
                      {...heatmapCell}
                      key={`${wi}-${di}`}
                      className={`heatmap-cell${intensityClass ? ` ${intensityClass}` : ""}${isActive ? " is-active" : ""}`}
                      title={tooltipText ?? undefined}
                      onClick={(e) =>
                        handleCellClick(e, day.dateKey!, isActive)
                      }
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      )}
      {activeDateKey && tooltipPos && (
        <div
          ref={tooltipRef}
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
          <strong>
            {activeData
              ? (activeData.pnl >= 0 ? "+" : "") + activeData.pnl.toFixed(2)
              : "0.00"}
          </strong>
          {activeData && (
            <span>
              {activeData.count} trade{activeData.count !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
