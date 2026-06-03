"use client";
import { memo } from "react";
import { KpiPreviewCard, useKpiHint, type KpiHintContent } from "@/components/trading-monitor/SummaryChip";
import {
  formatCompactNumber,
  formatCompactSignedNumber,
  formatCurrency,
  type MetricTone,
} from "@/components/trading-monitor/formatters";

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
  relativeDrawdownPct?: number | null | undefined;
  maximalDrawdownAmount?: number | null | undefined;
  expectedPayoff?: number | null | undefined;
  averageLossTrade?: number | null | undefined;
  maximumConsecutiveLossAmount?: number | null | undefined;
  maximalDepositLoad?: number | null | undefined;
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

export interface QualityRiskMetricInput {
  relativeDrawdownPct?: number | null | undefined;
  maximalDrawdownAmount?: number | null | undefined;
  expectedPayoff?: number | null | undefined;
  averageLossTrade?: number | null | undefined;
  maximumConsecutiveLossAmount?: number | null | undefined;
  maximalDepositLoad?: number | null | undefined;
}

export interface QualityRiskMetricConfig {
  label: string;
  value: string;
  tone: MetricTone;
  fullValue: string;
  hint: KpiHintContent;
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
  { limit: 0.5, tone: "poor",  label: "ขาดทุน"  },
  { limit: 1.0, tone: "fair",  label: "เสมอตัว" },
  { limit: 3.0, tone: "good",  label: "กำไรดี"  },
  { limit: 4.0, tone: "great", label: "แกร่ง"   },
];

const RECOVERY_ZONES: Zone[] = [
  { limit: 1.0, tone: "poor",  label: "แย่"    },
  { limit: 2.0, tone: "fair",  label: "พอใช้"  },
  { limit: 4.0, tone: "good",  label: "เยี่ยม" },
  { limit: 7.0, tone: "great", label: "แกร่ง"  },
];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatUnsignedPercent(value: number | null | undefined, digits = 1) {
  if (!isFiniteNumber(value)) {
    return "-";
  }

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

function percentRiskTone(value: number | null | undefined): MetricTone {
  if (!isFiniteNumber(value)) {
    return "muted";
  }

  if (value <= 5) {
    return "positive";
  }

  if (value <= 15) {
    return "warning";
  }

  return "negative";
}

function positiveRiskTone(value: number | null | undefined): MetricTone {
  if (!isFiniteNumber(value)) {
    return "muted";
  }

  return value > 0 ? "negative" : "neutral";
}

function lossTone(value: number | null | undefined): MetricTone {
  if (!isFiniteNumber(value)) {
    return "muted";
  }

  return value > 0 ? "warning" : "neutral";
}

function signedFullCurrency(value: number | null | undefined) {
  if (!isFiniteNumber(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(value), 2)}`;
}

function lossFullCurrency(value: number | null | undefined) {
  if (!isFiniteNumber(value)) {
    return "-";
  }

  const amount = Math.abs(value);
  return amount > 0 ? `-${formatCurrency(amount, 2)}` : formatCurrency(0, 2);
}

export function buildQualityRiskMetrics(input: QualityRiskMetricInput): QualityRiskMetricConfig[] {
  const averageLossAmount = isFiniteNumber(input.averageLossTrade) ? Math.abs(input.averageLossTrade) : null;
  const lossRunAmount = isFiniteNumber(input.maximumConsecutiveLossAmount)
    ? Math.abs(input.maximumConsecutiveLossAmount)
    : null;

  return [
    {
      label: "REL DD",
      value: formatUnsignedPercent(input.relativeDrawdownPct, 1),
      tone: percentRiskTone(input.relativeDrawdownPct),
      fullValue: formatUnsignedPercent(input.relativeDrawdownPct, 1),
      hint: {
        definition: "Relative drawdown shows the largest balance decline as a percent of the balance peak in the selected timeframe.",
      },
    },
    {
      label: "MAX DD",
      value: formatCompactNumber(input.maximalDrawdownAmount, 2),
      tone: positiveRiskTone(input.maximalDrawdownAmount),
      fullValue: formatCurrency(input.maximalDrawdownAmount, 2),
      hint: {
        definition: "Max drawdown is the largest balance decline in account currency during the selected timeframe.",
      },
    },
    {
      label: "EXPECT",
      value: formatCompactSignedNumber(input.expectedPayoff, 1),
      tone: !isFiniteNumber(input.expectedPayoff) ? "muted" : input.expectedPayoff > 0 ? "positive" : input.expectedPayoff < 0 ? "negative" : "neutral",
      fullValue: signedFullCurrency(input.expectedPayoff),
      hint: {
        definition: "Expected payoff is average net result per closed position after profit, swap, and commission.",
      },
    },
    {
      label: "AVG LOSS",
      value: formatCompactNumber(averageLossAmount, 1),
      tone: lossTone(averageLossAmount),
      fullValue: lossFullCurrency(averageLossAmount),
      hint: {
        definition: "Average loss trade shows the typical closed-position loss size for the selected timeframe.",
      },
    },
    {
      label: "LOSS RUN",
      value: formatCompactNumber(lossRunAmount, 1),
      tone: positiveRiskTone(lossRunAmount),
      fullValue: lossFullCurrency(lossRunAmount),
      hint: {
        definition: "Loss run is the largest consecutive losing amount, useful for spotting streak risk.",
      },
    },
    {
      label: "DEP LOAD",
      value: formatUnsignedPercent(input.maximalDepositLoad, 1),
      tone: percentRiskTone(input.maximalDepositLoad),
      fullValue: formatUnsignedPercent(input.maximalDepositLoad, 1),
      hint: {
        definition: "Deposit load estimates margin pressure relative to deposited capital and current floating P/L.",
      },
    },
  ];
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
      ref={triggerRef as unknown as React.RefObject<HTMLDivElement>}
      className={`quality-gauge${hint ? " quality-gauge--hintable" : ""}`}
      onClick={wrapClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
      role="img"
      aria-label={`${label} ${hasValue ? `${valueText} (${currentZone.label}) จาก ${scaleMax}` : "ไม่มีข้อมูล"}`}
    >
      <span className="quality-gauge__label">{label}</span>
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
              r={4.5}
              fill={accent}
            />
          ) : null}
        </svg>
        <div className="quality-gauge__center">
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
  const winPct = hasValue ? Math.max(0, Math.min(winPercent as number, 100)) : 50;
  const lossPct = 100 - winPct;

  return (
    <div className="profitability-bar" role="img" aria-label={hasValue ? `Win ${winPct.toFixed(1)}% Loss ${lossPct.toFixed(1)}%` : "Profitability no data"}>
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
    </div>
  );
}

function QualityRiskMetric({ metric }: { metric: QualityRiskMetricConfig }) {
  const {
    chipRef: triggerRef,
    sheetOpen,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  } = useKpiHint(Boolean(metric.hint));

  return (
    <div
      ref={triggerRef as unknown as React.RefObject<HTMLDivElement>}
      className={`quality-risk-metric tone-${metric.tone}`}
      title={`${metric.label}: ${metric.fullValue}`}
      onClick={wrapClick()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
      role="img"
      aria-label={`${metric.label} ${metric.fullValue}`}
    >
      <span className="quality-risk-metric__label">{metric.label}</span>
      <span className="quality-risk-metric__value">{metric.value}</span>
      {sheetOpen ? (
        <KpiPreviewCard
          hint={metric.hint}
          label={metric.label}
          onClose={closeSheet}
          triggerRef={triggerRef}
        />
      ) : null}
    </div>
  );
}

function PerformanceQualityPanelImpl({
  sharpeRatio,
  profitFactor,
  recoveryFactor,
  winPercent,
}: PerformanceQualityPanelProps) {
  const bars: BarConfig[] = [
    {
      key: "sharpe",
      label: "SHARPE",
      zoneColors: ZONE_COLORS,
      value: sharpeRatio,
      zones: SHARPE_ZONES,
      scaleMax: 5,
      hint: {
        definition: "วัดผลตอบแทนที่ปรับความเสี่ยงของกลยุทธ์โดยการเปรียบเทียบผลตอบแทนเฉลี่ยกับส่วนเบี่ยงเบนมาตรฐานของผลตอบแทน ช่วยประเมินจํานวนผลตอบแทนที่เกิดขึ้นต่อหน่วยความเสี่ยง",
      },
    },
    {
      key: "pf",
      label: "PROFIT F.",
      zoneColors: ZONE_COLORS,
      value: profitFactor,
      zones: PROFIT_FACTOR_ZONES,
      scaleMax: 4,
      infinityZoneIndex: 2,
      hint: {
        definition: "กำไรรวม ÷ ขาดทุนรวม มากกว่า 1 = ยังมีกำไรสุทธิ",
      },
    },
    {
      key: "recovery",
      label: "RECOVERY",
      zoneColors: ZONE_COLORS,
      value: recoveryFactor,
      zones: RECOVERY_ZONES,
      scaleMax: 7,
      hint: {
        definition: "กำไรสุทธิ ÷ Max Drawdown ยิ่งสูงยิ่งฟื้นตัวจาก DD ได้ดี",
      },
    },
  ];

  return (
    <div className="perf-quality-panel" role="region" aria-label="Performance quality">
      {bars.map((config) => (
        <QualityGauge key={config.key} config={config} />
      ))}
      <ProfitabilityBar winPercent={winPercent} />
    </div>
  );
}

export const PerformanceQualityPanel = memo(PerformanceQualityPanelImpl);
