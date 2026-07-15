"use client";
import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { tapGauge } from "@/lib/animations";
import {
  KpiPreviewCard,
  useKpiHint,
  type KpiHintContent,
} from "@/components/trading-monitor/SummaryChip";

/**
 * PerformanceQualityPanel
 * ------------------------
 * Renders the three core DD-quality metrics as full-circle gauges:
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

interface PerformanceQualityPanelProps {
  sharpeRatio: number | null | undefined;
  profitFactor: number | null | undefined;
  recoveryFactor: number | null | undefined;
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
  if (span <= 0) return "";
  const p0 = gaugePoint(from, radius);
  const p1 = gaugePoint(to, radius);
  const large = span > 0.5 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

// Benchmark thresholds tuned for retail FX accounts. These match the
// MQL5-style interpretations operators already use when reviewing reports.
const SHARPE_ZONES: Zone[] = [
  { limit: 0.5, tone: "poor", label: "แย่" },
  { limit: 2.0, tone: "fair", label: "พอใช้" },
  { limit: 3.0, tone: "good", label: "เยี่ยม" },
  { limit: 5.0, tone: "great", label: "แกร่ง" },
];

const PROFIT_FACTOR_ZONES: Zone[] = [
  { limit: 1.0, tone: "poor", label: "ขาดทุน" },
  { limit: 1.5, tone: "fair", label: "เสมอตัว" },
  { limit: 2.5, tone: "good", label: "กำไรดี" },
  { limit: 4.0, tone: "great", label: "แกร่ง" },
];

const RECOVERY_ZONES: Zone[] = [
  { limit: 1.0, tone: "poor", label: "แย่" },
  { limit: 3.0, tone: "fair", label: "พอใช้" },
  { limit: 5.0, tone: "good", label: "เยี่ยม" },
  { limit: 7.0, tone: "great", label: "แกร่ง" },
];

function pickZone(value: number, zones: Zone[]): Zone {
  for (const zone of zones) {
    if (value <= zone.limit) return zone;
  }
  return zones[zones.length - 1];
}

function QualityGauge({ config }: { config: BarConfig }) {
  const { label, zoneColors, value, zones, scaleMax, infinityZoneIndex, hint } =
    config;
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
  const hasValue =
    typeof value === "number" && (Number.isFinite(value) || isPositiveInfinity);
  const safeValue = isPositiveInfinity
    ? scaleMax
    : hasValue
      ? (value as number)
      : 0;
  const clampedValue = Math.max(0, Math.min(safeValue, scaleMax));
  const valueFrac = clampedValue / scaleMax;
  const currentZone =
    isPositiveInfinity && infinityZoneIndex !== undefined
      ? zones[infinityZoneIndex]
      : hasValue
        ? pickZone(safeValue, zones)
        : zones[0];
  const zoneIndex = zones.indexOf(currentZone);
  const accent = hasValue
    ? (zoneColors[zoneIndex] ?? zoneColors[zoneColors.length - 1])
    : undefined;

  // Ticks at interior zone-threshold boundaries.
  const tickFracs = zones
    .slice(0, -1)
    .map((zone) => zone.limit / scaleMax)
    .filter((f) => f > 0 && f < 1);

  // Cap just below 1 so a full-circle arc remains drawable as a path.
  const progressEnd = Math.min(Math.max(valueFrac, 0.0001), 0.9999);
  const dot = gaugePoint(valueFrac >= 1 ? 0.9999 : valueFrac);

  const valueText = !hasValue
    ? "—"
    : isPositiveInfinity
      ? "∞"
      : safeValue.toFixed(2);

  return (
    <motion.div
      {...(hint ? tapGauge : {})}
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
          {hasValue &&
            zones.map((zone, i) => {
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
          <span
            className="quality-gauge__tone"
            style={accent ? { color: accent } : undefined}
          >
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
    </motion.div>
  );
}

function PerformanceQualityPanelImpl({
  sharpeRatio,
  profitFactor,
  recoveryFactor,
}: PerformanceQualityPanelProps) {
  const bars = useMemo<BarConfig[]>(
    () => [
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
    ],
    [sharpeRatio, profitFactor, recoveryFactor],
  );

  return (
    <div
      className="perf-quality-panel perf-quality-panel--gauges-row"
      role="region"
      aria-label="Quality gauges"
    >
      {bars.map((config) => (
        <QualityGauge key={config.key} config={config} />
      ))}
    </div>
  );
}

export const PerformanceQualityPanel = memo(PerformanceQualityPanelImpl);
