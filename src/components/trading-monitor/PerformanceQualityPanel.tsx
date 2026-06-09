"use client";
import { memo, useId, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { KpiPreviewCard, useKpiHint, type KpiHintContent } from "@/components/trading-monitor/SummaryChip";
import {
  formatCompactNumber,
  formatCompactSignedNumber,
  formatWholeNumber,
  type MetricTone,
} from "@/components/trading-monitor/formatters";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

/**
 * PerformanceQualityPanel
 * ------------------------
 * Renders the three core DD-quality metrics as semicircular gauges:
 *   • Sharpe Ratio
 *   • Profit Factor
 *   • Recovery Factor
 *
 * Numbers-first design: a single accent per card (Sharpe green, Profit
 * orange, Recovery blue). A dim track + accent progress arc fills to the
 * value, faint ticks mark the zone thresholds, and a small accent dot
 * sits on the arc at the value. The large accent value (with "/max") and
 * the Thai zone label own the center; the full description lives in the
 * tap hint. Styling via tokens in globals.css.
 */

type ZoneTone = "poor" | "fair" | "good" | "great";

interface Zone {
  readonly limit: number;
  readonly tone: ZoneTone;
  readonly label: string;
}

export interface PerformanceQualityPanelProps {
  sharpeRatio: number | null | undefined;
  profitFactor: number | null | undefined;
  recoveryFactor: number | null | undefined;
  winPercent: number | null | undefined;
  averageProfitTrade?: number | null | undefined;
  averageLossTrade?: number | null | undefined;
  longTradesTotal?: number | null | undefined;
  shortTradesTotal?: number | null | undefined;
  largestProfitTrade?: number | null | undefined;
  largestLossTrade?: number | null | undefined;
  maximumConsecutiveWins?: number | null | undefined;
  maximumConsecutiveLosses?: number | null | undefined;
  maxConsecutiveProfitAmount?: number | null | undefined;
  maxConsecutiveLossAmount?: number | null | undefined;
  /** "full" = all sections; "radar" = radar chart only; "gauges" = 3 donut gauges only */
  variant?: "full" | "radar" | "gauges";
  /** Override radar chart height (default 212) */
  radarHeight?: number;
}

// poor=red  fair=yellow  good=green  great=blue
const ZONE_COLORS = ["#f04d4d", "#facc15", "#3dd68c", "#4da8f5"] as const;

interface BarConfig {
  key: string;
  label: string;
  /** One color per zone — arc fills with the zone's color up to the current value. */
  zoneColors: readonly string[];
  value: number | null | undefined;
  zones: Zone[];
  scaleMax: number;
  infinityZoneIndex?: number;
  hint?: KpiHintContent;
}

export interface ComparisonBarMetricConfig {
  value: string;
  tone: MetricTone;
}

export interface ComparisonBarConfig {
  key: string;
  title: string;
  meta?: string;
  ariaLabel: string;
  left: ComparisonBarMetricConfig;
  right: ComparisonBarMetricConfig;
  leftWidth: number;
  rightWidth: number;
  leftColor: string;
  rightColor: string;
  hasValue: boolean;
  hint?: KpiHintContent;
}

// Full-circle gauge geometry (SVG user units, 200×200 viewBox).
const GAUGE = { cx: 100, cy: 100, r: 80, sw: 13 } as const;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Start at top (12 o'clock), sweep clockwise.
function gaugePoint(frac: number, radius: number = GAUGE.r) {
  const ang = -Math.PI / 2 + clamp01(frac) * 2 * Math.PI;
  return {
    x: GAUGE.cx + radius * Math.cos(ang),
    y: GAUGE.cy + radius * Math.sin(ang),
  };
}

function arcPath(from: number, to: number, radius: number = GAUGE.r): string {
  const span = to - from;
  if (span <= 0) return '';
  const p0 = gaugePoint(from, radius);
  const p1 = gaugePoint(to, radius);
  const large = span > 0.5 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

// Benchmark thresholds tuned for retail FX accounts. These match the
// MQL5-style interpretations operators already use when reviewing reports.
const SHARPE_ZONES: Zone[] = [
  { limit: 0.5, tone: "poor",  label: "แย่"    },
  { limit: 2.0, tone: "fair",  label: "พอใช้"  },
  { limit: 3.0, tone: "good",  label: "เยี่ยม" },
  { limit: 5.0, tone: "great", label: "แกร่ง"  },
];

const PROFIT_FACTOR_ZONES: Zone[] = [
  { limit: 1.0, tone: "poor",  label: "ขาดทุน"  },
  { limit: 1.5, tone: "fair",  label: "เสมอตัว" },
  { limit: 2.5, tone: "good",  label: "กำไรดี"  },
  { limit: 4.0, tone: "great", label: "แกร่ง"   },
];

const RECOVERY_ZONES: Zone[] = [
  { limit: 1.0, tone: "poor",  label: "แย่"    },
  { limit: 3.0, tone: "fair",  label: "พอใช้"  },
  { limit: 5.0, tone: "good",  label: "เยี่ยม" },
  { limit: 7.0, tone: "great", label: "แกร่ง"  },
];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteOrNull(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? value : null;
}

function toAbsFiniteOrNull(value: number | null | undefined): number | null {
  return isFiniteNumber(value) ? Math.abs(value) : null;
}

function formatNegativeCompactValue(value: number | null | undefined, digits = 1) {
  if (!isFiniteNumber(value)) {
    return "-";
  }

  const amount = Math.abs(value);
  return amount > 0 ? `-${formatCompactNumber(amount, digits)}` : formatCompactNumber(0, digits);
}

function buildSplitWidths(leftValue: number | null | undefined, rightValue: number | null | undefined) {
  const hasLeft = isFiniteNumber(leftValue);
  const hasRight = isFiniteNumber(rightValue);
  const leftAmount = hasLeft ? Math.abs(leftValue as number) : 0;
  const rightAmount = hasRight ? Math.abs(rightValue as number) : 0;
  const hasValue = hasLeft || hasRight;

  if (!hasValue) {
    return { hasValue, leftWidth: 50, rightWidth: 50 };
  }

  const total = leftAmount + rightAmount;
  if (total <= 0) {
    return { hasValue, leftWidth: 50, rightWidth: 50 };
  }

  return {
    hasValue,
    leftWidth: hasLeft ? (leftAmount / total) * 100 : 0,
    rightWidth: hasRight ? (rightAmount / total) * 100 : 0,
  };
}

export function buildAverageProfitLossBar(input: {
  averageProfitTrade?: number | null | undefined;
  averageLossTrade?: number | null | undefined;
}): ComparisonBarConfig {
  const profitValue = toFiniteOrNull(input.averageProfitTrade);
  const lossValue = toAbsFiniteOrNull(input.averageLossTrade);
  const widths = buildSplitWidths(profitValue, lossValue);

  return {
    key: "avg-profit-loss",
    title: "AVG P/L",
    hint: { definition: "เปรียบเทียบกำไรเฉลี่ยกับขาดทุนเฉลี่ย" },
    ariaLabel: `Average profit ${profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "no data"} average loss ${lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "no data"}`,
    left: {
      value: profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "—",
      tone: profitValue == null ? "muted" : profitValue > 0 ? "positive" : profitValue < 0 ? "negative" : "neutral",
    },
    right: {
      value: lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "—",
      tone: lossValue == null ? "muted" : lossValue > 0 ? "negative" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

export function buildLongShortTradeBar(input: {
  longTradesTotal?: number | null | undefined;
  shortTradesTotal?: number | null | undefined;
}): ComparisonBarConfig {
  const longValue = toFiniteOrNull(input.longTradesTotal);
  const shortValue = toFiniteOrNull(input.shortTradesTotal);
  const widths = buildSplitWidths(longValue, shortValue);
  const totalTrades = (longValue ?? 0) + (shortValue ?? 0);

  return {
    key: "long-short",
    title: "LONG / SHORT",
    hint: { definition: "จำนวน Buy กับ Sell" },
    ariaLabel: `Long trades ${longValue != null ? formatWholeNumber(longValue) : "no data"} short trades ${shortValue != null ? formatWholeNumber(shortValue) : "no data"} total ${totalTrades > 0 ? formatWholeNumber(totalTrades) : "no data"}`,
    left: {
      value: longValue != null ? formatWholeNumber(longValue) : "—",
      tone: longValue == null ? "muted" : "neutral",
    },
    right: {
      value: shortValue != null ? formatWholeNumber(shortValue) : "—",
      tone: shortValue == null ? "muted" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--neutral)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

export function buildBestWorstTradeBar(input: {
  largestProfitTrade?: number | null | undefined;
  largestLossTrade?: number | null | undefined;
}): ComparisonBarConfig {
  const bestValue = toFiniteOrNull(input.largestProfitTrade);
  const worstValue = toAbsFiniteOrNull(input.largestLossTrade);
  const widths = buildSplitWidths(bestValue, worstValue);

  return {
    key: "best-worst",
    title: "BEST / WORST",
    hint: { definition: "กำไรสูงสุดและขาดทุนสูงสุดต่อการเทรด" },
    ariaLabel: `Best trade ${bestValue != null ? formatCompactSignedNumber(bestValue, 1) : "no data"} worst trade ${worstValue != null ? formatNegativeCompactValue(worstValue, 1) : "no data"}`,
    left: {
      value: bestValue != null ? formatCompactSignedNumber(bestValue, 1) : "—",
      tone: bestValue == null ? "muted" : bestValue > 0 ? "positive" : "neutral",
    },
    right: {
      value: worstValue != null ? formatNegativeCompactValue(worstValue, 1) : "—",
      tone: worstValue == null ? "muted" : worstValue > 0 ? "negative" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

export function buildConsecutiveWinsLossesBar(input: {
  maximumConsecutiveWins?: number | null | undefined;
  maximumConsecutiveLosses?: number | null | undefined;
}): ComparisonBarConfig {
  const winsValue = toFiniteOrNull(input.maximumConsecutiveWins);
  const lossesValue = toFiniteOrNull(input.maximumConsecutiveLosses);
  const widths = buildSplitWidths(winsValue, lossesValue);

  return {
    key: "consec-wins-losses",
    title: "STREAK",
    hint: { definition: "จำนวนชนะและแพ้ติดต่อกันสูงสุด" },
    ariaLabel: `Max consecutive wins ${winsValue != null ? formatWholeNumber(winsValue) : "no data"} max consecutive losses ${lossesValue != null ? formatWholeNumber(lossesValue) : "no data"}`,
    left: {
      value: winsValue != null ? formatWholeNumber(winsValue) : "—",
      tone: winsValue == null ? "muted" : "positive",
    },
    right: {
      value: lossesValue != null ? formatWholeNumber(lossesValue) : "—",
      tone: lossesValue == null ? "muted" : "negative",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

export function buildConsecutiveProfitLossBar(input: {
  maxConsecutiveProfitAmount?: number | null | undefined;
  maxConsecutiveLossAmount?: number | null | undefined;
}): ComparisonBarConfig {
  const profitValue = toFiniteOrNull(input.maxConsecutiveProfitAmount);
  const lossValue = toFiniteOrNull(input.maxConsecutiveLossAmount);
  const widths = buildSplitWidths(profitValue, lossValue);

  return {
    key: "consec-profit-loss",
    title: "CONSEC P/L",
    hint: { definition: "กำไรและขาดทุนสะสมสูงสุดจากการเทรดต่อเนื่อง" },
    ariaLabel: `Max consecutive profit ${profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "no data"} max consecutive loss ${lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "no data"}`,
    left: {
      value: profitValue != null ? formatCompactSignedNumber(profitValue, 1) : "—",
      tone: profitValue == null ? "muted" : profitValue > 0 ? "positive" : "neutral",
    },
    right: {
      value: lossValue != null ? formatNegativeCompactValue(lossValue, 1) : "—",
      tone: lossValue == null ? "muted" : lossValue > 0 ? "negative" : "neutral",
    },
    leftWidth: widths.leftWidth,
    rightWidth: widths.rightWidth,
    leftColor: "var(--positive)",
    rightColor: "var(--negative)",
    hasValue: widths.hasValue,
  };
}

function pickZone(value: number, zones: Zone[]): Zone {
  for (const zone of zones) {
    if (value <= zone.limit) return zone;
  }
  return zones[zones.length - 1];
}

function QualityGauge({ config }: { config: BarConfig }) {
  const { label, zoneColors, value, zones, scaleMax, infinityZoneIndex, hint } = config;
  const {
    chipRef: triggerRef,
    sheetOpen,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  } = useKpiHint(Boolean(hint));

  const isPositiveInfinity = value === Number.POSITIVE_INFINITY;
  const hasValue = typeof value === "number" && (Number.isFinite(value) || isPositiveInfinity);
  const safeValue = isPositiveInfinity ? scaleMax : hasValue ? (value as number) : 0;
  const clampedValue = Math.max(0, Math.min(safeValue, scaleMax));
  const valueFrac = clampedValue / scaleMax;
  const currentZone = isPositiveInfinity && infinityZoneIndex !== undefined
    ? zones[infinityZoneIndex]
    : hasValue ? pickZone(safeValue, zones) : zones[0];
  const zoneIndex = zones.indexOf(currentZone);
  const accent = hasValue ? (zoneColors[zoneIndex] ?? zoneColors[zoneColors.length - 1]) : undefined;

  // Ticks at interior zone-threshold boundaries.
  const tickFracs = zones
    .slice(0, -1)
    .map((zone) => zone.limit / scaleMax)
    .filter((f) => f > 0 && f < 1);

  // Cap just below 1 so a full-circle arc remains drawable as a path.
  const progressEnd = Math.min(Math.max(valueFrac, 0.0001), 0.9999);
  const dot = gaugePoint(valueFrac >= 1 ? 0.9999 : valueFrac);

  const valueText = !hasValue ? "—" : isPositiveInfinity ? "∞" : safeValue.toFixed(2);

  return (
    <div
      ref={triggerRef as React.RefObject<HTMLDivElement>}
      className={`quality-gauge${hint ? " quality-gauge--hintable" : ""}`}
      onClick={wrapClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
      role="img"
      aria-label={`${label} ${hasValue ? `${valueText} (${currentZone.label}) จาก ${scaleMax}` : "ไม่มีข้อมูล"}`}
    >
      <div className="quality-gauge__dial">
        <svg className="quality-gauge__svg" viewBox="0 0 200 200">
          {/* Dim full-circle track */}
          <circle
            cx={GAUGE.cx}
            cy={GAUGE.cy}
            r={GAUGE.r}
            className="quality-gauge__base"
            fill="none"
            strokeWidth={GAUGE.sw}
          />
          {/* Zone-colored arc segments, each clipped to current value */}
          {hasValue && zones.map((zone, i) => {
            const zStart = i === 0 ? 0 : zones[i - 1].limit / scaleMax;
            const zEnd = zone.limit / scaleMax;
            const clippedEnd = Math.min(zEnd, progressEnd);
            if (clippedEnd <= zStart) return null;
            const d = arcPath(zStart, clippedEnd);
            if (!d) return null;
            return (
              <path
                key={zone.tone}
                className="quality-gauge__zone"
                d={d}
                fill="none"
                stroke={zoneColors[i]}
                strokeWidth={GAUGE.sw}
                strokeLinecap="butt"
              />
            );
          })}
          {/* Tick lines cut through arc at zone boundaries */}
          {tickFracs.map((f) => {
            const inner = gaugePoint(f, GAUGE.r - GAUGE.sw / 2);
            const outer = gaugePoint(f, GAUGE.r + GAUGE.sw / 2);
            return (
              <line
                key={f}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                className="quality-gauge__tick"
                strokeWidth={2.4}
              />
            );
          })}
          {/* Endpoint dot */}
          {hasValue && accent ? (
            <circle
              className="quality-gauge__dot"
              cx={dot.x}
              cy={dot.y}
              r={5.5}
              fill={accent}
            />
          ) : null}
        </svg>
        <div className="quality-gauge__center">
          <span className="quality-gauge__label">{label}</span>
          <span className="quality-gauge__readout">
            <span
              className="quality-gauge__value"
              data-empty={!hasValue ? "true" : undefined}
              style={accent ? { color: accent } : undefined}
            >
              {valueText}
            </span>
          </span>
          <span className="quality-gauge__tone" style={accent ? { color: accent } : undefined}>
            {hasValue ? currentZone.label : "ไม่มีข้อมูล"}
          </span>
        </div>
      </div>
      {hint && sheetOpen ? (
        <KpiPreviewCard
          hint={hint}
          label={label}
          onClose={closeSheet}
          triggerRef={triggerRef}
        />
      ) : null}
    </div>
  );
}

function ProfitabilityBar({ winPercent }: { winPercent: number | null | undefined }) {
  const hasValue = typeof winPercent === "number" && Number.isFinite(winPercent);
  const winPct = hasValue ? Math.max(0, Math.min(winPercent as number, 100)) : 0;
  const lossPct = hasValue ? 100 - winPct : 0;
  const hint: KpiHintContent = { definition: "สัดส่วนเทรดกำไรเทียบกับเทรดขาดทุน" };
  const {
    chipRef: triggerRef,
    sheetOpen,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  } = useKpiHint(true);

  return (
    <div
      ref={triggerRef as React.RefObject<HTMLDivElement>}
      className="profitability-bar profitability-bar--hintable"
      role="img"
      aria-label={hasValue ? `Win ${winPct.toFixed(1)}% Loss ${lossPct.toFixed(1)}%` : "Profitability no data"}
      onClick={wrapClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
    >
      <span className="profitability-bar__title">PROFITABILITY</span>
      <div className="profitability-bar__track" data-empty={!hasValue ? "true" : undefined}>
        <div className="profitability-bar__segment profitability-bar__segment--win" style={{ width: `${winPct}%` }} />
        <div className="profitability-bar__segment profitability-bar__segment--loss" style={{ width: `${lossPct}%` }} />
      </div>
      <div className="profitability-bar__values">
        <span className="profitability-bar__pct profitability-bar__pct--win">
          {hasValue ? `${winPct.toFixed(1)}%` : "—"}
        </span>
        <span className="profitability-bar__pct profitability-bar__pct--loss">
          {hasValue ? `${lossPct.toFixed(1)}%` : "—"}
        </span>
      </div>
      {sheetOpen ? (
        <KpiPreviewCard hint={hint} label="PROFITABILITY" onClose={closeSheet} triggerRef={triggerRef} />
      ) : null}
    </div>
  );
}

function ComparisonBar({ config }: { config: ComparisonBarConfig }) {
  const {
    chipRef: triggerRef,
    sheetOpen,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  } = useKpiHint(Boolean(config.hint));

  return (
    <div
      ref={triggerRef as React.RefObject<HTMLDivElement>}
      className={`comparison-bar${config.hint ? " comparison-bar--hintable" : ""}`}
      role="img"
      aria-label={config.ariaLabel}
      onClick={wrapClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
    >
      <div className="comparison-bar__title-row">
        <span className="comparison-bar__title">{config.title}</span>
        {config.meta ? <span className="comparison-bar__meta">{config.meta}</span> : null}
      </div>
      <div className="comparison-bar__track" data-empty={!config.hasValue ? "true" : undefined}>
        <div
          className="comparison-bar__segment comparison-bar__segment--left"
          style={{ width: `${config.leftWidth}%`, background: config.leftColor }}
        />
        <div
          className="comparison-bar__segment comparison-bar__segment--right"
          style={{ width: `${config.rightWidth}%`, background: config.rightColor }}
        />
      </div>
      <div className="comparison-bar__values">
        <span className="comparison-bar__item">
          <span className={`comparison-bar__value tone-${config.left.tone}`} style={{ color: config.leftColor }}>
            {config.left.value}
          </span>
        </span>
        <span className="comparison-bar__item comparison-bar__item--right">
          <span className={`comparison-bar__value tone-${config.right.tone}`} style={{ color: config.rightColor }}>
            {config.right.value}
          </span>
        </span>
      </div>
      {config.hint && sheetOpen ? (
        <KpiPreviewCard
          hint={config.hint}
          label={config.title}
          onClose={closeSheet}
          triggerRef={triggerRef}
        />
      ) : null}
    </div>
  );
}

// "Good" zone entry points — normalized 0–100 — used as the benchmark ring.
// PF:  1.5/4  × 100 = 38   RF: 3.0/7 × 100 ≈ 43
// AVG P/L: ratio 1.5 → 1.5/3 × 100 = 50
const RADAR_BENCHMARK = [40, 38, 43, 50, 50, 50];
const RADAR_SERIES_COLORS = ["#4da8f5", "rgba(255,255,255,0.38)"];

function PerformanceRadarChart({
  sharpeRatio,
  profitFactor,
  recoveryFactor,
  winPercent,
  averageProfitTrade,
  averageLossTrade,
  maximumConsecutiveWins,
  maximumConsecutiveLosses,
  height = 212,
}: Pick<
  PerformanceQualityPanelProps,
  | "sharpeRatio"
  | "profitFactor"
  | "recoveryFactor"
  | "winPercent"
  | "averageProfitTrade"
  | "averageLossTrade"
  | "maximumConsecutiveWins"
  | "maximumConsecutiveLosses"
> & { height?: number }) {
  const chartId = useId();
  const series = useMemo(() => {
    const norm = (v: number | null | undefined, max: number): number => {
      if (!isFiniteNumber(v)) return 0;
      return Math.round(Math.min(Math.max(v as number, 0), max) / max * 100);
    };
    const pfSafe = profitFactor === Number.POSITIVE_INFINITY ? 4 : profitFactor;

    // AVG P/L ratio: avgProfit / |avgLoss|, capped at 3x
    const avgPLRatio = (() => {
      const profit = isFiniteNumber(averageProfitTrade) ? (averageProfitTrade as number) : null;
      const loss = isFiniteNumber(averageLossTrade) ? Math.abs(averageLossTrade as number) : null;
      if (profit == null || loss == null || loss === 0) return 0;
      return Math.round(Math.min(profit / loss, 3) / 3 * 100);
    })();

    // Streak quality: wins / (wins + losses) as percentage
    const streakQuality = (() => {
      const wins = isFiniteNumber(maximumConsecutiveWins) ? (maximumConsecutiveWins as number) : null;
      const losses = isFiniteNumber(maximumConsecutiveLosses) ? (maximumConsecutiveLosses as number) : null;
      if (wins == null || losses == null) return 0;
      const total = wins + losses;
      return total === 0 ? 0 : Math.round((wins / total) * 100);
    })();

    return [
      {
        name: "ผลจริง",
        data: [
          norm(sharpeRatio, 5),
          norm(pfSafe, 4),
          norm(recoveryFactor, 7),
          norm(winPercent, 100),
          avgPLRatio,
          streakQuality,
        ],
      },
      {
        name: "เกณฑ์",
        data: RADAR_BENCHMARK,
      },
    ];
  }, [sharpeRatio, profitFactor, recoveryFactor, winPercent, averageProfitTrade, averageLossTrade, maximumConsecutiveWins, maximumConsecutiveLosses]);

  const options = useMemo(
    () => ({
      chart: {
        id: chartId,
        type: "radar" as const,
        background: "transparent",
        toolbar: { show: false },
        animations: {
          enabled: false,
        },
        sparkline: { enabled: false },
        fontFamily: "var(--font-mono)",
      },
      colors: RADAR_SERIES_COLORS,
      xaxis: {
        categories: ["SHARPE", "PROFIT F.", "RECOVERY", "WIN %", "AVG P/L", "STREAK"],
        labels: {
          show: true,
        },
      },
      yaxis: { show: false, max: 100, min: 0 },
      stroke: {
        width: [1.5, 1],
        colors: RADAR_SERIES_COLORS,
        dashArray: [0, 4],
        lineCap: "round",
      },
      fill: {
        colors: ["#4da8f5", "rgba(255,255,255,0.12)"],
        opacity: [0.18, 0.08],
      },
      markers: {
        size: [3.5, 0],
        colors: ["#4da8f5", "transparent"],
        strokeColors: ["#08131f", "transparent"],
        strokeWidth: 1.5,
        hover: { size: 5 },
      },
      plotOptions: {
        radar: {
          // Explicit size avoids ApexCharts v5 bug where globals.padding is
          // undefined at Radar init time, causing NaN coordinates for all vertices.
          size: 70,
          polygons: {
            strokeColors: "rgba(255,255,255,0.08)",
            connectorColors: "rgba(255,255,255,0.08)",
            fill: { colors: ["rgba(255,255,255,0.02)", "transparent"] },
          },
        },
      },
      grid: {
        padding: { top: 10, right: 10, bottom: 6, left: 10 },
      },
      tooltip: { enabled: false },
      legend: { show: false },
    }) satisfies ApexOptions,
    [chartId],
  );

  const hasAnyMetric =
    isFiniteNumber(sharpeRatio) ||
    profitFactor === Number.POSITIVE_INFINITY ||
    isFiniteNumber(profitFactor) ||
    isFiniteNumber(recoveryFactor) ||
    isFiniteNumber(winPercent);

  if (!hasAnyMetric) return null;

  return (
    <div className="perf-radar">
      <Chart options={options} series={series} type="radar" height={height} width="100%" />
      <div className="perf-radar__legend">
        <span className="perf-radar__legend-item perf-radar__legend-item--actual">ผลจริง</span>
        <span className="perf-radar__legend-item perf-radar__legend-item--bench">เกณฑ์</span>
      </div>
    </div>
  );
}

function PerformanceQualityPanelImpl({
  sharpeRatio,
  profitFactor,
  recoveryFactor,
  winPercent,
  averageProfitTrade,
  averageLossTrade,
  longTradesTotal,
  shortTradesTotal,
  largestProfitTrade,
  largestLossTrade,
  maximumConsecutiveWins,
  maximumConsecutiveLosses,
  maxConsecutiveProfitAmount,
  maxConsecutiveLossAmount,
  variant = "full",
  radarHeight,
}: PerformanceQualityPanelProps) {
  const bars = useMemo<BarConfig[]>(() => [
    {
      key: "sharpe",
      label: "SHARPE",
      zoneColors: ZONE_COLORS,
      value: sharpeRatio,
      zones: SHARPE_ZONES,
      scaleMax: 5,
      hint: { definition: "ความคุ้มค่าของผลตอบแทนเมื่อเทียบกับความเสี่ยง" },
    },
    {
      key: "pf",
      label: "PROFIT F.",
      zoneColors: ZONE_COLORS,
      value: profitFactor,
      zones: PROFIT_FACTOR_ZONES,
      scaleMax: 4,
      infinityZoneIndex: 2,
      hint: { definition: "ความสามารถในการทำกำไรเทียบกับการขาดทุน" },
    },
    {
      key: "recovery",
      label: "RECOVERY",
      zoneColors: ZONE_COLORS,
      value: recoveryFactor,
      zones: RECOVERY_ZONES,
      scaleMax: 7,
      hint: { definition: "ความสามารถในการฟื้นตัวจาก Drawdown" },
    },
  ], [sharpeRatio, profitFactor, recoveryFactor]);

  if (variant === "radar") {
    return (
      <div className="perf-quality-panel perf-quality-panel--radar-only" role="region" aria-label="Performance radar">
        <PerformanceRadarChart
          sharpeRatio={sharpeRatio}
          profitFactor={profitFactor}
          recoveryFactor={recoveryFactor}
          winPercent={winPercent}
          averageProfitTrade={averageProfitTrade}
          averageLossTrade={averageLossTrade}
          maximumConsecutiveWins={maximumConsecutiveWins}
          maximumConsecutiveLosses={maximumConsecutiveLosses}
          height={radarHeight}
        />
      </div>
    );
  }

  if (variant === "gauges") {
    return (
      <div className="perf-quality-panel perf-quality-panel--gauges-row" role="region" aria-label="Quality gauges">
        {bars.map((config) => (
          <QualityGauge key={config.key} config={config} />
        ))}
      </div>
    );
  }

  return (
    <div className="perf-quality-panel" role="region" aria-label="Performance quality">
      {/* 0. Radar overview */}
      <PerformanceRadarChart
        sharpeRatio={sharpeRatio}
        profitFactor={profitFactor}
        recoveryFactor={recoveryFactor}
        winPercent={winPercent}
        averageProfitTrade={averageProfitTrade}
        averageLossTrade={averageLossTrade}
        maximumConsecutiveWins={maximumConsecutiveWins}
        maximumConsecutiveLosses={maximumConsecutiveLosses}
      />
      {/* 1. Quality Gauges */}
      {bars.map((config) => (
        <QualityGauge key={config.key} config={config} />
      ))}

      {/* 2. Comparison Bars */}
      <ProfitabilityBar winPercent={winPercent} />
      <ComparisonBar config={buildAverageProfitLossBar({ averageProfitTrade, averageLossTrade })} />
      <ComparisonBar config={buildLongShortTradeBar({ longTradesTotal, shortTradesTotal })} />
      <ComparisonBar config={buildBestWorstTradeBar({ largestProfitTrade, largestLossTrade })} />
      <ComparisonBar config={buildConsecutiveWinsLossesBar({ maximumConsecutiveWins, maximumConsecutiveLosses })} />
      <ComparisonBar config={buildConsecutiveProfitLossBar({ maxConsecutiveProfitAmount, maxConsecutiveLossAmount })} />
    </div>
  );
}

export const PerformanceQualityPanel = memo(PerformanceQualityPanelImpl);
