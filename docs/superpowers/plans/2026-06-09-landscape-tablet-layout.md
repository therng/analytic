# Landscape & Tablet Layout Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยก layout tier สำหรับ mobile landscape (fix overflow), tablet landscape (2-col 38%), และ tablet portrait (2-col overview grid) ออกจาก breakpoint เดิมที่รวมทุกอย่างไว้ใน `600–1023px`

**Architecture:** สร้าง `deriveLayoutTier()` utility ที่ derive responsive state จาก single evaluation (width + orientation) แทน independent `matchMedia` listeners — ป้องกัน race condition บน iOS. `TabletPortraitOverview` component ใหม่ mount แทน account list ใน root `DashboardClient` เมื่อ tier คือ `tablet-portrait`. CSS fixes เป็น CSS-only ไม่แตะ JSX โครงสร้างเดิม.

**Tech Stack:** Next.js App Router, React 19, TypeScript, framer-motion, Tailwind/CSS custom classes, Node.js built-in test runner (`node --import tsx --test`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/layoutTier.ts` | **Create** | `deriveLayoutTier()` pure fn + `useLayoutTier()` hook |
| `src/lib/layoutTier.test.ts` | **Create** | Unit tests for `deriveLayoutTier()` |
| `src/components/trading-monitor/DashboardClient.tsx` | **Modify** | Replace dual `isDesktop`/`isLandscape` states → `useLayoutTier()`; add `TabletPortraitOverview` render branch at root; add `forcePortrait` prop to `DashboardCard` |
| `src/app/globals.css` | **Modify** | Split `600–1023px` block → 3 separate blocks; add `account-card--tablet-landscape`; fix fluid tokens |
| `src/components/trading-monitor/TabletPortraitOverview.tsx` | **Create** | `TabletPortraitOverview`, `TabletPortraitGrid`, `TabletAccountDetail` components |

---

## Task 1: `deriveLayoutTier` utility + tests

**Files:**
- Create: `src/lib/layoutTier.ts`
- Create: `src/lib/layoutTier.test.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// src/lib/layoutTier.ts

export type LayoutTier =
  | "mobile-portrait"
  | "mobile-landscape"
  | "tablet-portrait"
  | "tablet-landscape"
  | "desktop";

/**
 * Derives the responsive layout tier from a single width + orientation evaluation.
 * Call on every resize/orientationchange to avoid race conditions between
 * independent matchMedia listeners (especially on iOS).
 */
export function deriveLayoutTier(
  width: number,
  isPortrait: boolean
): LayoutTier {
  if (width >= 1024) return "desktop";
  if (width >= 768 && isPortrait) return "tablet-portrait";
  if (width >= 768 && !isPortrait) return "tablet-landscape";
  if (width >= 600) return "mobile-landscape";
  return "mobile-portrait";
}
```

- [ ] **Step 2: Create the test file**

```typescript
// src/lib/layoutTier.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveLayoutTier } from "./layoutTier.ts";

describe("deriveLayoutTier", () => {
  // Desktop
  it("returns desktop at 1024px", () => {
    assert.equal(deriveLayoutTier(1024, true), "desktop");
    assert.equal(deriveLayoutTier(1024, false), "desktop");
  });
  it("returns desktop at 1920px", () => {
    assert.equal(deriveLayoutTier(1920, false), "desktop");
  });

  // Tablet portrait
  it("returns tablet-portrait at 768px portrait", () => {
    assert.equal(deriveLayoutTier(768, true), "tablet-portrait");
  });
  it("returns tablet-portrait at 1023px portrait", () => {
    assert.equal(deriveLayoutTier(1023, true), "tablet-portrait");
  });

  // Tablet landscape
  it("returns tablet-landscape at 768px landscape", () => {
    assert.equal(deriveLayoutTier(768, false), "tablet-landscape");
  });
  it("returns tablet-landscape at 1023px landscape", () => {
    assert.equal(deriveLayoutTier(1023, false), "tablet-landscape");
  });

  // Mobile landscape
  it("returns mobile-landscape at 600px", () => {
    assert.equal(deriveLayoutTier(600, false), "mobile-landscape");
    assert.equal(deriveLayoutTier(600, true), "mobile-landscape");
  });
  it("returns mobile-landscape at 767px", () => {
    assert.equal(deriveLayoutTier(767, false), "mobile-landscape");
  });

  // Mobile portrait
  it("returns mobile-portrait at 599px", () => {
    assert.equal(deriveLayoutTier(599, true), "mobile-portrait");
    assert.equal(deriveLayoutTier(599, false), "mobile-portrait");
  });
  it("returns mobile-portrait at 375px", () => {
    assert.equal(deriveLayoutTier(375, true), "mobile-portrait");
  });

  // Boundary: exactly at tier transitions
  it("boundary 767→768 portrait: 767 is mobile-landscape, 768 is tablet-portrait", () => {
    assert.equal(deriveLayoutTier(767, true), "mobile-landscape");
    assert.equal(deriveLayoutTier(768, true), "tablet-portrait");
  });
  it("boundary 1023→1024: 1023 is tablet, 1024 is desktop", () => {
    assert.equal(deriveLayoutTier(1023, false), "tablet-landscape");
    assert.equal(deriveLayoutTier(1024, false), "desktop");
  });

  // Mutually exclusive: only one tier at a time
  it("no two tiers match for same input", () => {
    const tiers = ["desktop", "tablet-portrait", "tablet-landscape", "mobile-landscape", "mobile-portrait"];
    const inputs: Array<[number, boolean]> = [
      [375, true], [600, false], [767, false], [768, true], [1024, false]
    ];
    for (const [w, p] of inputs) {
      const result = deriveLayoutTier(w, p);
      assert.ok(tiers.includes(result), `Unexpected tier ${result} for w=${w} p=${p}`);
    }
  });
});
```

- [ ] **Step 3: Run tests — expect all to PASS**

```bash
node --import tsx --test src/lib/layoutTier.test.ts
```

Expected: `✓ 12 passing`

- [ ] **Step 4: Commit**

```bash
git add src/lib/layoutTier.ts src/lib/layoutTier.test.ts
git commit -m "feat(layout): add deriveLayoutTier utility with boundary tests"
```

---

## Task 2: `useLayoutTier` hook + replace state in `DashboardCard`

**Files:**
- Modify: `src/lib/layoutTier.ts` (add hook)
- Modify: `src/components/trading-monitor/DashboardClient.tsx:152–168` (replace dual state)

- [ ] **Step 1: Add `useLayoutTier` hook to the utility file**

Append to `src/lib/layoutTier.ts`:

```typescript
import { useEffect, useState } from "react";

/**
 * Hook that returns the current layout tier, updated on resize + orientation change.
 * Single-source evaluation — all tiers are mutually exclusive.
 */
export function useLayoutTier(): LayoutTier {
  const [tier, setTier] = useState<LayoutTier>(() => {
    if (typeof window === "undefined") return "mobile-portrait";
    return deriveLayoutTier(
      window.innerWidth,
      window.matchMedia("(orientation: portrait)").matches
    );
  });

  useEffect(() => {
    const update = () => {
      setTier(
        deriveLayoutTier(
          window.innerWidth,
          window.matchMedia("(orientation: portrait)").matches
        )
      );
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return tier;
}
```

- [ ] **Step 2: Replace dual `isDesktop`/`isLandscape` states in `DashboardCard`**

In `src/components/trading-monitor/DashboardClient.tsx`, find the import block at the top and add:

```typescript
import { useLayoutTier } from "@/lib/layoutTier";
```

Then replace lines 152–168:

```typescript
// DELETE these two useEffect blocks:
const [isDesktop, setIsDesktop] = useState(false);
useEffect(() => {
  const mq = window.matchMedia("(min-width: 1024px)");
  setIsDesktop(mq.matches);
  const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}, []);

const [isLandscape, setIsLandscape] = useState(false);
useEffect(() => {
  const mq = window.matchMedia("(min-width: 600px) and (max-width: 1023px)");
  setIsLandscape(mq.matches);
  const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}, []);
```

Replace with:

```typescript
const layoutTier = useLayoutTier();
const isDesktop = layoutTier === "desktop";
const isLandscape = layoutTier === "mobile-landscape";
const isTabletLandscape = layoutTier === "tablet-landscape";
```

- [ ] **Step 3: Update `cardVariant` at line ~622**

Find:
```typescript
const cardVariant = isDesktop ? "account-card--desktop" : "account-card--landscape";
```

Replace with:
```typescript
const cardVariant = isDesktop
  ? "account-card--desktop"
  : isTabletLandscape
  ? "account-card--tablet-landscape"
  : "account-card--landscape";
```

- [ ] **Step 4: Update the API prefetch condition at lines ~197–215**

The condition `(isDesktop || isLandscape)` should now also include `isTabletLandscape`. Find all 3 occurrences:

```typescript
// profitDetail, balanceDetail, pipsSummary all have:
(((isDesktop || isLandscape) && !!overview.data) || expandedKpi === "gain")
```

Replace each with:
```typescript
(((isDesktop || isLandscape || isTabletLandscape) && !!overview.data) || expandedKpi === "gain")
```

Do the same for `expandedKpi === "dd"` and `expandedKpi === "pips"` conditions.

- [ ] **Step 5: Build to verify no type errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` (or similar — no TypeScript errors)

- [ ] **Step 6: Commit**

```bash
git add src/lib/layoutTier.ts src/components/trading-monitor/DashboardClient.tsx
git commit -m "refactor(layout): replace dual isDesktop/isLandscape with useLayoutTier hook"
```

---

## Task 3: CSS — Mobile landscape overflow fix (600–767px)

**Files:**
- Modify: `src/app/globals.css` (split `600–1023px` block, fix tokens)

- [ ] **Step 1: Find the existing landscape block**

Open `src/app/globals.css` and find the block starting at approximately line 3288:

```css
/* ─────────────────────────────────────────────
   LANDSCAPE / TABLET — 600px–1023px
```

- [ ] **Step 2: Replace the entire `600–1023px` block**

Delete from `@media (min-width: 600px) and (max-width: 1023px)` through its closing `}` (approximately lines 3288–3409).

Replace with the following two blocks:

```css
/* ─────────────────────────────────────────────
   MOBILE LANDSCAPE — 600px–767px
   2-column: chart+KPI left | panel right
   Fluid heights prevent overflow on short screens
─────────────────────────────────────────────── */
@media (min-width: 600px) and (max-width: 767px) {
  .monitor-page {
    overflow: hidden;
    height: 100dvh;
  }

  .app-scroll {
    height: 100dvh;
    overflow-y: auto;
    padding: 8px 10px;
  }

  .dashboard-section {
    gap: 10px;
  }

  .dashboard-section > .account-card.account-card--landscape {
    --dc-pad-x:     clamp(8px, 1.2vw, 12px);
    --dc-pad-y:     clamp(8px, 1vh,   12px);
    --dc-gap:       clamp(5px, 0.8vw,  8px);
    --dc-chart-h:   clamp(90px, 18vh, 130px);
    --dc-divider:   0.5px solid rgba(255,255,255,0.07);
    --dc-botpnl-h:  clamp(80px, 18vh, 140px);
    --dc-heatmap-h: clamp(60px, 14vh, 110px);
  }

  .dashboard-section > .account-card.account-card--landscape {
    display: grid !important;
    height: calc(100dvh - 16px);
    max-height: calc(100dvh - 16px);
    grid-template-columns: 1fr clamp(180px, 36%, 260px);
    grid-template-rows: minmax(0, 1fr) var(--dc-botpnl-h) var(--dc-heatmap-h);
    grid-template-areas:
      "middle right"
      "botpnl right"
      "heatmap right";
    padding: 0 !important;
    gap: 0 !important;
    overflow: hidden;
    container-type: inline-size;
    container-name: account-card;
    align-items: stretch;
  }

  .account-card--landscape .dc-middle { grid-area: middle; border-right: var(--dc-divider); }
  .account-card--landscape .dc-right  {
    grid-area: right;
    grid-row: 1 / span 3;
    height: 100%;
    overflow: hidden;
  }
  .account-card--landscape .dc-botpnl  { grid-area: botpnl;  border-top: var(--dc-divider); border-right: var(--dc-divider); }
  .account-card--landscape .dc-heatmap { grid-area: heatmap; border-top: var(--dc-divider); border-right: var(--dc-divider); }

  .account-card--landscape .dc-middle,
  .account-card--landscape .dc-right {
    display: flex;
    flex-direction: column;
    gap: var(--dc-gap);
    padding: var(--dc-pad-y) var(--dc-pad-x);
    overflow-x: hidden;
    overflow-y: hidden;
    scrollbar-width: none;
    min-height: 0;
    align-self: stretch;
  }

  .account-card--landscape .dc-botpnl {
    padding: var(--dc-pad-y) var(--dc-pad-x);
    height: var(--dc-botpnl-h);
    min-height: 0;
    overflow: hidden;
  }
  .account-card--landscape .dc-botpnl .bot-pnl-panel { height: 100%; }

  .account-card--landscape .dc-heatmap {
    padding: var(--dc-pad-y) var(--dc-pad-x);
    height: var(--dc-heatmap-h);
    min-height: 0;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }
  .account-card--landscape .dc-heatmap .profit-heatmap-panel { flex: 1; min-height: 0; }

  .account-card--landscape .sp-canvas {
    height: var(--dc-chart-h);
    flex-shrink: 0;
  }
  .account-card--landscape .sp-canvas .sparkline-chart,
  .account-card--landscape .sp-canvas__chart {
    height: var(--dc-chart-h);
  }

  .account-card--landscape .dc-right-panel {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
  }
  .account-card--landscape .dc-right-panel .open-positions-panel,
  .account-card--landscape .dc-right-panel .trade-history-panel {
    flex: 1;
    min-height: 0;
  }

  .account-card--landscape .dc-metrics-grid {
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr)) !important;
  }

  .account-card--landscape .kgrid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .account-card--landscape .sp-canvas-stack {
    min-height: unset;
  }
}

/* Very short screens (e.g. iPhone SE landscape 568px tall) — merge BotPnL+Heatmap */
@media (min-width: 600px) and (max-width: 767px) and (max-height: 500px) {
  .dashboard-section > .account-card.account-card--landscape {
    grid-template-rows: minmax(0, 1fr) clamp(70px, 22vh, 120px);
    grid-template-areas:
      "middle right"
      "lower  right";
  }
  .account-card--landscape .dc-botpnl  { grid-area: lower; border-top: var(--dc-divider); border-right: var(--dc-divider); height: auto; }
  .account-card--landscape .dc-heatmap { display: none; }
}
```

- [ ] **Step 3: Build to verify CSS is valid**

```bash
npm run build 2>&1 | tail -10
```

Expected: no CSS parse errors

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "fix(css): split landscape breakpoint, fix mobile landscape overflow with fluid clamp heights"
```

---

## Task 4: CSS — Tablet landscape class (768–1023px landscape)

**Files:**
- Modify: `src/app/globals.css` (add new block after the mobile landscape block)

- [ ] **Step 1: Insert tablet landscape block immediately after the mobile landscape blocks**

Find the comment line `/* ─────────────────────────────────────────────` that precedes `DESKTOP LAYOUT — min-width: 1024px` and insert before it:

```css
/* ─────────────────────────────────────────────
   TABLET LANDSCAPE — 768px–1023px landscape
   2-column: 62% main | 38% panel
   BotPnL + Heatmap side-by-side (fluid)
─────────────────────────────────────────────── */
@media (min-width: 768px) and (max-width: 1023px) and (orientation: landscape) {
  .monitor-page {
    overflow: hidden;
    height: 100dvh;
  }

  .app-scroll {
    height: 100dvh;
    overflow-y: auto;
    padding: 8px 10px;
  }

  .dashboard-section {
    gap: 10px;
  }

  .dashboard-section > .account-card.account-card--tablet-landscape {
    --dc-pad-x:     clamp(8px, 1vw,  12px);
    --dc-pad-y:     clamp(8px, 1vh,  12px);
    --dc-gap:       clamp(5px, 0.7vw, 9px);
    --dc-chart-h:   clamp(100px, 20vh, 150px);
    --dc-divider:   0.5px solid rgba(255,255,255,0.07);
    --dc-botpnl-h:  clamp(90px, 16vh, 140px);
    --dc-heatmap-h: clamp(70px, 13vh, 120px);
  }

  .dashboard-section > .account-card.account-card--tablet-landscape {
    display: grid !important;
    height: calc(100dvh - 16px);
    max-height: calc(100dvh - 16px);
    grid-template-columns: 1fr 38%;
    grid-template-rows: minmax(0, 1fr) var(--dc-botpnl-h) var(--dc-heatmap-h);
    grid-template-areas:
      "middle right"
      "botpnl right"
      "heatmap right";
    padding: 0 !important;
    gap: 0 !important;
    overflow: hidden;
    container-type: inline-size;
    container-name: account-card;
    align-items: stretch;
  }

  .account-card--tablet-landscape .dc-middle { grid-area: middle; border-right: var(--dc-divider); }
  .account-card--tablet-landscape .dc-right  {
    grid-area: right;
    grid-row: 1 / span 3;
    height: 100%;
    overflow: hidden;
  }
  .account-card--tablet-landscape .dc-botpnl  { grid-area: botpnl;  border-top: var(--dc-divider); border-right: var(--dc-divider); }
  .account-card--tablet-landscape .dc-heatmap { grid-area: heatmap; border-top: var(--dc-divider); border-right: var(--dc-divider); }

  .account-card--tablet-landscape .dc-middle,
  .account-card--tablet-landscape .dc-right {
    display: flex;
    flex-direction: column;
    gap: var(--dc-gap);
    padding: var(--dc-pad-y) var(--dc-pad-x);
    overflow: hidden;
    scrollbar-width: none;
    min-height: 0;
    align-self: stretch;
  }

  .account-card--tablet-landscape .dc-botpnl {
    padding: var(--dc-pad-y) var(--dc-pad-x);
    height: var(--dc-botpnl-h);
    min-height: 0;
    overflow: hidden;
  }
  .account-card--tablet-landscape .dc-botpnl .bot-pnl-panel { height: 100%; }

  .account-card--tablet-landscape .dc-heatmap {
    padding: var(--dc-pad-y) var(--dc-pad-x);
    height: var(--dc-heatmap-h);
    min-height: 0;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }
  .account-card--tablet-landscape .dc-heatmap .profit-heatmap-panel { flex: 1; min-height: 0; }

  .account-card--tablet-landscape .sp-canvas {
    height: var(--dc-chart-h);
    flex-shrink: 0;
  }
  .account-card--tablet-landscape .sp-canvas .sparkline-chart,
  .account-card--tablet-landscape .sp-canvas__chart {
    height: var(--dc-chart-h);
  }

  .account-card--tablet-landscape .dc-right-panel {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    display: flex;
    flex-direction: column;
  }
  .account-card--tablet-landscape .dc-right-panel .open-positions-panel,
  .account-card--tablet-landscape .dc-right-panel .trade-history-panel {
    flex: 1;
    min-height: 0;
  }

  .account-card--tablet-landscape .kgrid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .account-card--tablet-landscape .sp-canvas-stack {
    min-height: unset;
  }

  .account-card--tablet-landscape .dc-metrics-grid {
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr)) !important;
  }
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(css): add account-card--tablet-landscape with 38% right panel and fluid tokens"
```

---

## Task 5: `TabletPortraitOverview` — grid view component

**Files:**
- Create: `src/components/trading-monitor/TabletPortraitOverview.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// src/components/trading-monitor/TabletPortraitOverview.tsx
"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SerializedAccount } from "@/lib/trading/types";
import { SparklineChart } from "@/components/trading-monitor/shared";
import { useRealtimeAccount } from "@/hooks/useRealtimeAccount";
import { displayName, toneFromNumber, formatCurrency, formatCompactSignedNumber, formatCompactCount } from "@/components/trading-monitor/formatters";
import { formatCompactPercent } from "@/components/trading-monitor/DashboardFormatters";
import { useApiResource } from "@/components/trading-monitor/useApiResource";
import type { AccountOverviewResponse } from "@/lib/trading/types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TabletPortraitOverviewProps {
  accounts: SerializedAccount[];
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
}

// ─── Root component ───────────────────────────────────────────────────────────

export function TabletPortraitOverview({
  accounts,
  refreshKey,
  onRequestStateChange,
}: TabletPortraitOverviewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="tablet-overview-root">
      <AnimatePresence mode="wait">
        {expandedId ? (
          <motion.div
            key="detail"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="tablet-detail-wrap"
          >
            <TabletAccountDetail
              accountId={expandedId}
              accounts={accounts}
              refreshKey={refreshKey}
              onRequestStateChange={onRequestStateChange}
              onBack={() => setExpandedId(null)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <TabletPortraitGrid
              accounts={accounts}
              refreshKey={refreshKey}
              onRequestStateChange={onRequestStateChange}
              onSelect={setExpandedId}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Grid view ────────────────────────────────────────────────────────────────

interface TabletPortraitGridProps {
  accounts: SerializedAccount[];
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  onSelect: (id: string) => void;
}

function TabletPortraitGrid({ accounts, refreshKey, onRequestStateChange, onSelect }: TabletPortraitGridProps) {
  return (
    <div className="tablet-overview-grid" role="list" aria-label="Trading accounts">
      {accounts.map((account) => (
        <TabletOverviewCard
          key={account.id}
          account={account}
          refreshKey={refreshKey}
          onRequestStateChange={onRequestStateChange}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────

interface TabletOverviewCardProps {
  account: SerializedAccount;
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  onSelect: (id: string) => void;
}

function TabletOverviewCard({ account, refreshKey, onRequestStateChange, onSelect }: TabletOverviewCardProps) {
  useRealtimeAccount(account.id);

  const overview = useApiResource<AccountOverviewResponse>(
    `/api/accounts/${account.id}?timeframe=1d`,
    { refreshKey, onRequestStateChange }
  );

  const accountSource = overview.data?.account ?? account;
  const active = accountSource.status === "Active";
  const growth = overview.data?.kpis.periodGrowth;
  const growthTone = toneFromNumber(growth);
  const pips = overview.data?.kpis.netPips;
  const trades = overview.data?.kpis.totalTrades;
  const sparklinePoints = overview.data?.balanceCurve.length
    ? overview.data.balanceCurve
    : [{ x: "0", y: 0 }];

  return (
    <button
      className={`tablet-overview-card tone-${growthTone} ${active ? "is-active" : "is-inactive"}`}
      role="listitem"
      aria-label={`${displayName(accountSource)} — tap to view details`}
      onClick={() => onSelect(account.id)}
    >
      {/* Header row */}
      <div className="toc-header">
        <span className="toc-name">{displayName(accountSource)}</span>
        <span
          className={`toc-beacon ${active ? "is-active" : ""}`}
          aria-label={active ? "Active" : "Inactive"}
        />
      </div>

      {/* Sparkline */}
      <div className="toc-chart" aria-hidden="true">
        {overview.loading && !overview.data ? (
          <div className="skeleton-chart" style={{ height: 32 }} />
        ) : (
          <SparklineChart
            points={sparklinePoints}
            tone={growthTone}
            height={32}
          />
        )}
      </div>

      {/* Balance */}
      <div className="toc-balance">
        {overview.data
          ? formatCurrency(accountSource.balance ?? 0, 2)
          : "—"}
      </div>

      {/* KPI chips */}
      <div className="toc-chips">
        <span className={`toc-chip tone-${growthTone}`}>
          {growth != null ? formatCompactPercent(growth) : "—"}
        </span>
        <span className={`toc-chip tone-${toneFromNumber(pips)}`}>
          {pips != null ? `${formatCompactSignedNumber(pips, 0)}p` : "—"}
        </span>
        <span className="toc-chip tone-muted">
          {trades != null ? `${formatCompactCount(trades)}T` : "—"}
        </span>
      </div>
    </button>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

interface TabletAccountDetailProps {
  accountId: string;
  accounts: SerializedAccount[];
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  onBack: () => void;
}

function TabletAccountDetail({ accountId, accounts, refreshKey, onRequestStateChange, onBack }: TabletAccountDetailProps) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  return (
    <div className="tablet-detail-view">
      <button className="tablet-back-bar" onClick={onBack} aria-label="Back to account list">
        <span className="tablet-back-arrow">←</span>
        <span className="tablet-back-label">บัญชีทั้งหมด</span>
      </button>
      {/* Rendered by the parent DashboardClient as a forced-portrait card */}
      <div data-tablet-detail-account-id={accountId} data-refresh-key={refreshKey} />
    </div>
  );
}
```

> **Note:** `TabletAccountDetail` renders a placeholder `<div>` with data attributes. Task 6 wires up the actual `DashboardCard` with `forcePortrait` prop.

- [ ] **Step 2: Add CSS for the grid to `globals.css`**

Add at the end of the file (before any final closing blocks):

```css
/* ─────────────────────────────────────────────
   TABLET PORTRAIT OVERVIEW — grid + detail
─────────────────────────────────────────────── */
@media (min-width: 768px) and (max-width: 1023px) and (orientation: portrait) {
  .tablet-overview-root {
    height: 100dvh;
    overflow: hidden;
    position: relative;
  }

  .tablet-overview-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px;
    overflow-y: auto;
    height: 100dvh;
    scrollbar-width: none;
  }

  .tablet-overview-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: var(--card-bg, rgba(255,255,255,0.04));
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    min-height: 140px;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .tablet-overview-card:active {
    background: rgba(255,255,255,0.07);
  }
  .tablet-overview-card.tone-positive { border-color: rgba(52,211,153,0.3); }
  .tablet-overview-card.tone-negative { border-color: rgba(239,68,68,0.3); }

  .toc-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .toc-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #e2e8f0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .toc-beacon {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #475569;
    flex-shrink: 0;
  }
  .toc-beacon.is-active {
    background: #34d399;
    box-shadow: 0 0 5px rgba(52,211,153,0.6);
  }
  .toc-chart {
    height: 32px;
    flex-shrink: 0;
  }
  .toc-balance {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary, #e2e8f0);
    font-family: var(--font-mono, monospace);
  }
  .toc-chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: auto;
  }
  .toc-chip {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255,255,255,0.07);
    color: #94a3b8;
  }
  .toc-chip.tone-positive { background: rgba(52,211,153,0.12); color: #34d399; }
  .toc-chip.tone-negative { background: rgba(239,68,68,0.1);  color: #fca5a5; }

  /* Detail view */
  .tablet-detail-wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .tablet-detail-view {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
  }
  .tablet-back-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: rgba(255,255,255,0.04);
    border: none;
    border-bottom: 0.5px solid rgba(255,255,255,0.08);
    cursor: pointer;
    min-height: 44px;
    width: 100%;
    text-align: left;
  }
  .tablet-back-arrow {
    font-size: 16px;
    color: #60a5fa;
  }
  .tablet-back-label {
    font-size: 13px;
    color: #94a3b8;
  }
}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/components/trading-monitor/TabletPortraitOverview.tsx src/app/globals.css
git commit -m "feat(tablet): add TabletPortraitOverview grid view with CSS"
```

---

## Task 6: Wire `DashboardCard` with `forcePortrait` + fix `TabletAccountDetail`

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx` (add `forcePortrait` prop)
- Modify: `src/components/trading-monitor/TabletPortraitOverview.tsx` (use real DashboardCard)

- [ ] **Step 1: Add `forcePortrait` prop to `DashboardCard`**

In `DashboardClient.tsx`, find the `DashboardCard` props interface (~line 142):

```typescript
const DashboardCard = memo(function DashboardCard({
  account,
  refreshKey,
  onRequestStateChange,
}: {
  account: SerializedAccount;
  refreshKey: number;
  onRequestStateChange: (request: { loading: boolean; refreshKey: number }) => void;
})
```

Replace with:

```typescript
const DashboardCard = memo(function DashboardCard({
  account,
  refreshKey,
  onRequestStateChange,
  forcePortrait = false,
}: {
  account: SerializedAccount;
  refreshKey: number;
  onRequestStateChange: (request: { loading: boolean; refreshKey: number }) => void;
  forcePortrait?: boolean;
})
```

- [ ] **Step 2: Use `forcePortrait` to override `layoutTier` in `DashboardCard`**

Find the `layoutTier` hook call (~line 152, after Task 2):

```typescript
const layoutTier = useLayoutTier();
const isDesktop = layoutTier === "desktop";
const isLandscape = layoutTier === "mobile-landscape";
const isTabletLandscape = layoutTier === "tablet-landscape";
```

Replace with:

```typescript
const detectedTier = useLayoutTier();
const layoutTier = forcePortrait ? "mobile-portrait" : detectedTier;
const isDesktop = layoutTier === "desktop";
const isLandscape = layoutTier === "mobile-landscape";
const isTabletLandscape = layoutTier === "tablet-landscape";
```

- [ ] **Step 3: Propagate `forcePortrait` through `LazyDashboardCard`**

Find `LazyDashboardCard` (~line 1202):

```typescript
function LazyDashboardCard({
  account,
  index,
  refreshKey,
  onRequestStateChange,
}: {
  account: SerializedAccount;
  index: number;
  refreshKey: number;
  onRequestStateChange: (request: { loading: boolean; refreshKey: number }) => void;
})
```

Replace with:

```typescript
function LazyDashboardCard({
  account,
  index,
  refreshKey,
  onRequestStateChange,
  forcePortrait = false,
}: {
  account: SerializedAccount;
  index: number;
  refreshKey: number;
  onRequestStateChange: (request: { loading: boolean; refreshKey: number }) => void;
  forcePortrait?: boolean;
})
```

Find inside `LazyDashboardCard` where `DashboardCard` is rendered (~line 1225):

```tsx
<DashboardCard
  account={account}
  refreshKey={refreshKey}
  onRequestStateChange={onRequestStateChange}
/>
```

Replace with:

```tsx
<DashboardCard
  account={account}
  refreshKey={refreshKey}
  onRequestStateChange={onRequestStateChange}
  forcePortrait={forcePortrait}
/>
```

- [ ] **Step 4: Update `TabletAccountDetail` to accept `renderCard` render prop**

`TabletPortraitOverview.tsx` must NOT import from `DashboardClient.tsx` (circular dependency — each imports the other). Use a render prop instead.

In `TabletPortraitOverview.tsx`, update the `TabletPortraitOverviewProps` interface and all downstream interfaces:

```tsx
// Update props interface at top of TabletPortraitOverview.tsx
interface TabletPortraitOverviewProps {
  accounts: SerializedAccount[];
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  renderCard: (account: SerializedAccount) => React.ReactNode;
}

// Update TabletAccountDetailProps
interface TabletAccountDetailProps {
  accountId: string;
  accounts: SerializedAccount[];
  onBack: () => void;
  renderCard: (account: SerializedAccount) => React.ReactNode;
}
```

Update `TabletPortraitOverview` to pass `renderCard` through:

```tsx
export function TabletPortraitOverview({
  accounts,
  refreshKey,
  onRequestStateChange,
  renderCard,
}: TabletPortraitOverviewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="tablet-overview-root">
      <AnimatePresence mode="wait">
        {expandedId ? (
          <motion.div
            key="detail"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="tablet-detail-wrap"
          >
            <TabletAccountDetail
              accountId={expandedId}
              accounts={accounts}
              onBack={() => setExpandedId(null)}
              renderCard={renderCard}
            />
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <TabletPortraitGrid
              accounts={accounts}
              refreshKey={refreshKey}
              onRequestStateChange={onRequestStateChange}
              onSelect={setExpandedId}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

Replace `TabletAccountDetail` implementation:

```tsx
function TabletAccountDetail({ accountId, accounts, onBack, renderCard }: TabletAccountDetailProps) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  return (
    <div className="tablet-detail-view">
      <button className="tablet-back-bar" onClick={onBack} aria-label="Back to account list">
        <span className="tablet-back-arrow">←</span>
        <span className="tablet-back-label">บัญชีทั้งหมด</span>
      </button>
      <div className="tablet-detail-scroll app-scroll">
        {renderCard(account)}
      </div>
    </div>
  );
}
```

Add CSS for the scroll container in `globals.css` inside the tablet portrait media query:

```css
  .tablet-detail-scroll {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: none;
  }
```

- [ ] **Step 5: Build to verify**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/components/trading-monitor/DashboardClient.tsx \
        src/components/trading-monitor/TabletPortraitOverview.tsx \
        src/app/globals.css
git commit -m "feat(tablet): wire DashboardCard forcePortrait + TabletAccountDetail detail view"
```

---

## Task 7: Wire `TabletPortraitOverview` into root `DashboardClient`

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx` (root `DashboardClient` function)

- [ ] **Step 1: Add `useLayoutTier` hook to root `DashboardClient`**

In `DashboardClient.tsx`, find the root `export default function DashboardClient()` (~line 1231). Find where state is declared near the top of that function and add after existing state:

```typescript
const rootTier = useLayoutTier();
const isTabletPortrait = rootTier === "tablet-portrait";
```

- [ ] **Step 2: Add `TabletPortraitOverview` import**

At the top of `DashboardClient.tsx`, add:

```typescript
import { TabletPortraitOverview } from "@/components/trading-monitor/TabletPortraitOverview";
```

- [ ] **Step 3: Add render branch inside `dashboard-section`**

Find (~line 1487):

```tsx
<section className="dashboard-section" aria-label="Trading accounts">
  {initialAnimationDone && accounts.data?.length ? (
    accounts.data.map((account, index) => (
      <LazyDashboardCard
        key={account.id}
        account={account}
        index={index}
        refreshKey={refreshKey}
        onRequestStateChange={handleRequestStateChange}
      />
    ))
  ) : null}
</section>
```

Replace with:

```tsx
<section className="dashboard-section" aria-label="Trading accounts">
  {initialAnimationDone && accounts.data?.length ? (
    isTabletPortrait ? (
      <TabletPortraitOverview
        accounts={accounts.data}
        refreshKey={refreshKey}
        onRequestStateChange={handleRequestStateChange}
        renderCard={(account) => (
          <DashboardCard
            account={account}
            refreshKey={refreshKey}
            onRequestStateChange={handleRequestStateChange}
            forcePortrait
          />
        )}
      />
    ) : (
      accounts.data.map((account, index) => (
        <LazyDashboardCard
          key={account.id}
          account={account}
          index={index}
          refreshKey={refreshKey}
          onRequestStateChange={handleRequestStateChange}
        />
      ))
    )
  ) : null}
</section>
```

- [ ] **Step 4: Build to verify**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 5: Lint check**

```bash
npm run lint 2>&1 | tail -20
```

Expected: no errors

- [ ] **Step 6: Run unit tests**

```bash
node --import tsx --test src/lib/layoutTier.test.ts
```

Expected: all 12 tests pass

- [ ] **Step 7: Commit**

```bash
git add src/components/trading-monitor/DashboardClient.tsx
git commit -m "feat(tablet): mount TabletPortraitOverview at root when tier is tablet-portrait"
```

---

## Task 8: Manual verification checklist

**No code changes — verification only**

- [ ] **Start dev server**

```bash
npm run dev
```

- [ ] **Mobile landscape — iPhone SE size (375×568 simulated)**

Open DevTools → device emulator → set 375×568 (landscape). Verify:
- BotPnL does not overflow viewport
- Heatmap does not overflow viewport
- Right panel visible and not clipped
- Layout class `account-card--landscape` applied (check DevTools)

- [ ] **Mobile landscape — iPhone 14 Pro (390×844 rotated to 844×390)**

Set 844×390 landscape. Verify:
- BotPnL height ~70px (fluid, fits), Heatmap ~54px
- KPI chips all visible, no text clipped

- [ ] **Tablet landscape — iPad Mini (1024×768)**

Set 1024×768 landscape (note: this hits `≥1024px` desktop — test with 900×600 landscape to hit `768–1023` range). Verify:
- Class `account-card--tablet-landscape` applied
- Right panel occupies ~38% of width (~342px at 900px)
- BotPnL + Heatmap visible as separate rows

- [ ] **Tablet portrait — iPad portrait (768×1024)**

Set 768×1024 portrait. Verify:
- `TabletPortraitOverview` renders (2-col grid of cards)
- Each card shows: name, sparkline, balance, 3 KPI chips
- Tap a card → slides in from right to account detail
- Account detail shows full portrait card with timeframe strip
- Tap ← back → slides back to grid
- Grid scroll position preserved after back

- [ ] **Orientation change — iPad**

Start in portrait (768×1024), verify grid shown. Rotate to landscape (1024×768 — becomes desktop) or use 900-width to stay in tablet tier. Verify layout switches without double-render or flicker.

- [ ] **Desktop (1440px) — regression check**

Set 1440×900. Verify:
- `account-card--desktop` still renders (3-col)
- No visual regressions

- [ ] **Final build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass

- [ ] **Commit with summary**

```bash
git add .
git commit -m "chore: post-verification — landscape + tablet layout improvement complete"
```

---

## Summary

| Task | Files | Complexity |
|------|-------|-----------|
| 1: `deriveLayoutTier` utility + tests | `layoutTier.ts`, `layoutTier.test.ts` | Low |
| 2: Replace dual state → `useLayoutTier` | `DashboardClient.tsx` | Medium |
| 3: CSS mobile landscape fix | `globals.css` | Medium |
| 4: CSS tablet landscape class | `globals.css` | Low |
| 5: `TabletPortraitOverview` grid view | `TabletPortraitOverview.tsx`, `globals.css` | High |
| 6: `forcePortrait` + `TabletAccountDetail` | `DashboardClient.tsx`, `TabletPortraitOverview.tsx` | Medium |
| 7: Wire into root `DashboardClient` | `DashboardClient.tsx` | Low |
| 8: Manual verification | — | — |
