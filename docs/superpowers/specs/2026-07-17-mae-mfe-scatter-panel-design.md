# MAE/MFE Scatter Panel Design

## Goal

Show aggregate MAE (maximum adverse excursion) vs MFE (maximum favorable
excursion) across a scoped account's closed trades as a scatter chart, so an
operator can see at a glance whether winners ride favorable excursion and
whether losers get stopped near their worst point.

This is independent of the (separately specced, unexecuted) DD quality gauge
relocation — it does not touch `ddSubPanel === "max"` or
`PerformanceQualityPanel.tsx`.

## Data Source

`Position.mae` / `Position.mfe` are already computed per-trade at position
close (`src/lib/trading/position-excursion.ts`): `mae` = minimum sampled
profit during the trade's lifetime (typically ≤ 0), `mfe` = maximum sampled
profit (typically ≥ 0).

`scopedClosedPositions` in `src/lib/trading/preaggregated-cache.ts` (~line
744) already holds these fields in memory — it is built from
`bundle.account.positions`, which selects full Position columns with no
`select` clause. No new Prisma query is needed.

## Backend Change

`src/lib/trading/preaggregated-cache.ts`:

- Replace the stubbed `mfeMae` object (currently always
  `{ available: false, reason, mfe: null, mae: null }`, ~line 938) with real
  data derived from `scopedClosedPositions`:
  - Map each closed position to `{ mae: number | null, mfe: number | null, netPnl: number }`,
    where `netPnl = profit + swap + commission` (per the project's standard
    trade P/L convention).
  - Order by `closeTime` descending and cap to the most recent 500 points.
  - Set `available: false` with a `reason` only when there are zero closed
    positions in scope (mirrors the current empty-state convention).
  - Set `truncated: true` when the cap removed older points, so the UI can
    show a "showing most recent 500 of N trades" note if needed.

`src/lib/trading/types.ts`:

- Update `BalanceDetailResponse["mfeMae"]` to:
  ```ts
  mfeMae:
    | { available: false; reason: string }
    | {
        available: true;
        points: Array<{ mae: number | null; mfe: number | null; netPnl: number }>;
        truncated: boolean;
      };
  ```

No other API contracts, metric formulas, or analytics sources change.

## Frontend Component

New `src/components/trading-monitor/MaeMfePanel.tsx`, structured like the
existing `DrawdownEquityPanel.tsx` (dynamic-imported `react-apexcharts`,
`memo`-wrapped, takes the existing `balanceDetail` resource state prop — no
new API call):

- Chart type: ApexCharts `scatter`. X axis = MAE, Y axis = MFE, one marker per
  trade.
- Marker color by `netPnl` sign, using the existing win/loss tone tokens (no
  new palette): positive netPnl uses the existing "positive" semantic color,
  negative/zero uses the existing "negative" semantic color — same convention
  as `getPnlToneClass` elsewhere in the dashboard.
- Tooltip shows exact MAE, MFE, and net P/L for the hovered trade (matches the
  precision convention: 2-decimal full currency).
- Legend: two entries (Win / Loss) since color carries a second meaning beyond
  position (identity of outcome), consistent with the dataviz skill's "≥2
  series always has a legend" rule.
- Empty state: reuse `InlineState` (`tone="empty"`) when
  `mfeMae.available === false`, matching `DrawdownEquityPanel`'s pattern.
- Loading state: skeleton chart div, matching existing panels.
- No axis reference lines, no trendline — first cut is the raw point cloud.

## Placement

`src/components/trading-monitor/card/DashboardCard.tsx`:

- Add a new `ddSubPanel` value (e.g. `"maefe"`) alongside the existing
  `"dd" | "abs" | "max" | "win" | "expect"` union.
- Add a new `SummaryChip` toggle button next to the existing DD sub-panel
  chips, following the same `isSelected`/`setDdSubPanel` toggle pattern as
  `abs`/`max`/`win`/`expect`.
- Render `<MaeMfePanel balanceDetail={balanceDetail} />` when
  `ddSubPanel === "maefe"`, in the same `sp-overlay-panel` container as the
  other DD sub-panels.
- Does not modify the `"max"` branch or `PerformanceQualityPanel` — that stays
  exactly as-is per the user's explicit choice to skip the (separate,
  unexecuted) gauge-relocation plan.

## Testing

- Add/extend a `preaggregated-cache.test.ts` case: given closed positions with
  known mae/mfe/profit/swap/commission values, `mfeMae.points` matches
  expected `{mae, mfe, netPnl}` tuples, ordering, and the 500-cap +
  `truncated` flag behavior.
- Add a `MaeMfePanel.test.ts` source-contract test (matching the project's
  existing lightweight component test style, e.g. `BotPnLPanel.test.ts`)
  verifying scatter series construction and color-by-sign logic.
- Add a `DashboardCard.test.ts` case verifying the new `"maefe"` sub-panel
  toggles correctly and does not alter the `"max"` branch.

## Verification

```bash
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
node --import tsx --test src/components/trading-monitor/MaeMfePanel.test.ts
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
npx tsc --noEmit
npm run lint
npm run build
```

Verify mobile portrait and landscape (390×844 / 844×390) for the new sub-panel
tab: scatter renders without horizontal overflow, tooltip is reachable by
touch, legend fits the panel width.

## Out of Scope

- The DD → MAX gauge relocation plan (`2026-07-17-dd-quality-gauges-relocation-design.md`)
  — unrelated, unexecuted, untouched by this change.
- Trendline, regression line, or R-multiple annotations on the scatter — raw
  point cloud only for this first cut.
- Cross-account or cross-timeframe aggregation — scope is the single account +
  timeframe already selected on the card, same as every other DD sub-panel.
