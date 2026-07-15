# Analytic Trading Dashboard — Design Conventions

## Setup

No provider/context wrapper required for basic rendering. Components are self-contained and receive data via props.

**Required:** Include `TradingMonitorSharedStyles` at the root of any design that uses dashboard components — it injects base CSS classes used across the system:

```jsx
import { TradingMonitorSharedStyles } from "analytic";

function App() {
  return (
    <>
      <TradingMonitorSharedStyles />
      {/* your layout */}
    </>
  );
}
```

**Floor-card components:** `BotPnLPanel`, `DrawdownEquityPanel`, `PiePanel`, `ProfitHeatmapPanel`, `PerformanceRadar`, `SparklineChart` use ApexCharts via `next/dynamic` and render as floor cards in this bundle. They are fully functional in the actual Next.js app. Use `SummaryChip`, `DashboardCard`, `PerformanceBars`, `OpenPositionsPanel`, `TradeHistoryPanel`, `PipsPerformanceTable`, `LoadingScreen`, and `EconomicCalendarList` for designable components.

## Styling Idiom — CSS Custom Properties

All styling uses `var(--token-name)` from `styles.css`. No Tailwind — use these token families:

**Backgrounds**

- `--bg-void` `--bg-base` `--bg-surface` `--bg-elevated` `--bg-panel` `--bg-hover` `--bg-active`

**Text**

- `--text-primary` `--text-secondary` `--text-muted` `--text-ghost`

**Borders**

- `--border-dim` `--border-subtle` `--border-mid` `--border-strong`

**Accent (blue)**

- `--accent-400` `--accent-500` `--accent-600` `--accent-glow` `--accent-line`

**P/L Tones**

- `--positive` `--positive-dim` `--negative` `--negative-dim` `--warning` `--neutral`

**Tone utility classes** (apply to text elements)

- `.tone-positive` `.tone-negative` `.tone-warning` `.tone-neutral` `.tone-muted`

**Radius**

- `--r-xs` (4px) `--r-sm` (8px) `--r-md` (12px) `--r-lg` (16px) `--r-xl` (22px) `--r-2xl` (28px)

**Spacing scale**

- `--sp-1` (4px) through `--sp-10` (32px)

**Typography**

- `--font-display` (Manrope) `--font-body` `--font-mono` `--font-thai` `--font-news` (Bai Jamjuree, for numbers/data)

## Where the Truth Lives

- `styles.css` — root stylesheet (imports `_ds_bundle.css` + fonts); read this before composing layouts
- `_ds_bundle.css` — component-level CSS (imported via styles.css)
- `components/<group>/<Name>/<Name>.prompt.md` — per-component API and usage notes

## Idiomatic Example

```jsx
import {
  SummaryChip,
  TradingMonitorSharedStyles,
  DashboardCard,
} from "analytic";

function TradingKpiRow() {
  return (
    <div
      style={{
        background: "var(--bg-panel)",
        borderRadius: "var(--r-lg)",
        padding: "var(--sp-7)",
      }}
    >
      <TradingMonitorSharedStyles />
      <SummaryChip
        label="Net Gain"
        value="+$1,234"
        tone="positive"
        subLabel="1W"
      />
    </div>
  );
}
```

Layout glue uses `--bg-*`, `--r-*`, and `--sp-*` tokens directly in inline styles or component props. No CSS class names for layout — only the `tone-*` utility classes for text color.
