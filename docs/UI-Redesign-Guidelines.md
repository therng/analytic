# UI Redesign Guidelines — KPI Chips & Performance Charts

Practical, token-aligned guidelines derived from a live review of the dashboard
(`src/components/trading-monitor/`). Every value below maps to an existing token
in `src/app/globals.css` — do **not** hardcode new colors/radii. Reference
`docs/Analytic Design Tokens (Standalone).html` as the source of truth.

> Scope of the shipped changes: KPI chip strip alignment, comparison‑bar grid
> balance, and a CSS typo fix. Gauges (3‑up) and radar/pie (full‑width) were
> already balanced and were left untouched. Remaining items are documented as
> guidelines, not yet applied.

---

## 1. The core defect: odd item counts in fixed grids

The dashboard repeatedly places **5 items into a 3‑column grid**, which wraps to
an uneven `3 + 2` with a dangling empty cell on the right. This happened in two
places and read as "broken alignment":

| Surface | Before | After |
|---|---|---|
| KPI chips | row 1 `repeat(5,1fr)` with 3 items + row 2 `repeat(3,1fr)` with 2 items → two rows with **mismatched column widths** | single `repeat(5,1fr)` row, all 5 chips equal width and edge‑aligned |
| Comparison bars | 5 bars in `repeat(3,1fr)` → `3 + 2`, last row left‑packed | balanced `repeat(2,1fr)`; the lone trailing bar spans full width |

**Rule of thumb:** a fixed‑column grid only looks intentional when
`itemCount % columns === 0`. For odd counts, either (a) use one equal row, or
(b) let the trailing item span: `grid-column: 1 / -1`.

### KPI chips — applied

`DashboardCard.tsx` — collapse the two‑row split into one strip:

```tsx
// before: const kpiRows = [kpiItems.slice(0,3), kpiItems.slice(3)] … two <div className="kgrid"> rows
// after:
<div className="kpi-stack">
  <div className="kgrid">
    {kpiItems.map((item) => (
      <SummaryChip key={item.key} {...item}
        onClick={item.expandKey ? () => handleChipToggle(item.expandKey) : undefined}
        isSelected={expandedKpi === item.expandKey} />
    ))}
  </div>
</div>
```

`.kgrid` already declares `repeat(5, minmax(0,1fr))` — with 5 children it now
renders one aligned row. `minmax(0,1fr)` (not `1fr`) is essential: it lets cells
shrink below content width so long values ellipsis instead of forcing overflow.
The `.kgrid--subrow` rule is now dead and can be removed.

### Comparison bars — applied (scoped modifier)

`PerformanceBars.tsx` — add a modifier so the shared `.perf-quality-panel`
(also used by gauges & radar) is **not** mutated:

```tsx
<div className="perf-quality-panel perf-quality-panel--bars" role="region" …>
```

```css
.perf-quality-panel--bars {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 10px;
  row-gap: 8px;
  padding: 4px 2px 2px;
}
.perf-quality-panel--bars > .comparison-bar {     /* card treatment → clear separation */
  padding: 6px 10px 7px;
  gap: 5px;
  border-radius: var(--r-sm);
  background: rgba(255, 255, 255, 0.025);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
}
.perf-quality-panel--bars > .comparison-bar:last-child:nth-child(odd) {
  grid-column: 1 / -1;                              /* odd-count tail spans full width */
}
.perf-quality-panel--bars .comparison-bar__title { text-align: left; }
```

---

## 2. Spacing & alignment principles

- **One spacing rhythm.** This codebase uses ad‑hoc px gaps (`2/4/6/8/10/16`).
  Standardize on a 4px base scale: `4 / 8 / 12 / 16`. Use `4px` for intra‑chip
  (label↔value), `8–10px` for inter‑card gaps, `12–16px` for section padding.
  *Optional:* promote to tokens (`--space-1: 4px … --space-4: 16px`) in `:root`.
- **Tabular numerals for all metrics.** Numeric columns must not jitter on
  update. Apply `font-variant-numeric: tabular-nums;` everywhere a value can
  change (`.kv`, `.comparison-bar__value`, gauge readouts). `.comparison-bar__value`
  already has it; `.kv` does not — add it.
- **Left‑align labels with their values.** A centered title above an
  edge‑justified value pair reads as disconnected. Titles now left‑align inside
  bars; keep that convention.
- **Edge alignment over centering** for dense grids — equal columns + shared
  gaps create the "professional" feel far more than decorative centering.
- **`minmax(0, 1fr)` not `1fr`** in every metric grid, so `text-overflow:
  ellipsis` can engage instead of blowing out the row width.

---

## 3. Section separation

Sections currently rely on a single `0.5px` `border-top` on `.kgrid`. For the
expandable performance panels (gauges / bars / radar / pie shown under the chart),
make boundaries explicit and consistent:

```css
/* one shared section header for every expandable chart panel */
.perf-section__title {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.20em;
  text-transform: uppercase;
  color: var(--text-ghost);
  padding: 8px 2px 4px;
}
/* subtle divider between stacked panels (e.g. bars above BotPnL chart) */
.perf-stack > * + * { border-top: 0.5px solid var(--card-border); padding-top: 8px; }
```

Each chart type should sit in its own visually‑bounded block (the card treatment
applied to comparison bars is the reference pattern) so a glance separates
"comparison bars" from "Bot PnL" from "gauges".

---

## 4. Chart‑specific guidelines

These keep the same data & elements — only layout/spacing/balance change.

- **Gauges (`--gauges-row`):** 3 gauges in `repeat(3,1fr)` is already balanced.
  Keep `aspect-ratio: 1/1` dials so they never distort. If a 4th metric is ever
  added, switch to a 2×2 grid rather than `3 + 1`.
- **Comparison bars:** track height `8px` with `border-radius: 3px` is good;
  keep the 1px center gap between segments so 0%/100% splits stay legible.
  Color from semantic tokens only (`--positive` / `--negative` / `--neutral`).
- **Radar & Pie (`--radar-only`):** single child spanning `grid-column: 1 / -1`
  — correct as‑is. Ensure the legend sits centered directly under the figure
  (already does) with `padding-bottom: 2px`.
- **Bot PnL (ApexCharts):** keep the dynamic import (SSR‑unsafe). Constrain the
  canvas height and align the custom legend's left edge to the chart's plot area,
  not the panel edge.
- **Empty/loading parity:** every chart must reserve its final height while
  loading (skeleton) to avoid layout jump — `.account-card__chart-skeleton`
  already does this; reuse it for any new panel.

---

## 5. Pre‑delivery checklist (project‑specific)

- [ ] No fixed‑column grid left with `itemCount % columns !== 0` and no span fallback.
- [ ] All metric grids use `minmax(0, 1fr)`.
- [ ] All changeable numbers use `tabular-nums`.
- [ ] Colors/radii/timings reference tokens — no inline hex, no Tailwind defaults
      (`green-500`, `red-400`).
- [ ] Verified at **375px** and **430px** portrait (no clipped values, no h‑scroll).
- [ ] `npm run build` + `npm run lint` clean (0 errors).
- [ ] Touch targets ≥ 44px; `prefers-reduced-motion` respected (existing
      `useReducedMotion` / `@media` guards).
```
