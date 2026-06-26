// Fast-and-recede animation system.
// Enter: decisive and brief. Exit: fast fade, no drama.
// Spring reserved for tap feedback and live signals only.
// Aligned with CSS tokens: --t-fast 120ms, --t-base 200ms, --t-enter 240ms, --t-exit 160ms

// ── Easing ──────────────────────────────────────────────────────────────────
export const EASE_OUT_QUINT = [0.16, 1, 0.3, 1] as const;

// ── Panel animations ─────────────────────────────────────────────────────────

// Overlay panel switching (AnimatePresence mode="wait") — DashboardCard sp-overlay-panel
export const panelOverlay = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -3 },
  transition: { duration: 0.2, ease: EASE_OUT_QUINT },
} as const;

// KPI detail panel reveal (AnimatePresence mode="wait") — DashboardCard kpi-detail-panel
// height: 0→auto prevents layout jump; overflow hidden clips the reveal cleanly.
export const kpiDetailPanel = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" as const },
  exit: { opacity: 0, height: 0 },
  transition: {
    height: { duration: 0.18, ease: EASE_OUT_QUINT },
    opacity: { duration: 0.12, ease: "linear" },
  },
  style: { overflow: "hidden" as const },
} as const;

// Expand/collapse row height — OpenPositionsPanel, TradeHistoryPanel
export const expandRow = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto" as const, opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.18, ease: EASE_OUT_QUINT },
  style: { overflow: "hidden" as const },
} as const;

// ── Modal / overlay ───────────────────────────────────────────────────────────

// Backdrop fade — ShoutModal, KpiPreviewCard
export const backdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.14 },
} as const;

// Bottom sheet slide up — ShoutModal (spring for native-app feel)
export const bottomSheet = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
  transition: { type: "spring" as const, damping: 32, stiffness: 340, mass: 0.8 },
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
  transition: { type: "spring" as const, stiffness: 700, damping: 32 },
} as const;

// Trade row tap — OpenPositionsPanel, TradeHistoryPanel
export const tapRow = {
  whileTap: { scale: 0.99 },
} as const;

// Gauge / comparison bar tap — PerformanceQualityPanel, PerformanceBars
export const tapGauge = {
  whileTap: { scale: 0.982 },
  transition: { type: "spring" as const, stiffness: 500, damping: 20 },
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

// Open picker container — stagger children in, reverse-stagger out
export const reactionPickerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.045, when: "beforeChildren" as const },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1 as const,
    },
  },
} as const;

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
