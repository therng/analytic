# Design Review: PerformanceQualityPanel.tsx

**Reviewed:** 2026-07-02
**Target:** `src/components/trading-monitor/PerformanceQualityPanel.tsx`
**Focus:** Comprehensive (visual, usability, code quality) — operational trading dashboard, mobile-first

## Summary

Solid, well-structured component: consistent gauge/comparison-bar abstraction, good null/infinity handling, and proper `useKpiHint` reuse for tap-to-reveal definitions. The main issue is design-token drift — chart/gauge colors are hardcoded hex instead of referencing the CSS custom properties already defined in `globals.css`, which is a direct violation of the project's "reference tokens, don't copy values inline" rule.

**Issues Found:** 5

- Critical: 0
- Major: 2
- Minor: 2
- Suggestions: 1

## Major Issues

### Issue 1: Hardcoded hex colors duplicate design tokens instead of referencing them

**Severity:** Major
**Location:** `PerformanceQualityPanel.tsx:63, 593, 689, 694-695`
**Category:** Code quality / Design system compliance

**Problem:**
`ZONE_COLORS` and `RADAR_SERIES_COLORS` hardcode `#f04d4d`, `#3dd68c`, `#4da8f5` — these are *exactly* `--negative`, `--positive`, `--neutral` as defined in `globals.css:40-49` and `MASTER.md`. `#08131f` (stroke color at line 695) also duplicates a surface token. `MASTER.md` is documented as the single source of truth and CLAUDE.md explicitly says: "Do not copy token values inline; reference the document instead."

**Impact:**
If the token palette changes (e.g. dark-mode retune, accent rebrand), these values silently drift out of sync with the rest of the UI. Since ApexCharts options are plain JS (not CSS), they can't use `var(--positive)` directly in the `colors` array the way the SVG gauge segments do — but they *can* read `getComputedStyle` once, or the token hex could be centralized in a single exported constant so there's one place to update instead of four.

**Recommendation:**
Add a small `TOKEN_COLORS` constant (or import from a shared chart-token module) that maps to `--positive`/`--negative`/`--neutral`/surface values, and reference it everywhere instead of re-typing hex literals. At minimum, add a comment tying each hardcoded hex back to its token name so future edits don't miss one.

```tsx
// Before
const ZONE_COLORS = ["#f04d4d", "#facc15", "#3dd68c", "#4da8f5"] as const;

// After
const ZONE_COLORS = [
  "var(--negative)",  // #f04d4d — poor
  "#facc15",           // fair — no token yet, see Issue 2
  "var(--positive)",  // #3dd68c — good
  "var(--neutral)",   // #4da8f5 — great
] as const;
```
Note: `var(--x)` works fine as an SVG `stroke`/`fill` attribute value, so the gauge arcs (lines 416, 445) can use tokens directly. The ApexCharts radar (lines 674, 684, 689, 694-695) needs literal hex since it's a JS options object — keep those centralized and commented.

---

### Issue 2: "fair" zone color (`#facc15`, yellow) has no corresponding design token

**Severity:** Major
**Location:** `PerformanceQualityPanel.tsx:63`
**Category:** Design system compliance

**Problem:**
`ZONE_COLORS[1] = "#facc15"` is used for the "fair"/"พอใช้" zone across all three gauges (Sharpe, Profit Factor, Recovery). This color doesn't appear anywhere in `globals.css` custom properties or `MASTER.md`'s documented palette — it's a one-off Tailwind-style yellow (`yellow-400`), which CLAUDE.md explicitly warns against ("Avoid Tailwind color defaults... use semantic tokens").

**Impact:**
A 4-tone semantic scale (poor/fair/good/great) is a reusable pattern likely needed elsewhere (e.g. other quality/health indicators), but right now it only half-exists as a token system — 3 of 4 tones are real tokens, 1 is a magic value that won't survive a future re-theme.

**Recommendation:**
Add a `--warning` or `--fair` token to `globals.css`/`MASTER.md` (e.g. `#facc15` or a value tuned to sit visually between `--negative` and `--positive`), then reference it here. This also benefits any future "warning" state elsewhere in the dashboard.

## Minor Issues

### Issue 3: `ProfitabilityBar` always registers a hint even with the same boilerplate as `hintable` variants elsewhere

**Severity:** Minor
**Location:** `PerformanceQualityPanel.tsx:481, 491`
**Category:** Code quality

**Problem:**
`ProfitabilityBar` calls `useKpiHint(true)` unconditionally and always renders with `tapGauge` + all touch handlers, whereas `QualityGauge` and `ComparisonBar` guard this behind `Boolean(hint)`. This is consistent behavior-wise (Profitability always has a hint), but the six touch-handler props (`handleTouchStart/Move/Cancel/End`) plus `wrapClick()` are repeated verbatim across `QualityGauge`, `ProfitabilityBar`, and `ComparisonBar` (lines 342-353, 477-491, 526-536) with no shared wrapper component.

**Impact:**
Three near-identical blocks of hint-wiring boilerplate increase the surface area for a future bug (e.g. forgetting `handleTouchCancel` in a fourth variant) and make the component harder to skim.

**Recommendation:**
Consider a small `useHintableCard(hint)` → returns `{ motionProps, containerRef, sheet }` wrapper, or a `<HintableCard>` wrapper component that all three consume. Not urgent — three call sites is tolerable, but a fourth would tip this into "extract it" territory.

### Issue 4: `PerformanceRadarChart`'s `RADAR_BENCHMARK` comment doesn't match all six values

**Severity:** Minor
**Location:** `PerformanceQualityPanel.tsx:589-592`
**Category:** Code quality (comment accuracy)

**Problem:**
The comment above `RADAR_BENCHMARK` explains the derivation for PF (38), RF (43), and AVG P/L (50), but the array has 6 entries: `[40, 38, 43, 50, 50, 50]` for `[SHARPE, PF, RECOVERY, WIN%, AVG P/L, STREAK]`. The comment doesn't explain where `40` (Sharpe benchmark), the second `50` (WIN%), or the third `50` (STREAK) come from.

**Impact:**
Minor — a future editor tuning one benchmark value won't know if the other three were arbitrary or deliberately chosen, risking an inconsistent edit.

**Recommendation:**
Either complete the comment for all six values, or drop the derivation comment in favor of naming them via an object (`{ sharpe: 40, pf: 38, recovery: 43, winPct: 50, avgPL: 50, streak: 50 }`) so the array itself is self-documenting.

## Suggestions

### Suggestion 1: `pickZone`'s off-by-one on exact `limit` boundary is easy to misread

**Location:** `PerformanceQualityPanel.tsx:335-340`

`pickZone` uses `value <= zone.limit`, meaning a Sharpe of exactly `0.5` lands in "poor" (not "fair"), and `2.0` lands in "fair" (not "good"). This is likely intentional (thresholds are upper-bounds), but there's no comment stating the boundary is inclusive-low. A one-line comment would save the next person a debugging session when a value sits exactly on a zone edge.

## Positive Observations

- Clean separation of pure data-shaping functions (`buildAverageProfitLossBar`, `buildLongShortTradeBar`, etc.) from render components — easy to unit test in isolation.
- Consistent, careful null/undefined/infinity handling throughout (`isFiniteNumber`, `toFiniteOrNull`, `isPositiveInfinity` handling in `QualityGauge`) — matches the "zero-as-empty" and financial-precision discipline called out in CLAUDE.md.
- Good accessibility baseline: every visual gauge/bar has a computed `aria-label` with real values, not just a decorative `role="img"`.
- `variant` prop (`"full" | "radar" | "gauges"`) cleanly supports reuse in different card layouts without prop-drilling separate components.
- ApexCharts `dynamic(..., { ssr: false })` correctly avoids the known SSR-unsafe import per project convention.
- The radar chart's `plotOptions.radar.size: 70` comment explaining the ApexCharts v5 NaN-coordinate workaround is exactly the kind of "why, not what" comment CLAUDE.md asks for.

## Next Steps

1. Centralize the three positive/negative/neutral hex duplicates into token references (Issue 1) — low-risk, mechanical fix.
2. Decide on and add a `--warning`/`--fair` token for the yellow zone color (Issue 2), then wire it in alongside Issue 1.
3. Optional: extract the repeated hint-wiring boilerplate into a shared hook/wrapper if a fourth hintable variant appears (Issue 3).

---

_Generated by UI Design Review. Run `/ui-design:design-review` again after fixes._
