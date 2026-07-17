# Trade Distribution ApexCharts Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current MAE-vs-MFE scatter with three MT5-style closed-position distribution charts: MFE–Profit, MAE–Profit, and Profit–Holding Time.

**Architecture:** Keep the existing account/timeframe data flow and ApexCharts client-only rendering. Build one server-side distribution payload from fully closed `Position` rows, compute regressions from the full scoped population, send a capped deterministic sample for rendering, and let one reusable panel switch between the three chart modes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, ApexCharts 5, react-apexcharts 2, Prisma 6, Node test runner.

## Global Constraints

- Code, identifiers, chart labels, test descriptions, and comments must be English only.
- Use `Position` as the source of truth; do not calculate these charts from individual `Deal` rows.
- Include only fully closed positions.
- A partial close must not finalize holding time, MAE, or MFE.
- Position holding time is `closeTime - openTime`; do not derive it from partial-close or reversal deals.
- Use the selected dashboard timeframe. `timeframe=all` means all history.
- Use account-scoped data already loaded by `getAccountBundle`; never join positions across accounts by ticket alone.
- MFE and MAE are deposit-currency values.
- Realized P/L uses the project convention: `profit + swap + commission`.
- Preserve `null` for unavailable MAE/MFE values; never replace missing values with zero.
- Regression must use the complete valid population in scope, not only the rendered point sample.
- Keep the chart usable on iPhone portrait and landscape.
- Do not add a scheduler, backfill worker, raw SQL, database table, or schema migration.
- Keep browser-only ApexCharts loading behind the existing dynamic import boundary.

---

## Current Problem

`src/components/trading-monitor/MaeMfePanel.tsx` currently plots:

```text
X = MAE
Y = MFE
```

That is not the intended MT5 distribution analysis.

The rebuilt panel must provide:

```text
MFE–Profit:
X = Maximum Favorable Excursion
Y = Realized Net P/L

MAE–Profit:
X = Maximum Adverse Excursion
Y = Realized Net P/L

Profit–Holding Time:
X = Full position holding duration
Y = Realized Net P/L
```

The MFE and MAE charts include least-squares regression lines. The MFE chart also includes an ideal 45-degree `y = x` reference line because both axes use the same deposit-currency unit.

---

## Target File Map

### Create

- `src/lib/trading/trade-distributions.ts`
  - Distribution point serialization
  - Holding-time calculation
  - Deterministic point sampling
  - Least-squares regression
  - Full distribution payload builder

- `src/lib/trading/trade-distributions.test.ts`
  - Math, null handling, sampling, duration, and full-population regression tests

- `src/components/trading-monitor/trade-distribution-chart.ts`
  - Chart-mode types
  - ApexCharts series construction
  - Axis-domain helpers
  - Duration formatting
  - Tooltip-safe point lookup helpers

- `src/components/trading-monitor/trade-distribution-chart.test.ts`
  - Series, reference line, regression line, and formatting tests

- `src/components/trading-monitor/TradeDistributionPanel.tsx`
  - Three-mode tab UI
  - ApexCharts rendering
  - Loading/error/empty states
  - Accessible summary and mobile controls

- `src/components/trading-monitor/TradeDistributionPanel.test.ts`
  - Source-contract/integration tests matching the repository's current component-test style

### Modify

- `src/lib/trading/types.ts`
  - Replace `BalanceDetailResponse["mfeMae"]` with `tradeDistributions`

- `src/lib/trading/preaggregated-cache.ts`
  - Remove `buildMfeMaeDetail`
  - Call `buildTradeDistributionDetail(scopedClosedPositions)`

- `src/lib/trading/preaggregated-cache.test.ts`
  - Replace the old MAE/MFE payload expectations

- `src/components/trading-monitor/card/DashboardCard.tsx`
  - Replace `MaeMfePanel` import/render with `TradeDistributionPanel`

- `src/components/trading-monitor/card/DashboardCard.test.ts`
  - Verify the `"max"` sub-panel renders the rebuilt distribution panel

- `src/app/globals.css`
  - Add panel tabs, chart header, metadata, and mobile layout

### Delete after replacement tests pass

- `src/components/trading-monitor/MaeMfePanel.tsx`
- `src/components/trading-monitor/MaeMfePanel.test.ts`

No Prisma schema or migration file should change.

---

## Public Data Contract

Add these types to `src/lib/trading/types.ts`:

```ts
export type LinearRegressionSummary = {
  slope: number;
  intercept: number;
  rSquared: number;
  sampleSize: number;
  minX: number;
  maxX: number;
};

export type TradeDistributionPoint = {
  positionId: string;
  symbol: string;
  openTime: string;
  closeTime: string;
  holdingSeconds: number | null;
  mae: number | null;
  mfe: number | null;
  profit: number;
  swap: number;
  commission: number;
  netPnl: number;
};

export type TradeDistributionDetail =
  | {
      available: false;
      reason: string;
    }
  | {
      available: true;
      totalPositions: number;
      plottedPositions: number;
      truncated: boolean;
      points: TradeDistributionPoint[];
      regressions: {
        mfeProfit: LinearRegressionSummary | null;
        maeProfit: LinearRegressionSummary | null;
        holdingProfit: LinearRegressionSummary | null;
      };
    };
```

Replace this property:

```ts
mfeMae: ...
```

with:

```ts
tradeDistributions: TradeDistributionDetail;
```

Do not keep both contracts after the migration. This is an internal API consumed only by the dashboard and keeping both would create two competing meanings.

---

### Task 1: Add regression and distribution-domain helpers

**Files:**
- Create: `src/lib/trading/trade-distributions.ts`
- Create: `src/lib/trading/trade-distributions.test.ts`

**Interfaces:**
- Consumes: `PositionRow`-compatible values and the existing `positionNetPnl` convention.
- Produces:
  - `computeLinearRegression(points)`
  - `computeHoldingSeconds(openTime, closeTime)`
  - `sampleEvenly(points, limit)`
  - `buildTradeDistributionDetail(closedPositions)`

- [ ] **Step 1: Write failing tests for linear regression**

Test an exact line:

```ts
test("computeLinearRegression returns an exact least-squares fit", () => {
  assert.deepEqual(
    computeLinearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]),
    {
      slope: 2,
      intercept: 1,
      rSquared: 1,
      sampleSize: 3,
      minX: 0,
      maxX: 2,
    },
  );
});
```

Test invalid cases:

```ts
test("computeLinearRegression returns null with fewer than two finite points", () => {
  assert.equal(computeLinearRegression([{ x: 1, y: 2 }]), null);
});

test("computeLinearRegression returns null when x has zero variance", () => {
  assert.equal(
    computeLinearRegression([
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ]),
    null,
  );
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
node --import tsx --test src/lib/trading/trade-distributions.test.ts
```

Expected: failure because the module/functions do not exist.

- [ ] **Step 3: Implement finite least-squares regression**

Use this exact numerical contract:

```ts
export function computeLinearRegression(
  input: Array<{ x: number; y: number }>,
): LinearRegressionSummary | null {
  const points = input.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );

  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumX2 = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = n * sumX2 - sumX * sumX;

  if (!Number.isFinite(denominator) || Math.abs(denominator) < Number.EPSILON) {
    return null;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const totalVariation = points.reduce(
    (sum, point) => sum + (point.y - meanY) ** 2,
    0,
  );
  const residualVariation = points.reduce((sum, point) => {
    const fitted = slope * point.x + intercept;
    return sum + (point.y - fitted) ** 2;
  }, 0);
  const rSquared =
    totalVariation === 0 ? 1 : 1 - residualVariation / totalVariation;

  return {
    slope,
    intercept,
    rSquared,
    sampleSize: n,
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
  };
}
```

- [ ] **Step 4: Add holding-time tests**

Required behavior:

```ts
test("computeHoldingSeconds uses complete position lifetime", () => {
  assert.equal(
    computeHoldingSeconds(
      new Date("2026-07-17T00:00:00.000Z"),
      new Date("2026-07-17T01:30:00.000Z"),
    ),
    5400,
  );
});

test("computeHoldingSeconds rejects missing, invalid, and reversed timestamps", () => {
  assert.equal(computeHoldingSeconds(null, new Date()), null);
  assert.equal(computeHoldingSeconds(new Date(), null), null);
  assert.equal(
    computeHoldingSeconds(
      new Date("2026-07-17T02:00:00.000Z"),
      new Date("2026-07-17T01:00:00.000Z"),
    ),
    null,
  );
});
```

Implement duration as:

```ts
export function computeHoldingSeconds(
  openTime: Date | string | null | undefined,
  closeTime: Date | string | null | undefined,
): number | null {
  if (!openTime || !closeTime) return null;

  const openedAt = new Date(openTime).getTime();
  const closedAt = new Date(closeTime).getTime();
  const durationMs = closedAt - openedAt;

  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  return durationMs / 1000;
}
```

- [ ] **Step 5: Add deterministic sampling tests**

The chart must not render all 10,000+ positions, but the sample must cover the full selected timeframe rather than only the newest rows.

Use a stable evenly spaced sample:

```ts
export function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  if (limit <= 1) return items.length === 0 ? [] : [items[items.length - 1]];

  const sampled: T[] = [];
  const lastIndex = items.length - 1;

  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    sampled.push(items[sourceIndex]);
  }

  return sampled;
}
```

Test that the first and last positions remain represented and that the output is deterministic.

- [ ] **Step 6: Run tests**

```bash
node --import tsx --test src/lib/trading/trade-distributions.test.ts
```

Expected: all Task 1 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trading/trade-distributions.ts \
        src/lib/trading/trade-distributions.test.ts
git commit -m "feat: add trade distribution analysis helpers"
```

---

### Task 2: Build the full server payload from closed positions

**Files:**
- Modify: `src/lib/trading/trade-distributions.ts`
- Modify: `src/lib/trading/trade-distributions.test.ts`
- Modify: `src/lib/trading/types.ts`

**Interfaces:**
- Consumes: fully closed, account-scoped, timeframe-scoped positions.
- Produces: `TradeDistributionDetail`.

- [ ] **Step 1: Write a failing payload-builder test**

Use positions containing:

- complete MAE and MFE,
- a missing MAE,
- a missing MFE,
- a missing opening time,
- profit, swap, and commission values,
- multiple close times.

Assertions must prove:

```text
netPnl = profit + swap + commission
holdingSeconds = closeTime - openTime
missing mae/mfe remain null
regression filters only the missing x value for that chart
time regression filters only invalid holding duration
points are sorted by closeTime ascending before sampling
regression sampleSize uses the full population
```

- [ ] **Step 2: Implement the builder**

Use:

```ts
const MAX_RENDERED_DISTRIBUTION_POINTS = 1000;
```

Serialize every valid closed position before sampling:

```ts
const population = closedPositions
  .filter((position) => position.closeTime != null)
  .map((position) => {
    const profit = Number(position.profit ?? 0);
    const swap = Number(position.swap ?? 0);
    const commission = Number(position.commission ?? 0);

    return {
      positionId: String(position.positionNo ?? ""),
      symbol: String(position.symbol ?? "UNKNOWN"),
      openTime: position.openTime
        ? new Date(position.openTime).toISOString()
        : "",
      closeTime: new Date(position.closeTime!).toISOString(),
      holdingSeconds: computeHoldingSeconds(
        position.openTime,
        position.closeTime,
      ),
      mae: position.mae == null ? null : Number(position.mae),
      mfe: position.mfe == null ? null : Number(position.mfe),
      profit,
      swap,
      commission,
      netPnl: profit + swap + commission,
    };
  })
  .sort(
    (left, right) =>
      new Date(left.closeTime).getTime() - new Date(right.closeTime).getTime(),
  );
```

Compute regressions from `population`, never from sampled points:

```ts
const regressions = {
  mfeProfit: computeLinearRegression(
    population.flatMap((point) =>
      point.mfe == null ? [] : [{ x: point.mfe, y: point.netPnl }],
    ),
  ),
  maeProfit: computeLinearRegression(
    population.flatMap((point) =>
      point.mae == null ? [] : [{ x: point.mae, y: point.netPnl }],
    ),
  ),
  holdingProfit: computeLinearRegression(
    population.flatMap((point) =>
      point.holdingSeconds == null
        ? []
        : [{ x: point.holdingSeconds, y: point.netPnl }],
    ),
  ),
};
```

Return unavailable only when there are no closed positions:

```ts
if (closedPositions.length === 0) {
  return {
    available: false,
    reason: "No fully closed positions in the selected timeframe.",
  };
}
```

When closed rows exist but a specific chart has no valid x values, keep the overall payload available. The panel will show a mode-specific empty state.

- [ ] **Step 3: Update `BalanceDetailResponse`**

Replace the old `mfeMae` contract with:

```ts
tradeDistributions: TradeDistributionDetail;
```

- [ ] **Step 4: Run tests**

```bash
node --import tsx --test src/lib/trading/trade-distributions.test.ts
npx tsc --noEmit
```

Expected: distribution helper tests pass and TypeScript failures point only to old `mfeMae` consumers that will be migrated in later tasks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/trade-distributions.ts \
        src/lib/trading/trade-distributions.test.ts \
        src/lib/trading/types.ts
git commit -m "feat: define closed-position distribution payload"
```

---

### Task 3: Replace the preaggregated-cache MAE/MFE builder

**Files:**
- Modify: `src/lib/trading/preaggregated-cache.ts`
- Modify: `src/lib/trading/preaggregated-cache.test.ts`

**Interfaces:**
- Consumes: `scopedClosedPositions`.
- Produces: `balanceDetail.tradeDistributions`.

- [ ] **Step 1: Replace old tests**

Delete assertions for:

```ts
buildMfeMaeDetail(...)
balanceDetail.mfeMae
```

Add assertions for:

```ts
balanceDetail.tradeDistributions
```

The tests must verify:

1. Selected-timeframe scoping is retained.
2. Only closed positions are included.
3. `netPnl` includes profit, swap, and commission.
4. Duration comes from `Position.openTime` and `Position.closeTime`.
5. No new Prisma query is introduced.
6. The payload reports `truncated`, `totalPositions`, and `plottedPositions`.

- [ ] **Step 2: Remove the old builder**

Delete:

```ts
const MAX_MFE_MAE_POINTS = 500;
export function buildMfeMaeDetail(...) { ... }
```

- [ ] **Step 3: Import and call the new builder**

```ts
import { buildTradeDistributionDetail } from "@/lib/trading/trade-distributions";
```

Replace:

```ts
mfeMae: buildMfeMaeDetail(scopedClosedPositions),
```

with:

```ts
tradeDistributions: buildTradeDistributionDetail(scopedClosedPositions),
```

- [ ] **Step 4: Run targeted tests**

```bash
node --import tsx --test src/lib/trading/trade-distributions.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
```

Expected: all targeted backend tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/preaggregated-cache.ts \
        src/lib/trading/preaggregated-cache.test.ts
git commit -m "refactor: build MT5 trade distributions from positions"
```

---

### Task 4: Build the chart-model layer

**Files:**
- Create: `src/components/trading-monitor/trade-distribution-chart.ts`
- Create: `src/components/trading-monitor/trade-distribution-chart.test.ts`

**Interfaces:**
- Consumes: `TradeDistributionDetail`.
- Produces:
  - `TradeDistributionMode`
  - `buildTradeDistributionSeries(mode, detail)`
  - `buildTradeDistributionDomains(mode, points)`
  - `formatHoldingDuration(seconds)`
  - `getModeCopy(mode)`

Use:

```ts
export type TradeDistributionMode =
  | "mfe-profit"
  | "mae-profit"
  | "profit-time";
```

- [ ] **Step 1: Test mode mappings**

Expected mappings:

```ts
mfe-profit:
  x = point.mfe
  y = point.netPnl

mae-profit:
  x = point.mae
  y = point.netPnl

profit-time:
  x = point.holdingSeconds
  y = point.netPnl
```

Null and non-finite x values must be omitted for only that mode.

- [ ] **Step 2: Build win/loss scatter series**

Use two visible scatter series so outcome remains readable without relying on tooltip:

```ts
type DistributionDatum = {
  x: number;
  y: number;
  pointIndex: number;
};

const wins = data.filter((datum) => datum.y > 0);
const losses = data.filter((datum) => datum.y <= 0);
```

Series names:

```text
Profit
Loss
Regression
Ideal 45°
```

- [ ] **Step 3: Add regression line construction**

Convert a regression summary to two endpoints:

```ts
export function regressionLine(
  regression: LinearRegressionSummary | null,
): Array<{ x: number; y: number }> {
  if (!regression) return [];

  return [
    {
      x: regression.minX,
      y: regression.slope * regression.minX + regression.intercept,
    },
    {
      x: regression.maxX,
      y: regression.slope * regression.maxX + regression.intercept,
    },
  ];
}
```

Mode behavior:

```text
MFE–Profit:
- Profit scatter
- Loss scatter
- Regression line
- Ideal 45° line from x-domain min to max

MAE–Profit:
- Profit scatter
- Loss scatter
- Regression line

Profit–Holding Time:
- Profit scatter
- Loss scatter
- Regression line
```

The holding-time regression is useful as an objective correlation summary even though the prose does not require a 45-degree target.

- [ ] **Step 4: Build the ideal 45-degree line correctly**

The ideal line is `y = x`, but clip it to the shared visible domain so it does not force an unnecessarily large axis.

```ts
export function idealCaptureLine(
  minX: number,
  maxX: number,
): Array<{ x: number; y: number }> {
  return [
    { x: minX, y: minX },
    { x: maxX, y: maxX },
  ];
}
```

Only include it in MFE mode.

- [ ] **Step 5: Add adaptive holding-time labels**

```ts
export function formatHoldingDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${seconds / 60 < 10 ? (seconds / 60).toFixed(1) : Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${seconds / 3600 < 10 ? (seconds / 3600).toFixed(1) : Math.round(seconds / 3600)}h`;
  return `${seconds / 86400 < 10 ? (seconds / 86400).toFixed(1) : Math.round(seconds / 86400)}d`;
}
```

- [ ] **Step 6: Add mode copy**

```ts
export function getModeCopy(mode: TradeDistributionMode) {
  switch (mode) {
    case "mfe-profit":
      return {
        title: "MFE–Profit Distribution",
        xAxis: "Maximum Favorable Excursion",
        yAxis: "Net P/L",
        description:
          "Shows how much favorable unrealized profit was available and how much was retained at close.",
      };
    case "mae-profit":
      return {
        title: "MAE–Profit Distribution",
        xAxis: "Maximum Adverse Excursion",
        yAxis: "Net P/L",
        description:
          "Shows the largest unrealized drawdown endured before the final closed result.",
      };
    case "profit-time":
      return {
        title: "Profit–Holding Time Distribution",
        xAxis: "Holding Time",
        yAxis: "Net P/L",
        description:
          "Shows the relationship between full position lifetime and the final closed result.",
      };
  }
}
```

- [ ] **Step 7: Run tests**

```bash
node --import tsx --test src/components/trading-monitor/trade-distribution-chart.test.ts
```

Expected: all chart-model tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/trading-monitor/trade-distribution-chart.ts \
        src/components/trading-monitor/trade-distribution-chart.test.ts
git commit -m "feat: add trade distribution chart models"
```

---

### Task 5: Rebuild the ApexCharts panel

**Files:**
- Create: `src/components/trading-monitor/TradeDistributionPanel.tsx`
- Create: `src/components/trading-monitor/TradeDistributionPanel.test.ts`

**Interfaces:**
- Consumes: the existing `balanceDetail` resource state.
- Produces: an accessible three-mode interactive chart panel.

- [ ] **Step 1: Keep the browser-only chart boundary**

```ts
const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });
```

Do not convert the whole dashboard card to client-imperative ApexCharts lifecycle code. React owns tabs/state/layout; ApexCharts owns marks and axes.

- [ ] **Step 2: Add tab state**

Default mode:

```ts
const [mode, setMode] =
  useState<TradeDistributionMode>("mfe-profit");
```

Render three buttons inside:

```tsx
<div role="tablist" aria-label="Trade distribution chart">
  <button role="tab" aria-selected={mode === "mfe-profit"}>MFE</button>
  <button role="tab" aria-selected={mode === "mae-profit"}>MAE</button>
  <button role="tab" aria-selected={mode === "profit-time"}>TIME</button>
</div>
```

Use real buttons; do not use clickable `div` elements.

- [ ] **Step 3: Use a mixed ApexCharts configuration**

Set the chart fallback type to line because each series declares its own type:

```ts
chart: {
  id: `trade-distribution-${chartId}`,
  type: "line",
  background: "transparent",
  toolbar: { show: false },
  zoom: { enabled: false },
  animations: { enabled: false },
  fontFamily: "var(--font-mono)",
}
```

Use per-series types:

```ts
[
  { name: "Profit", type: "scatter", data: ... },
  { name: "Loss", type: "scatter", data: ... },
  { name: "Regression", type: "line", data: ... },
  { name: "Ideal 45°", type: "line", data: ... }, // MFE only
]
```

Use arrays for line/scatter visual behavior:

```ts
stroke: {
  width: [0, 0, 2, 1],
  curve: "straight",
  dashArray: [0, 0, 0, 6],
},
markers: {
  size: [5, 5, 0, 0],
  strokeWidth: 0,
  hover: { sizeOffset: 2 },
},
```

When the ideal series is absent, build arrays that match the actual series length.

- [ ] **Step 4: Add zero reference axes**

Use annotations:

```ts
annotations: {
  xaxis:
    mode === "mae-profit"
      ? [{ x: 0, borderColor: "rgba(240,242,245,0.20)" }]
      : [],
  yaxis: [{ y: 0, borderColor: "rgba(240,242,245,0.20)" }],
},
```

Do not use the zero line as a substitute for regression.

- [ ] **Step 5: Add exact tooltip content**

Scatter tooltip must show:

```text
Symbol and position ticket
MFE or MAE or holding duration
Net P/L
Profit
Swap
Commission
Open time
Close time
```

Use the original point by `pointIndex`; never infer tooltip details from the line-series coordinates.

For regression/reference series, either disable tooltip or return an empty string.

- [ ] **Step 6: Show regression metadata outside hover**

Display essential regression evidence in visible text:

```text
Slope 0.72
R² 0.61
n 8,042
```

For MFE mode, also show:

```text
Ideal slope: 1.00
```

Do not make slope/R² hover-only.

- [ ] **Step 7: Add mode-specific empty states**

Examples:

```text
MFE unavailable
No fully closed positions with MFE values exist in this timeframe.

MAE unavailable
No fully closed positions with MAE values exist in this timeframe.

Holding time unavailable
No fully closed positions have valid opening and closing timestamps.
```

Overall error/loading behavior should continue using `InlineState` and the existing skeleton class.

- [ ] **Step 8: Add truncation disclosure**

Display:

```text
Showing 1,000 sampled positions from 14,238; regression uses all valid positions.
```

Do not say "latest 1,000" because the sample spans the full timeframe.

- [ ] **Step 9: Add mobile behavior**

At widths below 480 px:

- chart height: 260 px,
- markers: 4 px,
- title/subtitle stack vertically,
- tabs stay visible above the chart,
- tooltip remains reachable by tap,
- no horizontal scrolling,
- regression metadata wraps to a second line.

Use ApexCharts `responsive` overrides plus CSS layout changes.

- [ ] **Step 10: Add component tests**

Tests must verify:

- dynamic import remains `ssr: false`,
- three tab labels exist,
- default mode is MFE,
- mixed scatter/line types are present,
- regression and ideal line are distinct series,
- MAE mode has an x=0 annotation,
- y=0 annotation exists,
- tooltip contains net P/L, swap, and commission,
- truncation disclosure says regression uses all positions,
- mode-specific empty states exist,
- visible slope/R²/sample-size summary exists.

- [ ] **Step 11: Run tests**

```bash
node --import tsx --test src/components/trading-monitor/trade-distribution-chart.test.ts
node --import tsx --test src/components/trading-monitor/TradeDistributionPanel.test.ts
```

Expected: all panel/chart tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/components/trading-monitor/TradeDistributionPanel.tsx \
        src/components/trading-monitor/TradeDistributionPanel.test.ts
git commit -m "feat: rebuild MT5 trade distribution ApexCharts"
```

---

### Task 6: Integrate the rebuilt panel into DashboardCard

**Files:**
- Modify: `src/components/trading-monitor/card/DashboardCard.tsx`
- Modify: `src/components/trading-monitor/card/DashboardCard.test.ts`

**Interfaces:**
- Consumes: the existing `balanceDetail` request.
- Produces: rebuilt chart under the existing `"max"` DD sub-panel.

- [ ] **Step 1: Replace the import**

Delete:

```ts
import { MaeMfePanel } from "@/components/trading-monitor/MaeMfePanel";
```

Add:

```ts
import { TradeDistributionPanel } from "@/components/trading-monitor/TradeDistributionPanel";
```

- [ ] **Step 2: Replace the render branch**

Replace:

```tsx
{ddSubPanel === "max" && (
  <MaeMfePanel balanceDetail={balanceDetail} />
)}
```

with:

```tsx
{ddSubPanel === "max" && (
  <TradeDistributionPanel balanceDetail={balanceDetail} />
)}
```

Do not add another API request. `/balance?timeframe=${timeframe}` already provides the required scoped payload.

- [ ] **Step 3: Preserve panel-cycle behavior**

Keep:

```ts
const DD_SUB_CYCLE = ["dd", "abs", "max", "win", "expect"] as const;
```

This rebuild changes the content of `"max"` only. It does not add another top-level DD cycle state.

- [ ] **Step 4: Update tests**

Assert that:

```text
TradeDistributionPanel is imported
TradeDistributionPanel receives balanceDetail
MaeMfePanel is no longer referenced
the max branch remains in the existing DD cycle
```

- [ ] **Step 5: Run tests**

```bash
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/trading-monitor/card/DashboardCard.tsx \
        src/components/trading-monitor/card/DashboardCard.test.ts
git commit -m "refactor: replace MAE MFE panel with trade distributions"
```

---

### Task 7: Add responsive and accessible styling

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add focused panel classes**

Use a component namespace:

```css
.trade-distribution-panel {}
.trade-distribution-panel__header {}
.trade-distribution-panel__tabs {}
.trade-distribution-panel__tab {}
.trade-distribution-panel__tab.is-selected {}
.trade-distribution-panel__meta {}
.trade-distribution-panel__chart {}
.trade-distribution-panel__limit {}
.trade-distribution-tooltip {}
```

Do not reuse `.mae-mfe-*` names for the new three-chart behavior.

- [ ] **Step 2: Preserve chart space**

Desktop/large card:

```css
.trade-distribution-panel {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  height: 100%;
}

.trade-distribution-panel__chart {
  min-height: 280px;
  min-width: 0;
}
```

- [ ] **Step 3: Add mobile portrait rules**

```css
@media (max-width: 480px) {
  .trade-distribution-panel__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .trade-distribution-panel__tabs {
    width: 100%;
  }

  .trade-distribution-panel__tab {
    min-height: 36px;
    flex: 1;
  }

  .trade-distribution-panel__chart {
    min-height: 260px;
  }
}
```

- [ ] **Step 4: Add keyboard focus**

Every tab button must have a visible `:focus-visible` outline with sufficient contrast.

- [ ] **Step 5: Verify no horizontal overflow**

Check:

```text
390 × 844 portrait
844 × 390 landscape
768 × 1024 tablet
1440 × 900 desktop
```

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "style: add responsive trade distribution panel"
```

---

### Task 8: Remove obsolete MAE-vs-MFE implementation

**Files:**
- Delete: `src/components/trading-monitor/MaeMfePanel.tsx`
- Delete: `src/components/trading-monitor/MaeMfePanel.test.ts`

- [ ] **Step 1: Search for old references**

```bash
rg -n "MaeMfePanel|mfeMae|buildMfeMaeDetail|mae-mfe-panel" src
```

Expected before deletion: only obsolete files/styles or missed migration references.

- [ ] **Step 2: Remove all obsolete references**

After cleanup:

```bash
rg -n "MaeMfePanel|mfeMae|buildMfeMaeDetail|mae-mfe-panel" src
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete MAE versus MFE chart"
```

---

### Task 9: Full verification and data-quality gates

- [ ] **Step 1: Run all focused tests**

```bash
node --import tsx --test src/lib/trading/trade-distributions.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
node --import tsx --test src/components/trading-monitor/trade-distribution-chart.test.ts
node --import tsx --test src/components/trading-monitor/TradeDistributionPanel.test.ts
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run static checks**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected:

```text
TypeScript: no new errors
Lint: zero new errors
Next.js production build: pass
```

- [ ] **Step 3: Verify payload correctness against database rows**

For at least one known fully closed position, compare:

```text
Chart MFE = Position.mfe
Chart MAE = Position.mae
Chart Net P/L = Position.profit + Position.swap + Position.commission
Chart Holding Time = Position.closeTime - Position.openTime
```

Do not compare against an individual closing deal because a position may contain multiple deals.

- [ ] **Step 4: Verify partial-close behavior**

Choose a ticket with a partial close and later final close. Confirm:

```text
one chart point only
close time equals final full-close time
holding duration ends at final full-close time
MAE/MFE are final position-level values
```

- [ ] **Step 5: Verify null behavior**

A position missing MFE:

```text
does not appear in MFE chart
may appear in MAE chart
may appear in holding-time chart
does not become MFE = 0
```

A position missing MAE follows the symmetric rule.

- [ ] **Step 6: Verify account isolation**

Use two accounts that contain identical ticket numbers and confirm each dashboard card displays only its own positions.

- [ ] **Step 7: Verify timeframe behavior**

For each of:

```text
1d, 1w, 1m, 3m, 6m, 1y, all
```

confirm the chart population changes according to `Position.closeTime`, matching the rest of the selected-timeframe closed-position metrics.

- [ ] **Step 8: Verify regression population**

When `totalPositions > plottedPositions`, confirm:

```text
regression sampleSize may exceed plottedPositions
truncation disclosure is visible
regression line is generated from the full valid population
```

- [ ] **Step 9: Visual QA**

MFE–Profit:

```text
X axis uses deposit currency
Y axis uses deposit currency
ideal y=x line is dashed and visibly distinct
regression is solid
wins/losses remain distinguishable
```

MAE–Profit:

```text
negative MAE is displayed left of zero
x=0 and y=0 references are visible
large adverse excursions are not clipped
```

Profit–Holding Time:

```text
x labels adapt from seconds to minutes/hours/days
duration uses full close only
long-duration outliers remain inspectable
```

Mobile:

```text
tabs are tappable
tooltip opens by tap
chart does not overflow
visible regression metadata remains readable
```

- [ ] **Step 10: Final commit if verification required fixes**

```bash
git add -A
git commit -m "fix: complete trade distribution chart verification"
```

Skip this commit when the working tree is clean.

---

## Acceptance Criteria

The rebuild is complete only when all statements are true:

1. The old MAE-vs-MFE scatter no longer exists.
2. MFE–Profit plots `x = Position.mfe`, `y = Position profit + swap + commission`.
3. MAE–Profit plots `x = Position.mae`, `y = Position profit + swap + commission`.
4. Profit–Holding Time plots `x = Position.closeTime - Position.openTime`, `y = Position profit + swap + commission`.
5. Only fully closed positions are included.
6. Partial closes do not create extra points or shorten holding duration.
7. MFE and MAE regressions use least squares.
8. Profit–Holding Time also exposes a correlation regression and R².
9. MFE mode includes a clearly labeled ideal 45-degree `y = x` line.
10. Missing MAE/MFE values remain null and are omitted only from the affected chart.
11. Regression uses all valid scoped positions even when chart points are sampled.
12. The selected dashboard timeframe controls all three distributions.
13. Data remains isolated by trading account.
14. No database migration or new API route is introduced.
15. The panel passes desktop, iPhone portrait, and iPhone landscape QA.
16. TypeScript, lint, targeted tests, and production build pass.

## Explicit Non-Goals

- No new excursion sampling mechanism.
- No MAE/MFE recalculation in the browser.
- No deal-level duration calculation.
- No partial-close markers.
- No symbol filter or strategy filter in this rebuild.
- No logarithmic holding-time axis.
- No WebGL or 3D rendering.
- No export-to-image feature.
- No change to the top-level dashboard timeframe behavior.
