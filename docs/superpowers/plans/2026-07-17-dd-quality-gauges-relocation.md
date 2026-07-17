# DD Quality Gauges Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Sharpe, Profit Factor, and Recovery gauges above the comparison bars in DD → WIN while leaving DD → MAX empty for a future MAE/MFE panel.

**Architecture:** `PerformanceBars.tsx` becomes the single owner of the WIN panel's quality gauges and comparison bars. `DashboardCard.tsx` only routes existing position-summary values into it; MAX remains selectable without rendering canvas content. Metric formulas, response types, thresholds, tap hints, and comparison-bar ordering do not change.

**Tech Stack:** React 19, TypeScript, Next.js 16, framer-motion, Node test runner, CSS in `src/app/globals.css`.

## Global Constraints

- Quality gauges render before comparison bars in DD → WIN.
- DD → MAX renders no content and no placeholder message.
- All three quality values continue to come from `positionsDetail.data.summary`.
- Preserve current gauge labels, thresholds, formatting, colors, tap hints, and accessible labels.
- Preserve comparison-bar order and its two-column layout.
- Do not implement MAE/MFE visualization or change API/analytics contracts.
- Verify mobile portrait and landscape without horizontal panning.

---

### Task 1: Relocate Gauges and Rewire DD Sub-Panels

**Files:**
- Create: `src/components/trading-monitor/PerformanceBars.test.ts`
- Modify: `src/components/trading-monitor/card/DashboardCard.test.ts`
- Modify: `src/components/trading-monitor/PerformanceBars.tsx`
- Modify: `src/components/trading-monitor/card/DashboardCard.tsx`
- Modify: `src/app/globals.css`
- Delete: `src/components/trading-monitor/PerformanceQualityPanel.tsx`

**Interfaces:**
- Consumes: `positionsDetail.data.summary.sharpeRatio`, `.profitFactor`, and `.recoveryFactor`.
- Produces: `PerformanceBarsProps` with optional quality-metric inputs; `PerformanceBars` renders gauges first and comparison bars second.

- [ ] **Step 1: Add the failing DashboardCard routing test**

Append to `src/components/trading-monitor/card/DashboardCard.test.ts`:

```ts
test("DD MAX is empty and quality metrics are routed into DD WIN PerformanceBars", async () => {
  const source = await readFile(
    new URL("./DashboardCard.tsx", import.meta.url),
    "utf8",
  );
  const compactPanelStart = source.indexOf("const compactKpiPanel");
  const compactPanel = source.slice(
    compactPanelStart,
    source.indexOf("return (", compactPanelStart),
  );

  assert.equal(source.includes("PerformanceQualityPanel"), false);
  assert.equal(compactPanel.includes('ddSubPanel === "max"'), false);
  assert.match(
    compactPanel,
    /<PerformanceBars[\s\S]*sharpeRatio=\{positionsDetail\.data\?\.summary\.sharpeRatio\}[\s\S]*profitFactor=\{positionsDetail\.data\?\.summary\.profitFactor\}[\s\S]*recoveryFactor=\{positionsDetail\.data\?\.summary\.recoveryFactor\}/,
  );
});
```

- [ ] **Step 2: Add the failing PerformanceBars ownership/order test**

Create `src/components/trading-monitor/PerformanceBars.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PerformanceBars owns quality gauges and renders them before comparison bars", async () => {
  const source = await readFile(
    new URL("./PerformanceBars.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /label: "SHARPE"/);
  assert.match(source, /label: "PROFIT F\."/);
  assert.match(source, /label: "RECOVERY"/);

  const gaugesIndex = source.indexOf(
    'className="perf-quality-panel__gauges-row"',
  );
  const barsIndex = source.indexOf("{bars.map((config) => (");
  assert.notEqual(gaugesIndex, -1);
  assert.notEqual(barsIndex, -1);
  assert.ok(gaugesIndex < barsIndex);
});
```

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
node --import tsx --test src/components/trading-monitor/PerformanceBars.test.ts src/components/trading-monitor/card/DashboardCard.test.ts
```

Expected: FAIL because `DashboardCard` still imports/renders `PerformanceQualityPanel`, while `PerformanceBars.tsx` does not own the gauge labels or gauge row.

- [ ] **Step 4: Move the gauge implementation into PerformanceBars**

In `src/components/trading-monitor/PerformanceBars.tsx`, change the React import,
then add the following fields at the beginning of the existing
`PerformanceBarsProps` interface:

```ts
import { memo, useMemo } from "react";

sharpeRatio?: number | null | undefined;
profitFactor?: number | null | undefined;
recoveryFactor?: number | null | undefined;
```

Move `ZoneTone`, `Zone`, `BarConfig`, `ZONE_COLORS`, `GAUGE`, `clamp01`, `gaugePoint`, `arcPath`, `SHARPE_ZONES`, `PROFIT_FACTOR_ZONES`, `RECOVERY_ZONES`, `pickZone`, and `QualityGauge` from `PerformanceQualityPanel.tsx` without changing their values or rendering logic.

At the start of `PerformanceBarsImpl`, define:

```ts
const gauges = useMemo<BarConfig[]>(
  () => [
    {
      key: "sharpe",
      label: "SHARPE",
      zoneColors: ZONE_COLORS,
      value: props.sharpeRatio,
      zones: SHARPE_ZONES,
      scaleMax: 5,
      hint: { definition: "ความคุ้มค่าของผลตอบแทนเมื่อเทียบกับความเสี่ยง" },
    },
    {
      key: "pf",
      label: "PROFIT F.",
      zoneColors: ZONE_COLORS,
      value: props.profitFactor,
      zones: PROFIT_FACTOR_ZONES,
      scaleMax: 4,
      infinityZoneIndex: 2,
      hint: { definition: "ความสามารถในการทำกำไรเทียบกับการขาดทุน" },
    },
    {
      key: "recovery",
      label: "RECOVERY",
      zoneColors: ZONE_COLORS,
      value: props.recoveryFactor,
      zones: RECOVERY_ZONES,
      scaleMax: 7,
      hint: { definition: "ความสามารถในการฟื้นตัวจาก Drawdown" },
    },
  ],
  [props.sharpeRatio, props.profitFactor, props.recoveryFactor],
);
```

Render this before `bars.map(...)` and change the parent `aria-label` to `Performance quality and comparison bars`:

```tsx
<div
  className="perf-quality-panel__gauges-row"
  role="region"
  aria-label="Quality gauges"
>
  {gauges.map((config) => (
    <QualityGauge key={config.key} config={config} />
  ))}
</div>
```

- [ ] **Step 5: Rewire DashboardCard and empty MAX**

In `DashboardCard.tsx`, remove the `PerformanceQualityPanel` import and its entire `ddSubPanel === "max"` canvas branch. Keep the MAX `SummaryChip` selection/toggle unchanged. Pass these props to the existing DD → WIN `<PerformanceBars>` call:

```tsx
sharpeRatio={positionsDetail.data?.summary.sharpeRatio}
profitFactor={positionsDetail.data?.summary.profitFactor}
recoveryFactor={positionsDetail.data?.summary.recoveryFactor}
```

Delete `src/components/trading-monitor/PerformanceQualityPanel.tsx` after its gauge code is moved.

- [ ] **Step 6: Add the full-width gauge-row layout**

Add after `.perf-quality-panel--bars` in `src/app/globals.css`:

```css
.perf-quality-panel__gauges-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: clamp(8px, 3vw, 16px);
  width: 100%;
  min-width: 0;
}
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
node --import tsx --test src/components/trading-monitor/PerformanceBars.test.ts src/components/trading-monitor/card/DashboardCard.test.ts
```

Expected: both test files PASS with zero failures.

- [ ] **Step 8: Run implementation checks**

Run:

```bash
npx tsc --noEmit
npm run lint
git diff --check
```

Expected: all commands exit 0; no TypeScript, lint, or whitespace errors.

- [ ] **Step 9: Commit the implementation**

```bash
git add src/components/trading-monitor/PerformanceBars.tsx src/components/trading-monitor/PerformanceBars.test.ts src/components/trading-monitor/PerformanceQualityPanel.tsx src/components/trading-monitor/card/DashboardCard.tsx src/components/trading-monitor/card/DashboardCard.test.ts src/app/globals.css
git commit -m "feat: move DD quality gauges into win panel"
```

---

### Task 2: Update Dashboard Contract and Verify Responsive Behaviour

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Final DD panel behaviour from Task 1.
- Produces: Repository guidance mapping MAX to future MAE/MFE and WIN to gauges plus bars.

- [ ] **Step 1: Update the DD sub-panel mapping**

Replace the MAX and WIN rows in `AGENTS.md` with:

```md
| `MAX` | Reserved empty canvas for future MAE/MFE visualization | Maximal drawdown amount (unsigned, red) |
| `WIN` | `PerformanceBars` — Sharpe/Profit Factor/Recovery gauges above streak and trade-size bars | Win rate % (≥70 green, ≥50 neutral, <50 amber) |
```

- [ ] **Step 2: Verify the production build**

Run `npm run build`.

Expected: Next.js production build exits 0.

- [ ] **Step 3: Verify portrait and landscape in a real browser**

Use the repository Playwright workflow at `390 × 844` and `844 × 390`. At both viewports confirm WIN shows the three gauges in one row above the bars without horizontal overflow, MAX stays selected with a blank canvas, and account ordering plus surrounding chart/KPI layout remain unchanged.

- [ ] **Step 4: Run final verification**

Run:

```bash
node --import tsx --test src/components/trading-monitor/PerformanceBars.test.ts src/components/trading-monitor/card/DashboardCard.test.ts
npm run lint
npm run build
git diff --check
git status --short
```

Expected: tests, lint, and build exit 0; `git diff --check` has no output; status shows only the planned `AGENTS.md` documentation change.

- [ ] **Step 5: Commit the documentation update**

```bash
git add AGENTS.md
git commit -m "docs: reserve DD max panel for MAE MFE"
```
