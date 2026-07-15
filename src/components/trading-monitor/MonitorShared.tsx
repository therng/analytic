"use client";

import { useId, useState, useRef, lazy, Suspense } from "react";
import { useSparklineReactions, CHAINS } from "@/hooks/useSparklineReactions";
import { useValueFlash } from "@/hooks/useValueFlash";
const SparklineReactionRow = lazy(() =>
  import("@/components/social/SparklineReactionRow").then((m) => ({
    default: m.SparklineReactionRow,
  })),
);
import { motion, useReducedMotion } from "framer-motion";
import { tapPill } from "@/lib/animations";

import type {
  BalanceEventPoint,
  ChartPoint,
  Timeframe,
} from "@/lib/trading/types";
import {
  endOfBangkokDayTimestamp,
  formatSparklineXLabel,
  formatTooltipDateLabel,
  startOfBangkokDayTimestamp,
  toTimestamp,
} from "@/lib/time";

import {
  TIMEFRAME_OPTIONS,
  formatCurrency,
  formatCompactNumber,
} from "@/components/trading-monitor/formatters";

const ACCOUNT_CHART_COLOR = "var(--account-chart, #2c5d9d)";
const ACCOUNT_CHART_MUTED_COLOR = "var(--account-chart-muted, #97a3b1)";

export function TimeframeStrip({
  active,
  onChange,
}: {
  active: Timeframe;
  onChange: (value: Timeframe) => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="timeframe-strip"
      role="tablist"
      aria-label="Select timeframe"
    >
      {TIMEFRAME_OPTIONS.map((option) => (
        <motion.button
          key={option.value}
          type="button"
          className={
            option.value === active
              ? "timeframe-pill is-active"
              : "timeframe-pill"
          }
          aria-label={option.ariaLabel}
          aria-pressed={option.value === active}
          onClick={() => onChange(option.value)}
          {...(reduceMotion ? {} : tapPill)}
        >
          {option.label}
        </motion.button>
      ))}
    </div>
  );
}

export function InlineState({
  tone,
  title,
  message,
}: {
  tone: "error" | "empty" | "info";
  title: string;
  message: string;
}) {
  return (
    <div
      className={`section-state is-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getSparklinePalette(tone: string, active: boolean) {
  if (tone === "positive") {
    return {
      areaTop: "rgba(90, 160, 112, 0.18)",
      areaMid: "rgba(90, 160, 112, 0.08)",
      areaBottom: "rgba(90, 160, 112, 0.02)",
    };
  }

  if (tone === "negative") {
    return {
      areaTop: "rgba(196, 99, 96, 0.17)",
      areaMid: "rgba(196, 99, 96, 0.07)",
      areaBottom: "rgba(196, 99, 96, 0.02)",
    };
  }

  return {
    areaTop: active ? "rgba(44, 93, 157, 0.32)" : "rgba(83, 119, 165, 0.2)",
    areaMid: active ? "rgba(44, 93, 157, 0.14)" : "rgba(83, 119, 165, 0.08)",
    areaBottom: "rgba(44, 93, 157, 0.03)",
  };
}

function getTimestampValue(value: Date | string | null | undefined) {
  return toTimestamp(value);
}

function startOfDayWindow(timestamp: number) {
  return startOfBangkokDayTimestamp(timestamp) ?? timestamp;
}

function endOfDayWindow(timestamp: number) {
  return (
    endOfBangkokDayTimestamp(timestamp) ??
    startOfDayWindow(timestamp) + 23 * 60 * 60 * 1000
  );
}

function resolveBalanceValue(point: ChartPoint | BalanceEventPoint) {
  const balance = (point as Partial<BalanceEventPoint>).balance;
  if (typeof balance === "number" && Number.isFinite(balance)) {
    return balance;
  }

  return Number(point.y ?? 0);
}

function formatReportLocalDate(value: Date | string | null | undefined) {
  return formatTooltipDateLabel(value);
}

function withLivePoint(
  points: Array<ChartPoint | BalanceEventPoint>,
  liveTimestamp: Date | string | null | undefined,
  liveBalance: number | null | undefined,
) {
  const timestamp = toTimestamp(liveTimestamp);
  if (timestamp === null || !Number.isFinite(liveBalance)) {
    return points;
  }

  const liveX = new Date(timestamp).toISOString();
  const livePoint: BalanceEventPoint = {
    x: liveX,
    y: Number(liveBalance),
    balance: Number(liveBalance),
    eventType: null,
    eventDelta: null,
  };

  if (!points.length) {
    return [livePoint];
  }

  const lastPoint = points[points.length - 1];
  const lastTimestamp = getTimestampValue(lastPoint?.x);

  if (lastTimestamp === null || timestamp > lastTimestamp) {
    return [...points, livePoint];
  }

  if (Math.abs(timestamp - lastTimestamp) <= 60_000) {
    return [...points.slice(0, -1), { ...lastPoint, ...livePoint }];
  }

  return points;
}

function computeDailyScale(
  seriesList: Array<Array<ChartPoint | BalanceEventPoint>>,
  liveTimestamp: Date | string | null | undefined,
) {
  const allPoints = seriesList.flat();
  const values = allPoints
    .map((point) => resolveBalanceValue(point))
    .filter(Number.isFinite);
  const baselineSeries = seriesList.find((series) => series.length > 0) ?? [];
  const baselineBalance = baselineSeries.length
    ? resolveBalanceValue(baselineSeries[0]!)
    : 0;
  const maxDistanceFromBaseline = Math.max(
    0,
    ...values.map((value) => Math.abs(value - baselineBalance)),
  );
  const baselineOffset = Math.max(
    maxDistanceFromBaseline * 0.1,
    Math.abs(baselineBalance) * 0.0005,
    1,
  );
  const minimum = Math.min(baselineBalance - baselineOffset, ...values);
  const maximum = Math.max(baselineBalance + baselineOffset, ...values);
  const range = maximum - minimum || 1;
  const anchorTimestamp =
    getTimestampValue(liveTimestamp) ??
    getTimestampValue(allPoints[allPoints.length - 1]?.x) ??
    Date.now();
  const dayStart = startOfDayWindow(anchorTimestamp);
  const dayEnd = endOfDayWindow(anchorTimestamp);
  return { minimum, maximum, range, dayStart, dayEnd };
}

type DailyScale = ReturnType<typeof computeDailyScale>;

function projectDailySeries(
  points: Array<ChartPoint | BalanceEventPoint>,
  scale: DailyScale,
  width: number,
  height: number,
) {
  if (!points.length) {
    return {
      linePath: "",
      fillPath: "",
      points: [] as Array<{ x: number; y: number }>,
    };
  }

  const horizontalInset = Math.min(6, width / 24);
  const topInset = Math.min(6, height / 10);
  const bottomInset = Math.min(14, height / 4.5);
  const plotWidth = Math.max(width - horizontalInset * 2, 1);
  const plotHeight = Math.max(height - topInset - bottomInset, 1);

  const timelinePoints = points.map((point) => {
    const timestamp = getTimestampValue(point.x) ?? scale.dayStart;
    const clampedTimestamp = clamp(timestamp, scale.dayStart, scale.dayEnd);
    const timeFraction =
      (clampedTimestamp - scale.dayStart) / (scale.dayEnd - scale.dayStart);
    const valueFraction =
      (resolveBalanceValue(point) - scale.minimum) / scale.range;

    return {
      x: Number((horizontalInset + timeFraction * plotWidth).toFixed(2)),
      y: Number((topInset + (1 - valueFraction) * plotHeight).toFixed(2)),
    };
  });

  const linePath = buildSmoothPath(timelinePoints);
  const lastPoint = timelinePoints[timelinePoints.length - 1];
  const fillEndX = lastPoint?.x ?? width - horizontalInset;
  return {
    points: timelinePoints,
    linePath,
    fillPath: `${linePath} L ${fillEndX} ${height} L ${horizontalInset} ${height} Z`,
  };
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`;
  }

  const commands = [`M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`];

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)] ?? points[0]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const following = points[Math.min(points.length - 1, index + 2)] ?? next;
    const controlOneX = current.x + (next.x - previous.x) / 6;
    const controlOneY = current.y + (next.y - previous.y) / 6;
    const controlTwoX = next.x - (following.x - current.x) / 6;
    const controlTwoY = next.y - (following.y - current.y) / 6;

    commands.push(
      `C ${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)} ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)} ${next.x} ${next.y}`,
    );
  }

  return commands.join(" ");
}

function buildSmoothSegmentPath(
  points: Array<{ x: number; y: number }>,
  startIndex: number,
) {
  if (startIndex < 0 || startIndex >= points.length - 1) {
    return "";
  }

  const previous = points[Math.max(0, startIndex - 1)] ?? points[0];
  const current = points[startIndex];
  const next = points[startIndex + 1];
  const following = points[Math.min(points.length - 1, startIndex + 2)] ?? next;

  if (!previous || !current || !next || !following) {
    return "";
  }

  const controlOneX = current.x + (next.x - previous.x) / 6;
  const controlOneY = current.y + (next.y - previous.y) / 6;
  const controlTwoX = next.x - (following.x - current.x) / 6;
  const controlTwoY = next.y - (following.y - current.y) / 6;

  return [
    `M ${current.x} ${current.y}`,
    `C ${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)} ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)} ${next.x} ${next.y}`,
  ].join(" ");
}

function buildSparkline(values: number[], width: number, height: number) {
  if (!values.length) {
    return {
      linePath: "",
      fillPath: "",
      points: [] as Array<{ x: number; y: number }>,
    };
  }

  const minimum = Math.min(...values);
  const range = Math.max(...values) - minimum || 1;
  const horizontalInset = Math.min(6, width / 24);
  const plotWidth = Math.max(width - horizontalInset * 2, 1);
  const gap = values.length > 1 ? plotWidth / (values.length - 1) : 0;
  // Keep a bit more room below the line so the curve sits slightly higher in the frame.
  const topInset = Math.min(6, height / 10);
  const bottomInset = Math.min(14, height / 4.5);
  const plotHeight = Math.max(height - topInset - bottomInset, 1);
  const points = values.map((value, index) => {
    const valueFraction = (value - minimum) / range;
    return {
      x: Number((horizontalInset + index * gap).toFixed(2)),
      y: Number((topInset + (1 - valueFraction) * plotHeight).toFixed(2)),
    };
  });
  const linePath = buildSmoothPath(points);
  const lastPoint = points[points.length - 1];
  const fillEndX = lastPoint?.x ?? width - horizontalInset;

  return {
    points,
    linePath,
    fillPath: `${linePath} L ${fillEndX} ${height} L ${horizontalInset} ${height} Z`,
  };
}

function labelBalanceEvent(
  type: string | null | undefined,
  delta: number | null | undefined,
) {
  if ((type ?? "").toLowerCase().includes("balance")) {
    if ((delta ?? 0) > 0) {
      return "Deposit";
    }

    if ((delta ?? 0) < 0) {
      return "Withdrawal";
    }

    return "Balance";
  }

  return type || "Trading";
}

export function SparklineChart({
  points,
  active,
  tone = "neutral",
  onHighlightBalanceChange,
  timeframe = "1d",
  liveTimestamp,
  liveBalance,
  showAxisLabels = false,
  reactionTarget,
  equityPoints,
  liveEquityValue,
  showLiveBeacon = false,
}: {
  points: Array<ChartPoint | BalanceEventPoint>;
  active: boolean;
  tone?: "positive" | "negative" | "neutral" | "muted";
  onHighlightBalanceChange?: (balance: number | null) => void;
  timeframe?: Timeframe;
  liveTimestamp?: Date | string | null;
  liveBalance?: number | null;
  showAxisLabels?: boolean;
  reactionTarget?: { accountId: string; date: string };
  equityPoints?: Array<ChartPoint | BalanceEventPoint>;
  liveEquityValue?: number | null;
  showLiveBeacon?: boolean;
}) {
  const chartWidth = 320;
  const chartHeight = 112;
  const gradientId = useId();
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [reactionTrigger, setReactionTrigger] = useState(0);
  const canTriggerReaction = Boolean(reactionTarget && timeframe === "1d");
  const shellRef = useRef<HTMLDivElement>(null);

  // Tier-5 background effects — fetch counts regardless of timeframe so overlay persists
  const { counts: reactionCounts } = useSparklineReactions(
    reactionTarget?.accountId ?? "",
    reactionTarget?.date ?? "",
  );
  const t5Liked = (reactionCounts["👍"] ?? 0) >= CHAINS["👍"].thresholds[4];
  const t5Cheer = (reactionCounts["🎉"] ?? 0) >= CHAINS["🎉"].thresholds[4];
  const t5Skeptic = (reactionCounts["🙄"] ?? 0) >= CHAINS["🙄"].thresholds[4];
  const t5Active = Boolean(reactionTarget) && (t5Liked || t5Cheer || t5Skeptic);

  const resolvedPoints =
    timeframe === "1d"
      ? withLivePoint(points, liveTimestamp, liveBalance)
      : points;
  const values = resolvedPoints
    .map((point) => Number(point.y ?? 0))
    .filter(Number.isFinite);
  const hasEquityPoints = timeframe === "1d" && Boolean(equityPoints?.length);
  const dailyScale =
    timeframe === "1d"
      ? computeDailyScale(
          hasEquityPoints ? [resolvedPoints, equityPoints!] : [resolvedPoints],
          liveTimestamp,
        )
      : null;
  const {
    fillPath,
    linePath,
    points: sparklinePoints,
  } = timeframe === "1d"
    ? projectDailySeries(resolvedPoints, dailyScale!, chartWidth, chartHeight)
    : buildSparkline(values, chartWidth, chartHeight);
  const equityLine = hasEquityPoints
    ? projectDailySeries(equityPoints!, dailyScale!, chartWidth, chartHeight)
    : null;
  // useValueFlash must run unconditionally (hooks can't be called
  // conditionally) — feeding it 0 when there's no live value yet is safe
  // because 0 never changes on its own, so no spurious flash fires.
  const equityFlashSource = useValueFlash(
    Number.isFinite(liveEquityValue) ? (liveEquityValue as number) : 0,
  );
  const equityFlashClass = equityFlashSource
    ? equityFlashSource.replace("value-flash", "sparkline-equity-flash")
    : "";
  const equityLiveDotPoint =
    equityLine?.points[equityLine.points.length - 1] ?? null;
  const lastIndex = Math.max(0, sparklinePoints.length - 1);
  const currentPoint = sparklinePoints[lastIndex];
  const activeIndex = highlightedIndex ?? lastIndex;
  const activePoint =
    sparklinePoints[activeIndex] ?? sparklinePoints[lastIndex];
  const activeDataPoint =
    resolvedPoints[activeIndex] ?? resolvedPoints[lastIndex];
  const currentDotColor = ACCOUNT_CHART_COLOR;
  const statusPointColor = active
    ? ACCOUNT_CHART_COLOR
    : ACCOUNT_CHART_MUTED_COLOR;
  const showActiveMarker = Boolean(activePoint);
  const showCurrentDot = showLiveBeacon && Boolean(currentPoint);
  const beaconStyle =
    currentPoint && showCurrentDot
      ? {
          left: `${(currentPoint.x / chartWidth) * 100}%`,
          top: `${(currentPoint.y / chartHeight) * 100}%`,
          color: statusPointColor,
        }
      : null;
  const strokeByTone = {
    positive: "var(--positive)",
    negative: "var(--negative)",
    neutral: "var(--account-chart, var(--neutral))",
    muted: "var(--account-chart-muted, #97a3b1)",
  } as const;

  const palette = {
    stroke: strokeByTone[tone],
    ...getSparklinePalette(tone, active),
  };

  if (!sparklinePoints.length) {
    return (
      <div className="chart-empty">No balance curve for this timeframe.</div>
    );
  }

  const firstDataPoint = resolvedPoints[0];
  const lastDataPoint = resolvedPoints[resolvedPoints.length - 1];
  const midIndex = Math.floor(resolvedPoints.length / 2);
  const midDataPoint = resolvedPoints[midIndex];
  const firstSparklinePoint = sparklinePoints[0];
  const midSparklinePoint = sparklinePoints[midIndex];
  const lastSparklinePoint = sparklinePoints[lastIndex];
  const startLabelText = firstDataPoint
    ? formatSparklineXLabel(firstDataPoint.x, timeframe)
    : null;
  const endLabelText =
    resolvedPoints.length >= 2 && lastDataPoint
      ? formatSparklineXLabel(lastDataPoint.x, timeframe)
      : null;
  const showEndLabel = endLabelText !== null && startLabelText !== endLabelText;
  const midLabelText =
    resolvedPoints.length >= 3 && midDataPoint
      ? formatSparklineXLabel(midDataPoint.x, timeframe)
      : null;
  const showMidLabel =
    midLabelText !== null &&
    midLabelText !== startLabelText &&
    midLabelText !== endLabelText;
  const firstLabelPct = firstSparklinePoint
    ? (firstSparklinePoint.x / chartWidth) * 100
    : 0;
  const firstLabelStyle = {
    left: `${firstLabelPct}%`,
    transform: firstLabelPct < 10 ? "translateX(0)" : "translateX(-50%)",
  };
  const lastLabelPct = lastSparklinePoint
    ? (lastSparklinePoint.x / chartWidth) * 100
    : 0;
  const lastLabelStyle = {
    left: `${lastLabelPct}%`,
    transform: lastLabelPct > 90 ? "translateX(-100%)" : "translateX(-50%)",
  };
  const yLabelValue = values[values.length - 1];
  const yLabelText = Number.isFinite(yLabelValue)
    ? formatCompactNumber(yLabelValue)
    : null;
  const yLabelTopPct = currentPoint ? (currentPoint.y / chartHeight) * 100 : 50;

  const setHighlightedBalance = (index: number | null) => {
    setHighlightedIndex(index);
    const point = index === null ? null : resolvedPoints[index];
    const balance = point ? resolveBalanceValue(point) : null;
    onHighlightBalanceChange?.(balance);
  };
  const handleActivatePoint = (index: number, toggle = false) => {
    if (toggle && highlightedIndex === index) {
      setHighlightedBalance(null);
      return;
    }

    setHighlightedBalance(index);
  };

  const baseStroke = active ? palette.stroke : ACCOUNT_CHART_MUTED_COLOR;
  const segments = sparklinePoints.slice(1).map((point, index) => {
    const event = resolvedPoints[index + 1] as BalanceEventPoint | undefined;
    const label = event
      ? labelBalanceEvent(event.eventType, event.eventDelta)
      : "Trading";

    let stroke = baseStroke;
    if (label === "Deposit") {
      stroke = "var(--positive)";
    } else if (label === "Withdrawal") {
      stroke = "var(--negative)";
    }

    return {
      key: `${point.x}-${point.y}-${index}`,
      stroke,
      d: buildSmoothSegmentPath(sparklinePoints, index),
    };
  });

  return (
    <div
      ref={shellRef}
      className="sparkline-chart-shell"
      onMouseLeave={() => {
        if (timeframe !== "1d") {
          setHighlightedBalance(null);
        }
      }}
      onClick={
        canTriggerReaction ? () => setReactionTrigger((t) => t + 1) : undefined
      }
    >
      {t5Active && (
        <div
          className={[
            "sparkline-t5-overlay",
            t5Liked ? "sparkline-t5-overlay--liked" : "",
            t5Cheer ? "sparkline-t5-overlay--cheer" : "",
            t5Skeptic ? "sparkline-t5-overlay--skeptic" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        />
      )}
      <svg
        className="sparkline-chart"
        viewBox={`0 0 320 ${chartHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.areaTop} />
            <stop offset="72%" stopColor={palette.areaMid} />
            <stop offset="100%" stopColor={palette.areaBottom} />
          </linearGradient>
        </defs>
        {equityLine && equityLine.linePath ? (
          <path
            d={equityLine.linePath}
            fill="none"
            className="sparkline-equity-line"
          />
        ) : null}
        {equityLiveDotPoint ? (
          <circle
            cx={equityLiveDotPoint.x}
            cy={equityLiveDotPoint.y}
            r="3"
            className={`sparkline-equity-live-dot${equityFlashClass ? ` ${equityFlashClass}` : ""}`}
          />
        ) : null}
        <path
          d={fillPath}
          fill={`url(#${gradientId})`}
          className="sparkline-area"
        />
        <path
          d={linePath}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {segments.map((segment) => (
          <path
            key={segment.key}
            d={segment.d}
            fill="none"
            stroke={segment.stroke}
            strokeWidth="2.35"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="sparkline-segment"
          />
        ))}
        {sparklinePoints.map((point, index) => (
          <circle
            key={`${point.x}-${point.y}-${index}-hit`}
            className="sparkline-hit-target"
            cx={point.x}
            cy={point.y}
            r="22"
            fill="transparent"
            stroke="none"
            onMouseEnter={() => {
              if (timeframe !== "1d") {
                setHighlightedBalance(index);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              handleActivatePoint(index, timeframe === "1d");
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleActivatePoint(index, true);
            }}
          />
        ))}
        {currentPoint && showCurrentDot ? (
          <circle
            cx={currentPoint.x}
            cy={currentPoint.y}
            r="2"
            fill={currentDotColor}
            className="sparkline-live-dot__core"
          />
        ) : null}
        {activePoint &&
        showActiveMarker &&
        (!showCurrentDot || activeIndex !== lastIndex) ? (
          <circle
            cx={activePoint.x}
            cy={activePoint.y}
            r="2"
            fill={currentDotColor}
            stroke="rgba(255, 255, 255, 0.52)"
            strokeWidth="1.1"
            className="sparkline-dot__active"
          />
        ) : null}
      </svg>
      {beaconStyle ? (
        <span
          className="sparkline-live-beacon"
          style={beaconStyle}
          aria-hidden="true"
        >
          <span className="sparkline-live-beacon__ambient" />
          <span className="sparkline-live-beacon__pulse" />
        </span>
      ) : null}
      {showAxisLabels && startLabelText && firstSparklinePoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={firstLabelStyle}
          aria-hidden="true"
        >
          {startLabelText}
        </span>
      ) : null}
      {showAxisLabels && showMidLabel && midLabelText && midSparklinePoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={{
            left: `${(midSparklinePoint.x / chartWidth) * 100}%`,
            transform: "translateX(-50%)",
          }}
          aria-hidden="true"
        >
          {midLabelText}
        </span>
      ) : null}
      {showAxisLabels && showEndLabel && endLabelText && lastSparklinePoint ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--x"
          style={lastLabelStyle}
          aria-hidden="true"
        >
          {endLabelText}
        </span>
      ) : null}
      {showAxisLabels && yLabelText ? (
        <span
          className="sparkline-axis-label sparkline-axis-label--y"
          style={{ top: `${Math.max(4, Math.min(yLabelTopPct, 80))}%` }}
          aria-hidden="true"
        >
          {yLabelText}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {activeDataPoint
          ? `Balance chart: ${formatCurrency(resolveBalanceValue(activeDataPoint))} on ${formatReportLocalDate(activeDataPoint.x)}`
          : "Balance chart"}
      </span>
      {showAxisLabels && reactionTarget && timeframe === "1d" ? (
        <Suspense fallback={null}>
          <SparklineReactionRow
            accountId={reactionTarget.accountId}
            date={reactionTarget.date}
            triggerToggle={reactionTrigger}
            shellRef={shellRef}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export function TradingMonitorSharedStyles() {
  return (
    <style jsx global>{`
      .chart-axis text {
        fill: rgba(255, 255, 255, 0.58);
        font-family: var(--font-thai);
        font-size: 12px;
      }

      .detail-chart-area {
        opacity: 1;
      }

      .sparkline-area {
        opacity: 1;
      }

      .sparkline-chart-shell {
        position: relative;
        width: 100%;
        height: 100%;
        /* Clip vertically so oversized touch hit-targets near the top/bottom of the curve can't reach into the timeframe strip or KPI chips above/below; clip-path (not overflow-y) avoids turning this into a horizontal scroll container. */
        clip-path: inset(0 -100%);
      }

      .sparkline-tooltip {
        position: absolute;
        z-index: 3;
        display: grid;
        gap: 1px;
        min-width: 118px;
        padding: 7px 11px 8px;
        border: 0.5px solid rgba(255, 255, 255, 0.1);
        border-top: 0.5px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        background: rgba(6, 9, 20, 0.96);
        box-shadow:
          0 16px 40px rgba(0, 0, 0, 0.5),
          0 1px 0 rgba(255, 255, 255, 0.06) inset;
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
        backdrop-filter: blur(20px) saturate(1.4);
        pointer-events: none;
      }

      /* Date label */
      .sparkline-tooltip span {
        color: rgba(255, 255, 255, 0.4);
        font-size: 9.5px;
        line-height: 1.3;
        font-family: var(--font-thai);
        letter-spacing: 0.01em;
      }

      /* Time (1d) and currency — mono tabular */
      .sparkline-tooltip strong {
        font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
      }

      /* Time value (1d timeframe) */
      .sparkline-tooltip strong:first-of-type {
        color: rgba(255, 255, 255, 0.58);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
      }

      /* Currency value — gold accent */
      .sparkline-tooltip strong:last-of-type {
        color: var(--gold-300, #f5c842);
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0;
      }

      .sparkline-dot__active {
        filter: none;
      }

      .detail-chart-dot--active {
        filter: drop-shadow(0 0 12px rgba(83, 119, 165, 0.22));
      }

      .sparkline-axis-label {
        position: absolute;
        font-family: var(--font-thai);
        font-size: 9px;
        line-height: 1;
        color: rgba(255, 255, 255, 0.42);
        pointer-events: none;
        z-index: 2;
        white-space: nowrap;
      }

      .sparkline-axis-label--x {
        bottom: 2px;
        transform: translateX(-50%);
      }

      .sparkline-axis-label--y {
        right: 4px;
        transform: translateY(-50%);
      }
    `}</style>
  );
}
