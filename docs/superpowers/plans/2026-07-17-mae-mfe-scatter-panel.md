# MAE/MFE Scatter Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement task-by-task.

**Goal:** Add a timeframe-scoped MAE-versus-MFE scatter panel as a new DD sub-panel.

**Architecture:** The existing balance-detail request serializes up to 500 recent closed trades from `Position.mae` and `Position.mfe`. A dynamically imported ApexCharts panel consumes that resource and splits points into Win and Loss series using `profit + swap + commission`; no new query or endpoint is introduced.

**Tech Stack:** Next.js 16, React 19, TypeScript, ApexCharts, Node test runner, CSS in `src/app/globals.css`.

## Global Constraints

- Preserve the current DD → MAX branch and `PerformanceQualityPanel` behavior.
- Do not implement or modify the separate DD-quality-gauge relocation design.
- Do not add a Prisma migration, query, endpoint, worker change, trendline, regression line, or reference line.
- Scope points to the selected account and timeframe through the existing balance-detail resource.
- Keep null MAE/MFE values in the API payload, but plot only trades with both finite coordinates.
- Cap the response at the 500 most recently closed positions and identify truncation honestly without adding an unapproved total field.
- Use the existing semantic win/loss colors and full-currency formatting conventions.
- Preserve portrait and landscape dashboard behavior without horizontal panning.

---

## Interfaces and Defaults

Replace `BalanceDetailResponse["mfeMae"]` with:

```ts
mfeMae:
  | { available: false; reason: string }
  | {
      available: true;
      points: Array<{
        mae: number | null;
        mfe: number | null;
        netPnl: number;
      }>;
      truncated: boolean;
    };
```

Add the internal helper:

```ts
buildMfeMaeDetail(
  closedPositions: PositionRow[],
): BalanceDetailResponse["mfeMae"]
```

Use these UI defaults:

- DD state key: `"maeMfe"`, placed after `"expect"` in `DD_SUB_CYCLE`.
- Chip label: `MAE/MFE`; value: scoped closed-trade count or `500+`; meta: `Closed trades`.
- A trade is a Win only when `netPnl > 0`; negative and zero outcomes belong to Loss.
- If closed trades exist but no row has both coordinates, show an inline no-samples state.
- When truncated, show `Showing latest 500 trades` rather than claiming an unknown total.

---

### Task 1: Build the Scoped Balance-Detail Payload

**Files:**

- Modify: `src/lib/trading/types.ts`
- Modify: `src/lib/trading/preaggregated-cache.ts`
- Test: `src/lib/trading/preaggregated-cache.test.ts`

**Interfaces:**

- Consumes: timeframe-filtered `scopedClosedPositions` with persisted `mae`, `mfe`, `profit`, `swap`, `commission`, and `closeTime` fields.
- Produces: `buildMfeMaeDetail(closedPositions): BalanceDetailResponse["mfeMae"]`.

- [ ] **Step 1: Add failing payload tests**

Extend `preaggregated-cache.test.ts` with three cases:

1. Empty input returns `{ available: false, reason: "No closed trades in the selected timeframe." }`.
2. Known positions prove newest-first ordering, null preservation, and `netPnl = profit + swap + commission`.
3. 502 positions return the newest 500, set `truncated: true`, and exclude the two oldest.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
```

Expected: FAIL because `buildMfeMaeDetail` and the new response union do not exist.

- [ ] **Step 3: Update the response contract**

Replace the stub-shaped `mfeMae` type in `src/lib/trading/types.ts` with the discriminated union defined above. Do not change any other response field.

- [ ] **Step 4: Implement the pure payload builder**

In `preaggregated-cache.ts`:

- Add `MAX_MFE_MAE_POINTS = 500` near the other cache limits.
- Export `buildMfeMaeDetail` for focused testing.
- Return the unavailable variant only when the supplied array is empty.
- Sort a copied array by `closeTime` descending before slicing.
- Preserve null excursion values; otherwise convert Prisma numeric values with `Number(...)`.
- Calculate `netPnl` through the existing `positionNetPnl` helper.
- Set `truncated` from the pre-slice length.
- Replace the existing stub with `buildMfeMaeDetail(scopedClosedPositions)`.

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the backend contract**

```bash
git add src/lib/trading/types.ts src/lib/trading/preaggregated-cache.ts src/lib/trading/preaggregated-cache.test.ts
git commit -m "feat: expose scoped MAE MFE scatter data"
```

---

### Task 2: Add the Scatter Component and Styles

**Files:**

- Create: `src/components/trading-monitor/MaeMfePanel.tsx`
- Create: `src/components/trading-monitor/MaeMfePanel.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: the existing `ResourceState<BalanceDetailResponse>` shape through a `balanceDetail` prop.
- Produces: a memoized MAE/MFE scatter panel with Win and Loss series and no independent fetch.

- [ ] **Step 1: Add the failing source-contract test**

Create `MaeMfePanel.test.ts` using the existing `readFile`-based component test style. Assert that the source contains:

- `dynamic(() => import("react-apexcharts"), { ssr: false })`.
- Apex chart type `scatter` with MAE on X and MFE on Y.
- Series named `Win` and `Loss`, partitioned on `netPnl > 0`.
- Filtering for null or non-finite coordinates.
- Positive `#3dd68c` and negative `#f04d4d` chart colors.
- `formatSignedCurrency(..., 2)` for all three tooltip values.
- A visible two-series legend, skeleton, error state, unavailable state, and no-samples state.
- No `annotations` or trendline configuration.

- [ ] **Step 2: Run the test and verify RED**

```bash
node --import tsx --test src/components/trading-monitor/MaeMfePanel.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `MaeMfePanel`**

Follow `DrawdownEquityPanel.tsx` for the client boundary, memoization, stable chart ID, resource-state handling, and Apex dynamic import.

Build two memoized scatter series from points with finite MAE and MFE values:

```ts
type ScatterDatum = {
  x: number;
  y: number;
  netPnl: number;
};

[
  { name: "Win", data: winPoints },
  { name: "Loss", data: lossPoints },
]
```

Configure the chart with:

- Numeric axes titled `MAE` and `MFE` and compact signed tick formatting.
- `#3dd68c` and `#f04d4d` colors because ApexCharts cannot reliably resolve CSS custom properties.
- Six-pixel markers, disabled toolbar/zoom, non-shared nearest-point tooltip behavior, and a compact bottom legend.
- Custom tooltip rows for MAE, MFE, and net P/L using two-decimal signed currency.
- No annotations, reference lines, regression, or trendline.

Render states in this order:

1. Request error → error `InlineState`.
2. Initial load → existing chart skeleton.
3. `available: false` → empty `InlineState` using the API reason.
4. Available but zero plottable pairs → `No excursion samples yet` empty state.
5. Otherwise render the scatter, plus `Showing latest 500 trades` when truncated.

- [ ] **Step 4: Add panel and tooltip styles**

Add scoped `.mae-mfe-panel`, `.mae-mfe-panel__limit`, and `.mae-mfe-tooltip` rules near the existing `.dd-equity-panel` rules. The panel must fill the overlay, keep `min-width: 0`, hide chart overflow, use existing typography/surface tokens, and leave enough bottom space for the legend.

- [ ] **Step 5: Verify the component**

```bash
node --import tsx --test src/components/trading-monitor/MaeMfePanel.test.ts
npx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the component**

```bash
git add src/components/trading-monitor/MaeMfePanel.tsx src/components/trading-monitor/MaeMfePanel.test.ts src/app/globals.css
git commit -m "feat: add MAE MFE scatter panel"
```

---

### Task 3: Wire the DD Selector Without Changing MAX

**Files:**

- Modify: `src/components/trading-monitor/card/DashboardCard.tsx`
- Modify: `src/components/trading-monitor/card/DashboardCard.test.ts`
- Modify: `src/lib/trading/metric-registry.ts`
- Modify: `src/lib/trading/metric-registry.test.ts`

**Interfaces:**

- Consumes: `balanceDetail.data.mfeMae` from Task 1 and `MaeMfePanel` from Task 2.
- Produces: a registered `mae-mfe` display descriptor and selectable `"maeMfe"` DD state.

- [ ] **Step 1: Add failing DashboardCard and registry tests**

Extend the source-contract tests to verify:

- The state union and `DD_SUB_CYCLE` include `"maeMfe"`.
- The new chip toggles `"maeMfe"` back to `"dd"` when already selected.
- `<MaeMfePanel balanceDetail={balanceDetail} />` renders only for the new state.
- The positions-detail fetch condition excludes both `"abs"` and `"maeMfe"`.
- The existing `"max"` branch still renders `PerformanceQualityPanel`.
- `getDashboardMetric("mae-mfe")` returns the new display descriptor.

- [ ] **Step 2: Run the tests and verify RED**

```bash
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
node --import tsx --test src/lib/trading/metric-registry.test.ts
```

Expected: FAIL because the state, descriptor, chip, and render branch are absent.

- [ ] **Step 3: Register the display descriptor**

Add a `mae-mfe` registry item with:

```ts
{
  id: "mae-mfe",
  label: "MAE/MFE",
  meta: "Closed trades",
  hint: "MAE/MFE คือกำไรลอยตัวต่ำสุดและสูงสุดที่บันทึกระหว่างอายุของแต่ละ trade",
}
```

Use the descriptor for the selector label, meta, and hint.

- [ ] **Step 4: Add the state, resource gating, chip, and canvas branch**

- Import `MaeMfePanel`.
- Add `"maeMfe"` after `"expect"` in the cycle and state union.
- Exclude `"maeMfe"` from `needsPositionSummary`; it uses only `balanceDetail`.
- Derive the chip value from `mfeMae.points.length`, using `500+` when truncated and `-` when unavailable.
- Add the chip after EXPECT and follow the existing active-chip toggle pattern.
- Render the new component inside the existing `sp-overlay-panel`.
- Do not edit the MAX branch or `PerformanceQualityPanel.tsx`.

- [ ] **Step 5: Run the tests and verify GREEN**

```bash
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
node --import tsx --test src/lib/trading/metric-registry.test.ts
```

Expected: both test files PASS with zero failures.

- [ ] **Step 6: Commit the dashboard wiring**

```bash
git add src/components/trading-monitor/card/DashboardCard.tsx src/components/trading-monitor/card/DashboardCard.test.ts src/lib/trading/metric-registry.ts src/lib/trading/metric-registry.test.ts
git commit -m "feat: wire MAE MFE DD subpanel"
```

---

### Task 4: Synchronize Documentation and Verify

**Files:**

- Modify: `AGENTS.md`

**Interfaces:**

- Consumes: the final dashboard and response behavior from Tasks 1–3.
- Produces: repository guidance that records the new panel mapping and source boundary.

- [ ] **Step 1: Update the dashboard contract**

In `AGENTS.md`:

- Describe DD as the default plus five visible selector chips.
- Add the MAE/MFE row, scatter behavior, and closed-trade count value.
- Add per-trade MAE/MFE to the `Position` source-boundary row.
- State that the scatter uses the selected account and timeframe.
- Preserve the current MAX mapping.

- [ ] **Step 2: Run all focused and static verification**

```bash
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
node --import tsx --test src/components/trading-monitor/MaeMfePanel.test.ts
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
node --import tsx --test src/lib/trading/metric-registry.test.ts
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0 and `git diff --check` has no output.

- [ ] **Step 3: Verify portrait and landscape in a real browser**

At `390 × 844` and `844 × 390`, verify:

- MAE/MFE chip selection and toggle-back behavior.
- Scatter, axes, Win/Loss legend, truncation note, and touch tooltip fit without sideways panning.
- Timeframe changes update the scoped points.
- Orientation changes preserve account order.
- DD → MAX still shows its existing quality gauges.

Capture portrait and landscape screenshots for the eventual PR.

- [ ] **Step 4: Inspect final scope**

Run `git status --short` and confirm only the planned implementation and documentation files changed. Do not create or modify files belonging to the separate DD-quality-gauge relocation work.

- [ ] **Step 5: Commit the documentation update**

```bash
git add AGENTS.md
git commit -m "docs: document MAE MFE scatter panel"
```

## Acceptance Criteria

- Zero scoped closed trades returns the unavailable response variant.
- One to 500 scoped trades preserve the expected MAE/MFE/net-P&L tuples in newest-first order.
- More than 500 trades return only the latest 500 and expose truncation.
- Partial historic data plots only complete coordinate pairs without misrepresenting null as zero.
- Wins and losses render as separate semantic-color series with a visible legend.
- Tooltip values use exact two-decimal currency formatting.
- The panel performs no independent fetch and does not activate the positions summary request.
- The existing MAX branch remains unchanged.
- Focused tests, TypeScript, lint, build, whitespace checks, and both mobile orientations pass.

## Assumptions

- Existing positions without excursion samples are not backfilled by this feature.
- The balance-detail cache and account/timeframe request remain the only data path.
- No feature flag or migration rollout is needed because the former `mfeMae` payload was an unused unavailable stub.
- The separate DD-quality-gauge relocation design remains unexecuted and out of scope.
