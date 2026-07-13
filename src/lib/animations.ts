// Fast-and-recede animation system.
// Enter: decisive and brief. Exit: fast fade, no drama.
// Spring reserved for tap feedback and live signals only.
// Aligned with CSS tokens: --t-fast 120ms, --t-base 200ms, --t-enter 240ms, --t-exit 160ms

// ── Easing ──────────────────────────────────────────────────────────────────
export const EASE_OUT_QUINT = [0.16, 1, 0.3, 1] as const;

// ── Panel animations ─────────────────────────────────────────────────────────

// Expand/collapse row height — OpenPositionsPanel, TradeHistoryPanel
export const expandRow = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto" as const, opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.18, ease: EASE_OUT_QUINT },
  style: { overflow: "hidden" as const },
} as const;

// KPI preview card content — SummaryChip KpiPreviewCard
// Pass reduceMotion from useReducedMotion() to get the right variant set.
export const kpiCardBackdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const;

export const kpiCardTransition = { duration: 0.18, ease: EASE_OUT_QUINT } as const;

export function kpiCardVariants(reduceMotion: boolean) {
  return reduceMotion
    ? ({ hidden: { opacity: 0 }, visible: { opacity: 1 } } as const)
    : ({ hidden: { opacity: 0, scale: 0.96, y: 3 }, visible: { opacity: 1, scale: 1, y: 0 } } as const);
}

// ── Table / list ──────────────────────────────────────────────────────────────

// Staggered row enter — PipsPerformanceTable
export function tableRowMotion(index: number) {
  return {
    initial: { opacity: 0, x: -3 },
    animate: { opacity: 1, x: 0 },
    transition: { delay: index * 0.03, duration: 0.15, ease: "easeOut" as const },
    whileHover: { backgroundColor: "rgba(255, 255, 255, 0.03)" },
  };
}

// ── Gesture / tap feedback (spring only) ─────────────────────────────────────

// KPI chip tap — SummaryChip
export const tapChip = {
  whileTap: { scale: 0.94 },
  transition: { type: "spring" as const, stiffness: 500, damping: 20 },
} as const;

// Timeframe pill tap — shared TimeframeStrip
export const tapPill = {
  whileTap: { scale: 0.86 },
  transition: { type: "spring",stiffness: 300,damping: 26, mass: 1 },
} as const;

// Trade row tap — OpenPositionsPanel, TradeHistoryPanel
export const tapRow = {
  whileTap: { scale: 0.99 },
} as const;

// Gauge / comparison bar tap — PerformanceQualityPanel, PerformanceBars
export const tapGauge = {
  whileTap: { scale: 0.982 },
  transition: { type: "spring",stiffness: 300,damping: 26, mass: 1 },
} as const;

// Heatmap cell hover + tap — ProfitHeatmapPanel
export const heatmapCell = {
  whileHover: { scale: 1.18, zIndex: 1 },
  whileTap: { scale: 0.88 },
  transition: { type: "spring" as const, stiffness: 500, damping: 20 },
} as const;

// Heatmap "today" cell — amber breathing ring + spring tap
export const heatmapTodayTransition = {
  boxShadow: { duration: 2.8, repeat: Infinity, ease: "easeInOut" as const },
  scale: { type: "spring" as const, stiffness: 500, damping: 20 },
} as const;

// ── Sparkline reactions ───────────────────────────────────────────────────────

// Individual emoji button — spring pop-in, quick pop-out
// Pass reduceMotion to get accessible variant set.
export function reactionBtnVariants(reduceMotion: boolean) {
  return reduceMotion
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.1 } },
        exit: { opacity: 0, transition: { duration: 0.08 } },
      }
    : {
        hidden: { scale: 0.52, opacity: 0, y: 5 },
        show: {
          scale: 1,
          opacity: 1,
          y: 0,
          transition: { type: "spring" as const, stiffness: 480, damping: 22 },
        },
        exit: {
          scale: 0.62,
          opacity: 0,
          y: 3,
          transition: { duration: 0.09 },
        },
      };
}

// Collapsed badge strip — simple opacity fade
export const reactionCollapsedVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 },
} as const;

// Reaction picker portal entrance — SparklineReactionRow
export const pickerPortal = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: 0.14 },
} as const;

// Chain badge entrance (collapsed state when votes exist)
export const reactionBadgeVariants = {
  hidden: { scale: 0.75, opacity: 0 },
  show: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 420, damping: 24 },
  },
  exit: { scale: 0.5, opacity: 0, transition: { duration: 0.08 } },
} as const;

// ── Bot P/L bottom sheet ──────────────────────────────────────────────────────

const EASE_CRISP = [0.16, 1, 0.3, 1] as const;

// Header card: container orchestrates stagger of children
export const botSheetCardVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } },
} as const;

// Bot image: scale-up from slightly smaller
export const botSheetImgVariants = {
  hidden: { opacity: 0, scale: 0.84 },
  visible: { opacity: 1, scale: 1, transition: { type: "spring" as const, damping: 20, stiffness: 380, mass: 0.65 } },
} as const;

// Name / stars / price rows: slide in from left
export const botSheetLineVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.18, ease: EASE_CRISP } },
} as const;

// Count badge: spring pop
export const botSheetCountVariants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: { opacity: 1, scale: 1, transition: { type: "spring" as const, damping: 14, stiffness: 460 } },
} as const;

// Trade list: stagger rows after card settles
export const botSheetListVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.02, delayChildren: 0.22 } },
} as const;

// Individual trade row
export const botSheetRowVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.13, ease: "easeOut" as const } },
} as const;

// Bar-tap artwork preview popup — BotPnLPanel
export const botArtworkPreviewVariants = {
  initial: { scale: 0.5, opacity: 0, y: 4 },
  animate: { scale: 1, opacity: 1, y: 0 },
  exit: { scale: 0.5, opacity: 0, y: 4 },
  transition: { type: "spring" as const, damping: 22, stiffness: 420, mass: 0.7 },
} as const;
