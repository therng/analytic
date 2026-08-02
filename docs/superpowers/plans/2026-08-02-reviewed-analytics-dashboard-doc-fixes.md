# Reviewed Analytics, Dashboard, and Documentation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the reviewed metric metadata and trading-deal classification defects, restore dashboard token/touch-target compliance, and reconcile `AGENTS.md` with verified implementation behavior.

**Architecture:** Keep the changes incremental and within existing files. Metric metadata remains declarative in the registry, deal classification rejects funding types before using MT5 symbol/direction evidence, dashboard sizing remains CSS-owned, and repository guidance describes the current code without changing runtime contracts.

**Tech Stack:** TypeScript, Node.js test runner, Next.js 16, CSS, Playwright, Markdown.

## Global Constraints

- Preserve unrelated dirty files in the original checkout; work only in `/private/tmp/analytic-reviewed-fixes`.
- Do not modify `package-lock.json`, `.agents/skills/pipeline-health-check/SKILL.md`, `_workspace/02_review_analytics.md`, or `_workspace/02_review_ingestion.md`.
- `Deal` is authoritative for gain and balance drawdown; `Position` is authoritative for closed-trade pips/counts; `OpenPosition` and current snapshots/Redis are authoritative for live exposure.
- `positionNetPnl = profit + swap + commission`.
- Keep the chart-first portrait and landscape layouts unchanged; interactive targets must be at least `44px` by `44px`.
- Use design-system CSS variables, not Tailwind default colors or duplicated token literals.
- The Bridge publishes raw MT5 broker-server epochs; the worker converts them to UTC exactly once with the configured broker offset.
- No Prisma, migration, Redis protocol, Bridge runtime, API response, dependency, or deployment changes.
- Use TDD for TypeScript and observable CSS behavior changes. Human-facing documentation prose does not receive source-text tests.
- Run focused tests first, then `npm run lint`, `npx tsc --noEmit`, and `npm run build` before completion.

---

### Task 1: Complete the dashboard metric registry contract

**Files:**
- Modify: `src/lib/trading/metric-registry.ts`
- Test: `src/lib/trading/metric-registry.test.ts`

**Interfaces:**
- Consumes: `AccountOverviewResponse.kpis`, `SerializedAccount`, live Redis snapshot fields, and existing `DashboardCard` display locations.
- Produces: `DashboardMetricDescriptor` with required `source`, `formula`, `apiField`, and `displayTarget` strings for every registered metric.

- [ ] **Step 1: Write the failing contract tests**

Add tests that require all descriptor contract fields, correct DD semantics, and removal of the unused volume-derived deposit-load descriptor:

```typescript
test("every registered dashboard metric documents its data contract", () => {
  for (const metric of DASHBOARD_METRICS) {
    for (const field of ["source", "formula", "apiField", "displayTarget"] as const) {
      assert.equal(
        typeof metric[field],
        "string",
        `${metric.id}.${field} must be documented`,
      );
      assert.ok(metric[field].trim(), `${metric.id}.${field} must be non-empty`);
    }
  }
});

test("relative drawdown documents the scoped Deal balance curve", () => {
  const metric = getDashboardMetric("dd");
  assert.ok(metric);
  assert.equal(metric.meta, "Balance curve");
  assert.equal(metric.source, "Deal");
  assert.equal(metric.apiField, "overview.kpis.drawdown");
});

test("registry excludes metrics that have no display target", () => {
  assert.equal(getDashboardMetric("deposit-load-by-volume"), null);
});
```

- [ ] **Step 2: Run the metric registry test and verify RED**

Run: `node --import tsx --test src/lib/trading/metric-registry.test.ts`

Expected: FAIL because existing descriptors omit contract fields, DD says `Max floating`, and `deposit-load-by-volume` is still registered.

- [ ] **Step 3: Make the descriptor contract required and fill exact mappings**

Change the interface fields to required strings:

```typescript
export interface DashboardMetricDescriptor {
  id: string;
  label: string;
  meta?: string;
  hint?: string;
  source: string;
  formula: string;
  apiField: string;
  displayTarget: string;
}
```

Keep the existing complete mappings for `max-balance-drawdown` and `max-deposit-load`. Remove `deposit-load-by-volume` because `account.deposit_load_pct` is produced but has no current UI display target. Fill the other entries with these exact mappings:

| id | source | formula | apiField | displayTarget |
| --- | --- | --- | --- | --- |
| `gain` | `Deal` | `Sum profit + swap + commission for scoped trading deals, excluding balance operations` | `overview.kpis.netProfit` | `GAIN KPI chip` |
| `dd` | `Deal` | `Maximum peak-to-valley balance decline divided by peak balance over the scoped balance curve` | `overview.kpis.drawdown` | `DD KPI chip` |
| `pips` | `Position` | `Sum net pips from scoped closed positions` | `overview.kpis.netPips` | `PIPS KPI chip` |
| `trades` | `Position` | `Count scoped closed positions` | `overview.kpis.trades` | `TRADES KPI chip` |
| `opens` | `OpenPosition` | `Count current open positions, preferring the fresher live position snapshot` | `overview.kpis.openCount` | `OPENS KPI chip` |
| `commission` | `Deal` | `Sum commission for scoped trading deals` | `overview.kpis.totalCommission` | `GAIN detail COMM. chip` |
| `swap` | `Deal` | `Sum swap for scoped trading deals` | `overview.kpis.totalSwap` | `GAIN detail SWAP chip` |
| `deposit` | `Deal` | `Sum positive scoped deposit balance operations` | `overview.kpis.totalDeposit` | `GAIN detail DEPOS. chip` |
| `withdrawal` | `Deal` | `Sum absolute values of negative scoped withdrawal balance operations` | `overview.kpis.totalWithdrawal` | `GAIN detail WITHD. chip` |
| `floating-pl` | `OpenPosition / AccountSnapshot / Redis` | `Current floating profit or loss from the freshest live snapshot` | `account.floating_pl` | `OPENS detail P/L chip` |
| `margin` | `AccountSnapshot / Redis` | `Current broker-reported used margin from the freshest live snapshot` | `account.margin` | `OPENS detail MARGIN chip` |
| `free-margin` | `AccountSnapshot / Redis` | `Current free margin, falling back to equity minus used margin` | `live.freeMargin / account.equity - account.margin` | `OPENS detail FREE chip` |
| `margin-level` | `AccountSnapshot / Redis` | `Current broker-reported margin level percentage from the freshest live snapshot` | `account.margin_level` | `OPENS detail LEVEL chip` |

Set `dd.meta` to `Balance curve`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --import tsx --test src/lib/trading/metric-registry.test.ts src/components/trading-monitor/card/DashboardCard.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/metric-registry.ts src/lib/trading/metric-registry.test.ts
git commit -m "fix: document dashboard metric contracts"
```

---

### Task 2: Reject balance operations before MT5 trade evidence

**Files:**
- Modify: `src/lib/trading/analytics/deal-kernel.ts`
- Test: `src/lib/trading/analytics.test.ts`

**Interfaces:**
- Consumes: `isTradingDeal(typeOrDeal, direction?, symbol?)` in both object and positional forms.
- Produces: the same boolean API, with recognized balance operations always returning `false` even when symbol and direction are populated.

- [ ] **Step 1: Add the failing regression cases**

Extend the existing classification test:

```typescript
assert.equal(
  isTradingDeal({ type: "balance", symbol: "EURUSD", direction: "out" }),
  false,
);
assert.equal(isTradingDeal("balance", "out", "EURUSD"), false);
```

- [ ] **Step 2: Run the analytics test and verify RED**

Run: `node --import tsx --test src/lib/trading/analytics.test.ts`

Expected: both new assertions FAIL because symbol plus direction currently short-circuits before the balance-type guard.

- [ ] **Step 3: Implement the minimum ordering fix**

Normalize object and positional arguments first, reject a recognized balance type second, and only then accept symbol plus direction evidence. Preserve blank-type MT5 trades:

```typescript
export function isTradingDeal(
  typeOrDeal: string | null | undefined | TradingDealLike,
  direction?: string | null,
  symbol?: string | null,
) {
  if (typeof typeOrDeal === "object" && typeOrDeal !== null) {
    direction = typeOrDeal.direction;
    symbol = typeOrDeal.symbol;
    typeOrDeal = typeOrDeal.type;
  }

  const t = (typeOrDeal || "").toLowerCase().trim();
  if (t && isBalanceDeal(t)) return false;
  if ((direction || "").trim() && (symbol || "").trim()) return true;
  if (!t) return false;
  if (t === "trade") return true;
  return t.includes("buy") || t.includes("sell");
}
```

- [ ] **Step 4: Run focused analytics tests and verify GREEN**

Run: `node --import tsx --test src/lib/trading/analytics.test.ts src/lib/trading/preaggregated-cache.test.ts`

Expected: all tests pass, including blank-type trade classification and the new funding guard.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trading/analytics/deal-kernel.ts src/lib/trading/analytics.test.ts
git commit -m "fix: reject typed funding deals from trading metrics"
```

---

### Task 3: Restore dashboard token and touch-target compliance

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Create: `src/components/trading-monitor/touch-targets.test.ts`

**Interfaces:**
- Consumes: `.trade-distribution-panel__tab` and `.heatmap-year-btn` in portrait and landscape viewports.
- Produces: unchanged visual labels with browser-computed hit boxes of at least `44px` by `44px`.

- [ ] **Step 1: Add a real-browser failing test**

Create a Node test that injects `globals.css` and representative dashboard markup into Chromium, then checks computed boxes in both orientations:

```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const viewports = [
  { name: "portrait", width: 430, height: 932 },
  { name: "landscape", width: 932, height: 430 },
] as const;

for (const viewport of viewports) {
  test(`dashboard secondary controls meet 44px touch targets in ${viewport.name}`, async () => {
    const css = await readFile(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport });
      await page.setContent(`
        <style>${css}</style>
        <section class="dashboard-section">
          <article class="account-card">
            <div class="trade-distribution-panel">
              <div class="trade-distribution-panel__tabs">
                <button class="trade-distribution-panel__tab">MFE / P&amp;L</button>
              </div>
            </div>
            <div class="profit-heatmap-panel">
              <button class="heatmap-year-btn" aria-label="Previous year">‹</button>
            </div>
          </article>
        </section>
      `);

      for (const selector of [
        ".trade-distribution-panel__tab",
        ".heatmap-year-btn",
      ]) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, `${selector} must render`);
        assert.ok(box.width >= 44, `${selector} width was ${box.width}px`);
        assert.ok(box.height >= 44, `${selector} height was ${box.height}px`);
      }
    } finally {
      await browser.close();
    }
  });
}
```

- [ ] **Step 2: Run the browser test and verify RED**

Run: `node --import tsx --test src/components/trading-monitor/touch-targets.test.ts`

Expected: FAIL for the undersized distribution tab and heatmap year button in at least one viewport.

- [ ] **Step 3: Apply the minimal CSS and layout cleanup**

Remove the inert Tailwind default-color classes while preserving structural utility classes:

```tsx
<body className="antialiased min-h-screen flex flex-col">
```

Set both interactive selectors to the shared minimum without changing font size or visible labels:

```css
.dashboard-section > .account-card .trade-distribution-panel__tab {
  min-width: 44px;
  min-height: 44px;
}

.dashboard-section > .account-card .heatmap-year-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 2px;
}
```

Remove the portrait-only `min-height: 36px` override because the base rule now owns the minimum.

- [ ] **Step 4: Verify GREEN and retain orientation evidence**

Run: `node --import tsx --test src/components/trading-monitor/touch-targets.test.ts`

Expected: both portrait and landscape cases pass with every measured dimension at least `44px`.

Run: `node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts src/components/trading-monitor/TradeDistributionPanel.test.ts`

Expected: all tests pass.

Save non-committed screenshots of the fixture at `/tmp/analytic-touch-targets-portrait.png` and `/tmp/analytic-touch-targets-landscape.png` during verification.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css src/components/trading-monitor/touch-targets.test.ts
git commit -m "fix: enforce dashboard touch target tokens"
```

---

### Task 4: Reconcile repository guidance with verified behavior

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `bridge/history.py`, `src/worker-v2/mappers.ts`, `src/lib/trading/trade-distributions.ts`, and `src/app/api/economic-events/route.ts` as verified evidence.
- Produces: repository guidance that no longer invites incorrect epoch handling or promises stale limits/windows.

- [ ] **Step 1: Update the three drifted statements**

Use these exact replacement statements:

```markdown
- Automatic history lifecycle: Python bridge publishes bounded Deal/Order/Position envelopes with raw MT5 broker-server epochs plus barriers; Node worker converts those raw epochs to UTC exactly once using the configured broker offset, persists them idempotently, and advances PostgreSQL `BridgeHistoryCheckpoint` only after all barriers/counts/digests commit. Redis `mt5:bridge:history-ack:{login}` is a derived mirror only. Missing state starts at 2025-01-01; never epoch or a 30-day fallback.
- API terms: account list → `/api/accounts`; account detail → `/api/accounts/[id]?timeframe=...`; trade history → `/api/accounts/[id]/trade-history` (cursor-paginated); economic calendar → `/api/economic-events?scope=expanded` (all normalized high-impact USD and holiday events from database rows newer than seven days ago, with Forex Factory live-fetch fallback) or default (today, otherwise up to four nearest upcoming or latest released events), Bangkok time, `force-dynamic`.
```

Replace the MAE/MFE truncation sentence with:

```markdown
**`MaeMfePanel`** (`MAX` sub-panel) — renders per-trade MAE/MFE coordinates from selected account and timeframe as separate semantic-color Win/Loss scatter series. Plots only complete coordinate pairs and reports when the scoped response is evenly sampled to 1,000 closed trades; regressions still use all valid scoped positions.
```

- [ ] **Step 2: Cross-check the claims against current code**

Run:

```bash
rg -n "event_time_semantic|epochSecondsToDate|MAX_RENDERED_DISTRIBUTION_POINTS|weekAgo|scopeName" bridge/history.py src/worker-v2/mappers.ts src/lib/trading/trade-distributions.ts src/app/api/economic-events/route.ts
```

Expected preview: raw broker-server semantic in Bridge, single offset conversion in the worker, distribution cap `1000`, and a seven-day DB lower bound with expanded/default branching.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: align dashboard and epoch guidance"
```

---

## Final Verification

- [ ] Run focused suites:

```bash
node --import tsx --test src/lib/trading/metric-registry.test.ts src/lib/trading/analytics.test.ts src/lib/trading/preaggregated-cache.test.ts src/lib/trading/trade-distributions.test.ts src/components/trading-monitor/touch-targets.test.ts src/components/trading-monitor/card/DashboardCard.test.ts src/components/trading-monitor/TradeDistributionPanel.test.ts src/app/api/economic-events/route.test.ts
```

- [ ] Run static and production checks:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

- [ ] Review the complete diff for unrelated edits, source-boundary violations, and credential material.
- [ ] Run analytics and dashboard domain reviews, then a final whole-branch review.

---

## 2026-08-02 Task 5 Amendment / Decision Record

### Rationale and precedence

The original plan followed incomplete review evidence. It is retained above as historical execution context, not rewritten to imply that the corrected architecture was known initially. The user's 2026-08-02 ruling makes the current native runtime authoritative and supersedes these original statements:

- Task 4's history-lifecycle statement that assigned active coverage ownership to PostgreSQL `BridgeHistoryCheckpoint` and described Redis history ACK state as its active mirror.
- Task 1's live metric rows that omitted the Redis-first API paths for `opens`, `floating-pl`, `margin`, `free-margin`, and `margin-level`.
- Task 4's historical `MaeMfePanel` component wording, which is superseded by `TradeDistributionPanel`.

### Corrected native authority

- The native Python bridge publishes `history.deal`, `history.order`, and `history.window` envelopes. Its SQLite journal owns coverage, checkpoints, outbox obligations, and successful Redis-publication state.
- The Node worker converts broker-server epochs to UTC exactly once, idempotently persists `Deal` and `Order` rows, reconstructs closed `Position` rows, and treats `history.window` as an audit marker.
- The native history lower bound remains 2025-01-01.
- Retired `BridgeHistoryCheckpoint` state, legacy Redis history-ACK references, and recovery tooling may remain for manual recovery, but they are not active native ownership.

### Corrected live metric metadata

| id | source | apiField |
| --- | --- | --- |
| `opens` | `OpenPosition / Redis` | `live.positions.length / overview.kpis.openCount` |
| `floating-pl` | `OpenPosition / AccountSnapshot / Redis` | `live.profit / account.floating_pl` |
| `margin` | `AccountSnapshot / Redis` | `live.margin / account.margin` |
| `free-margin` | `AccountSnapshot / Redis` | `live.freeMargin / (account.equity - account.margin)` |
| `margin-level` | `AccountSnapshot / Redis` | `live.marginLevel / account.margin_level` |

This amendment changes documentation and metadata contracts only. It does not change runtime formulas, database ownership, API contracts, or production behavior.
