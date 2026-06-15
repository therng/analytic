// Single source of truth for all framer-motion animation variants and gesture props.
// Import from here instead of defining inline.

// ── Easing ──────────────────────────────────────────────────────────────────
export const EASE_OUT_QUINT = [0.16, 1, 0.3, 1] as const;

// ── Panel animations ─────────────────────────────────────────────────────────

// Overlay panel switching (AnimatePresence mode="wait") — DashboardCard sp-overlay-panel
export const panelOverlay = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 1.02, y: -4 },
  transition: { duration: 0.22, ease: EASE_OUT_QUINT },
} as const;

// KPI detail panel slide-down (AnimatePresence) — DashboardCard kpi-detail-panel
export const kpiDetailPanel = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.2, ease: EASE_OUT_QUINT },
} as const;

// Expand/collapse row height — OpenPositionsPanel, TradeHistoryPanel
export const expandRow = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto" as const, opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.2, ease: EASE_OUT_QUINT },
  style: { overflow: "hidden" as const },
} as const;

// ── Modal / overlay ───────────────────────────────────────────────────────────

// Backdrop fade — ShoutModal, KpiPreviewCard
export const backdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.16 },
} as const;

// Bottom sheet slide up — ShoutModal
export const bottomSheet = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
  transition: { type: "spring" as const, damping: 28, stiffness: 300 },
} as const;

// KPI preview card content — SummaryChip KpiPreviewCard
// Pass reduceMotion from useReducedMotion() to get the right variant set.
export const kpiCardBackdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const;

export const kpiCardTransition = { duration: 0.22, ease: EASE_OUT_QUINT } as const;

export function kpiCardVariants(reduceMotion: boolean) {
  return reduceMotion
    ? ({ hidden: { opacity: 0 }, visible: { opacity: 1 } } as const)
    : ({ hidden: { opacity: 0, scale: 0.93, y: 4 }, visible: { opacity: 1, scale: 1, y: 0 } } as const);
}

// ── Table / list ──────────────────────────────────────────────────────────────

// Staggered row enter — PipsPerformanceTable
export function tableRowMotion(index: number) {
  return {
    initial: { opacity: 0, x: -4 },
    animate: { opacity: 1, x: 0 },
    transition: { delay: index * 0.05, duration: 0.2, ease: "easeOut" as const },
    whileHover: { backgroundColor: "rgba(255, 255, 255, 0.03)" },
  };
}

// ── Gesture / tap feedback ────────────────────────────────────────────────────

// KPI chip tap — SummaryChip
export const tapChip = {
  whileTap: { scale: 0.96 },
  transition: { type: "spring" as const, stiffness: 400, damping: 17 },
} as const;

// Timeframe pill tap — shared TimeframeStrip
export const tapPill = {
  whileTap: { scale: 0.88 },
  transition: { type: "spring" as const, stiffness: 600, damping: 30 },
} as const;

// Trade row tap — OpenPositionsPanel, TradeHistoryPanel
export const tapRow = {
  whileTap: { scale: 0.99 },
} as const;

// Gauge / comparison bar tap — PerformanceQualityPanel, PerformanceBars
export const tapGauge = {
  whileTap: { scale: 0.985 },
  transition: { type: "spring" as const, stiffness: 400, damping: 17 },
} as const;

// Heatmap cell hover + tap — ProfitHeatmapPanel
export const heatmapCell = {
  whileHover: { scale: 1.15, zIndex: 1 },
  whileTap: { scale: 0.9 },
  transition: { type: "spring" as const, stiffness: 400, damping: 17 },
} as const;

// Heatmap "today" cell — complex transition with infinite pulse + spring tap
export const heatmapTodayTransition = {
  boxShadow: { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const },
  scale: { type: "spring" as const, stiffness: 400, damping: 17 },
} as const;
