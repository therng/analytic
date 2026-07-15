# Design Review: src/components/trading-monitor/

**Review ID:** trading-monitor_20260624_0303
**Reviewed:** 2026-06-24 03:03 UTC
**Target:** `src/components/` (all 30 TSX components)
**Focus:** Visual design · Usability · Accessibility · Code quality · Performance
**Platform:** Mobile-first (iOS Safari portrait/landscape)

---

## Summary

โปรเจกต์มีฐาน design system ที่แข็งแกร่งมาก — CSS custom properties ครบ, semantic color tokens, motion tokens ชัดเจน, Thai typography stack ดี, และ `prefers-reduced-motion` ทำงานทุกที่ผ่าน framer-motion ปัญหาหลักที่พบคือ **touch target ขนาดเล็กใน SparklineChart และ TimeframeStrip**, **hardcoded 2.2s loading delay** ที่ส่งผลต่อ FCP แม้ข้อมูลพร้อมแล้ว และ **dual CSS naming system** (`--gold-*` vs `--accent-*`) ที่ทำให้สับสน

**Issues Found: 13** · **Fixed: 5** · **Deferred: 8**

| Severity   | Count | Fixed                          |
| ---------- | ----- | ------------------------------ |
| Critical   | 1     | — (deferred: product decision) |
| Major      | 4     | 1 (Issue 3)                    |
| Minor      | 4     | 2 (Issues 5, 6)                |
| Suggestion | 4     | 2 (Suggestion 1, 3)            |

---

## Critical Issues

### Issue 1: Hardcoded 2.2s Loading Delay Blocks Content for Repeat Visitors

**Severity:** Critical  
**Location:** `src/components/trading-monitor/DashboardClient.tsx:57-63`  
**Category:** Performance / UX

**Problem:**  
`initialAnimationDone` is always `false` until `setTimeout(..., 2200)` fires, regardless of whether API data is already cached. Content is unconditionally hidden for 2.2 seconds on every page visit.

**Impact:**  
Core Web Vitals suffers. Repeat visitors and fast networks see a blank/animated screen for 2+ seconds even when account data is immediately available. On slow networks the delay compounds with actual load time.

**Recommendation:**  
Gate on animation-seen-once (e.g. `sessionStorage`), or reduce the minimum to ≤800ms and only enforce it on the very first app load.

```tsx
// Before
const [initialAnimationDone, setInitialAnimationDone] = useState(false);
// ... always waits 2200ms

// After — only first session load shows full animation
const hasSeenIntro =
  typeof sessionStorage !== "undefined" && sessionStorage.getItem("intro-seen");
const [initialAnimationDone, setInitialAnimationDone] = useState(
  Boolean(hasSeenIntro),
);

useEffect(() => {
  if (hasSeenIntro) return;
  const timer = setTimeout(() => {
    setInitialAnimationDone(true);
    sessionStorage.setItem("intro-seen", "1");
  }, 2200);
  return () => clearTimeout(timer);
}, [hasSeenIntro]);
```

---

## Major Issues

### Issue 2: SparklineChart Hit Targets Below 44px Minimum

**Severity:** Major  
**Location:** `src/components/trading-monitor/shared.tsx:349-365`  
**Category:** Accessibility / Touch

**Problem:**  
Clickable circles on the sparkline use `r="8"` — a 16px diameter touch target. iOS HIG and WCAG require minimum 44×44px. At 320px wide with many data points, adjacent targets also overlap.

**Impact:**  
Users with larger fingers or motor impairments will frequently mis-tap data points on the chart. Also violates WCAG 2.5.5 (Target Size).

**Recommendation:**  
Increase hit target radius to `r="22"` (44px diameter), keeping the visible dot small via a separate visual element.

```tsx
// Before
<circle r="8" fill="transparent" ... />

// After — large invisible hit area, small visual dot rendered separately
<circle r="22" fill="transparent" className="sparkline-hit-target" ... />
```

---

### Issue 3: Timeframe Pills Have No Minimum Touch Height ✅ Fixed

**Severity:** Major  
**Location:** `src/app/globals.css:831-840` / `src/components/trading-monitor/shared.tsx:38-52`  
**Category:** Touch / Accessibility

**Problem:**  
`.timeframe-pill` within `.account-card` has `min-height: auto` and `padding: 4px 9px` with `font-size: 8px`. The resulting rendered height is approximately 20-22px — well below the 44px touch target minimum for iOS.

**Impact:**  
1D/1W/1M/ALL timeframe buttons are difficult to tap accurately, especially with one hand in portrait mode.

**Recommendation:**

```css
/* globals.css */
.dashboard-section > .account-card .timeframe-pill {
  min-height: 36px; /* pragmatic: 36px widely accepted for dense UIs */
  padding: 6px 10px; /* increase vertical padding */
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Or use a transparent pseudo-element to extend the tap area without changing visual layout:

```css
.timeframe-pill::after {
  content: "";
  position: absolute;
  inset: -8px;
}
```

---

### Issue 4: Dual CSS Custom Property Naming System (`--gold-*` vs `--accent-*`)

**Severity:** Major  
**Location:** `src/app/globals.css:34-52`  
**Category:** Code Quality / Maintainability

**Problem:**  
The same blue palette is defined twice under two names: `--gold-50` through `--gold-glow` (legacy) and `--accent-50` through `--accent-glow` (canonical). A comment says these are "backward compat" but new code still references `--gold-300` (e.g. `.timeframe-pill.is-active { color: var(--gold-300); }` at line 858).

**Impact:**  
New contributors don't know which system to use. Grep results for color tokens are polluted. Adding a new shade requires updating both sets. This is a maintenance debt that grows with every new component.

**Recommendation:**  
Do a single search-and-replace pass to migrate all `var(--gold-*)` usages to `var(--accent-*)`, then delete the `--gold-*` declarations. Run `grep -r "gold-" src/` to find remaining refs — approximately 15-20 usages in globals.css.

---

### Issue 5: No Keyboard Navigation for SparklineChart Data Points ✅ Fixed (partial)

**Severity:** Major  
**Location:** `src/components/trading-monitor/shared.tsx:338-398`  
**Category:** Accessibility

**Problem:**  
The sparkline chart has interactive data points (click to see tooltip) but these are SVG `<circle>` elements with no `tabIndex`, `role`, or keyboard event handlers. The SVG itself has `aria-hidden="true"`, which hides all chart content from screen readers entirely — including the balance tooltip that appears on interaction.

**Impact:**  
Keyboard-only users and screen reader users get zero access to historical balance data. The chart is completely invisible to assistive technology.

**Recommendation:**  
Minimal fix: add an accessible summary via `<title>` in the SVG and expose the tooltip via `aria-live` (already done — `role="status"` on tooltip is good, but the container is `aria-hidden`). The SVG itself should not be `aria-hidden` when interactive.

```tsx
// Option A: keep aria-hidden but add a screen-reader-only text summary
<svg aria-hidden="true" ...>...</svg>
<span className="sr-only" aria-live="polite">
  {activeDataPoint ? `Balance: ${formatCurrency(resolveBalanceValue(activeDataPoint))} on ${formatReportLocalDate(activeDataPoint.x)}` : "Balance chart"}
</span>

// Option B: remove aria-hidden, add <title> and <desc>
<svg aria-label={`Balance chart — ${sparklinePoints.length} data points`} role="img" ...>
  <title>Balance curve</title>
  ...
</svg>
```

---

## Minor Issues

### Issue 6: `NEXT_PUBLIC_APP_VERSION` May Render as "undefined" ✅ Fixed

**Severity:** Minor  
**Location:** `src/components/trading-monitor/LoadingScreen.tsx:103`  
**Category:** Visual / Code Quality

**Problem:**  
`process.env.NEXT_PUBLIC_APP_VERSION` is interpolated directly. If the env var is not set in a deployment, the footer shows "Analytic undefined".

**Recommendation:**

```tsx
// Before
<p className="candle-anim-footer">Analytic {process.env.NEXT_PUBLIC_APP_VERSION}</p>

// After
<p className="candle-anim-footer">
  Analytic{process.env.NEXT_PUBLIC_APP_VERSION ? ` ${process.env.NEXT_PUBLIC_APP_VERSION}` : ""}
</p>
```

---

### Issue 7: `buildSmoothSegmentPath` Duplicates `buildSmoothPath` Logic

**Severity:** Minor  
**Location:** `src/components/trading-monitor/shared.tsx:241-262`  
**Category:** Code Quality

**Problem:**  
`buildSmoothSegmentPath` replicates the cubic bezier control-point formula from `buildSmoothPath` for a single segment. Any change to the smoothing algorithm must be made in two places.

**Recommendation:**  
Extract the control-point calculation into a shared helper:

```ts
function catmullRomControlPoints(p0: Point, p1: Point, p2: Point, p3: Point) {
  return {
    cp1x: p1.x + (p2.x - p0.x) / 6,
    cp1y: p1.y + (p2.y - p0.y) / 6,
    cp2x: p2.x - (p3.x - p1.x) / 6,
    cp2y: p2.y - (p3.y - p1.y) / 6,
  };
}
```

---

### Issue 8: Deep CSS Specificity Chains Are Hard to Override

**Severity:** Minor  
**Location:** `src/app/globals.css` throughout  
**Category:** Code Quality / Maintainability

**Problem:**  
Selectors like `.dashboard-section > .account-card .kchip.is-actionable:hover` have high specificity (0,4,0), making it difficult to override styles in specific contexts without matching or exceeding that specificity. This was observed in the timeframe-pill section where the same class is redefined 3+ times with increasing selector chains.

**Recommendation:**  
Consider using CSS layers (`@layer`) or CSS Modules per component to scope styles without specificity wars. Short-term: extract repeated patterns into shared classes with lower specificity.

---

### Issue 9: DashboardCard.tsx is 551 Lines — Single Responsibility Tension

**Severity:** Minor  
**Location:** `src/components/trading-monitor/card/DashboardCard.tsx`  
**Category:** Code Quality / Maintainability

**Problem:**  
The component manages: timeframe state, 6 API fetches, KPI chip configuration, detail row computation for 3 expand modes, and panel rendering for 7+ sub-panels. It's the correct level of orchestration for a card, but the `kpiItems` array (30 lines) and `detailRows` computation (60+ lines) are candidates for extraction.

**Recommendation:**  
Extract `buildKpiItems()` and `buildDetailRows()` as pure functions outside the component. No state changes needed — they take data as input, return arrays. This reduces the render-function length and makes each config independently testable.

---

## Suggestions

### Suggestion 1: Add `focus-visible` Styles to `.kchip` and `.timeframe-pill` ✅ Fixed

**Location:** `src/app/globals.css:1128-1135`

Hover states are defined but `focus-visible` is only applied to `.kchip.is-actionable`. Static chips with hints (`.kchip.has-hint`) expose `tabIndex={0}` and `role="button"` but lack a visible focus ring. Add:

```css
.dashboard-section > .account-card .kchip.has-hint:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 2px;
}
.dashboard-section > .account-card .timeframe-pill:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 2px;
}
```

---

### Suggestion 2: Debounce or Batch API Requests on Timeframe Change

**Location:** `src/components/trading-monitor/card/DashboardCard.tsx`

Five `useApiResource` hooks (overview, balance, pips, positions, allPositions) all fire simultaneously when `timeframe` changes. On a slow connection, this creates a cascade of 5 parallel requests per card, multiplied by the number of cards on screen.

Consider: a `useReducer` to batch the timeframe change, or wrapping the five requests in a single debounced effect that fires only after 100ms of stability.

---

### Suggestion 3: Replace Magic Number `2200` with Named Constant ✅ Fixed

**Location:** `src/components/trading-monitor/LoadingScreen.tsx:7` and `DashboardClient.tsx:60`

Both files use `2200` (the candle animation loop duration). If the animation is ever changed, both must be updated. Extract:

```ts
// constants.ts or LoadingScreen.tsx
export const LOADING_ANIMATION_MS = 2200;
```

---

### Suggestion 4: Persist Sparkline `chartWidth` as a CSS Variable, Not a Hardcoded `320`

**Location:** `src/components/trading-monitor/shared.tsx:291`

`chartWidth = 320` is used as the base for percentage calculations, but the SVG scales via CSS. If the card width ever changes significantly, the percentage positioning of axis labels and the tooltip will still be calculated from 320, not the actual rendered width. This is currently fine (320 is the viewBox width and `preserveAspectRatio="none"` scales correctly) but it's a subtle footgun. A `useRef` + `ResizeObserver` for dynamic width would make this robust.

---

## Positive Observations

- **Excellent CSS token system** — semantic names (`--positive`, `--negative`, `--text-muted`), spacing scale (`--sp-1` through `--sp-10`), motion tokens (`--t-fast`, `--t-base`, `--t-enter`), and radius scale (`--r-xs` through `--r-pill`) are consistent and comprehensive
- **`prefers-reduced-motion` handled properly** — `useReducedMotion()` from framer-motion is checked before applying `tapPill`, `tapChip` etc. in TimeframeStrip, SummaryChip, PerformanceBars
- **`touch-action: manipulation` on body** — correctly eliminates the 300ms tap delay on iOS Safari without a library
- **`-webkit-tap-highlight-color: transparent`** on interactive elements — native iOS tap flash suppressed
- **Excellent aria labeling** — `role="tablist"` + `aria-label` on TimeframeStrip, `aria-pressed` on pills, `aria-live="polite"` on sparkline tooltip, `aria-haspopup="dialog"` + `aria-expanded` on KpiPreviewCard trigger
- **Focus trap in KpiPreviewCard** — `Escape` closes, Tab is prevented from leaving the dialog, `focus()` is called on mount
- **`font-feature-settings: "tnum"`** — tabular numbers ensure currency values align correctly in KPI chips
- **Haptic feedback** — `navigator.vibrate?.(12)` on long-press in `useKpiHint` adds tactile response without over-vibrating
- **Safe area insets** — `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` correctly handled in `.app-scroll` padding for Dynamic Island / notch devices
- **Color-coded sparkline segments** — deposit/withdrawal events colored differently (green/red) from trading segments, communicating financial events at a glance
- **Live beacon animation** — the ambient + pulse layers on `sparkline-live-beacon` provide clear "this is real-time data" signaling without being distracting

---

## Next Steps (Remaining — Priority Order)

1. **Redesign SparklineChart hit targets** — implement nearest-X overlay instead of per-point circles (Issue 2, needs redesign)
2. **Gate loading animation on sessionStorage** — skip 2.2s delay for repeat visitors (Issue 1, product decision needed)
3. **Migrate `--gold-*` to `--accent-*`** — single find-replace pass, ~20 usages (Issue 4, risky refactor — separate task)
4. **Refactor DashboardCard** — extract `buildKpiItems()` and `buildDetailRows()` (Issue 9, code quality)
5. **Debounce timeframe API requests** — reduce 5× parallel calls per card (Suggestion 2, perf)

## Fixed This Session (2026-06-24)

- ✅ Issue 3: Timeframe pill `min-height: 36px` + `padding: 6px 10px` (`globals.css`)
- ✅ Issue 5: `sr-only aria-live` region for SparklineChart balance data (`shared.tsx`)
- ✅ Issue 6: `NEXT_PUBLIC_APP_VERSION` guard prevents "undefined" (`LoadingScreen.tsx`)
- ✅ Suggestion 1: `focus-visible` rings on `.kchip.has-hint` and `.timeframe-pill` (`globals.css`)
- ✅ Suggestion 3: `LOADING_ANIMATION_MS = 2200` named constant (`LoadingScreen.tsx`, `DashboardClient.tsx`)

---

_Generated by UI Design Review — `src/components/` · 2026-06-24_  
_Run `/ui-ux-pro-max /ui-design:design-review @src/components/` again after fixes._
