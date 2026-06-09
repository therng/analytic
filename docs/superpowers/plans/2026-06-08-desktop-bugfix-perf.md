# Desktop Layout Bug Fix + Performance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 confirmed bugs from code review and improve desktop loading performance by staggering detail API calls.

**Architecture:** All fixes are isolated per-file. Performance fix gates the 3 desktop detail API calls (`profitDetail`, `balanceDetail`, `pipsSummary`) on `overview.data` being available first — natural serialization that prevents N×3 simultaneous requests on mount.

**Tech Stack:** Next.js 16 App Router, React 19, CSS Grid, TypeScript

---

## File Map

| File | What changes |
|------|-------------|
| `src/components/trading-monitor/OpenPositionsPanel.tsx` | Show compact inline error instead of null when compact+error+empty |
| `src/components/trading-monitor/DashboardClient.tsx` | Fix dangling MQL, add col-1 skeletons, add aria-pressed, stagger detail APIs |
| `src/app/globals.css` | Fix 2560px grid-template-areas conflict, add portrait override for 4-col, fix dc-right span |
| `Caddyfile` | Add `auto_https off` to global block |

---

### Task 1: Fix error swallowing in compact mode (OpenPositionsPanel)

**Files:**
- Modify: `src/components/trading-monitor/OpenPositionsPanel.tsx:93-101`

**Problem:** When `compact=true`, `error` is present, and `rankedPositions.length === 0`, the component returns `null` — the error is invisible.

**Fix:** Show a minimal inline error in compact mode instead of silently returning null.

- [ ] **Step 1: Open and read the current code**

Read lines 72–101 of `src/components/trading-monitor/OpenPositionsPanel.tsx` to confirm current state.

- [ ] **Step 2: Apply the fix**

Replace the `if (!rankedPositions.length)` block:

```tsx
  if (!rankedPositions.length) {
    if (compact) {
      // In desktop compact mode: show error if present, otherwise render nothing
      if (error) {
        return (
          <div className="dc-empty-state" style={{ color: "var(--tone-negative)" }}>
            <span>{error}</span>
          </div>
        );
      }
      return null;
    }
    return (
      <EmptyOpenPositionsState
        error={error}
        onOpenTechnicalAnalysis={onOpenTechnicalAnalysis}
      />
    );
  }
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -20
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/trading-monitor/OpenPositionsPanel.tsx
git commit -m "fix(desktop): show error in compact OpenPositionsPanel instead of silent null"
```

---

### Task 2: Fix dangling MediaQueryList in DashboardClient

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx:152-160`

**Problem:** The `useState` lazy initializer creates a `MediaQueryList` object that is never stored or cleaned up. `useEffect` creates a second one and properly removes its listener. The first leaks.

**Fix:** Initialize `isDesktop` as `false` (avoids SSR mismatch), let `useEffect` set the true value AND attach the listener — only one MQL object ever created.

- [ ] **Step 1: Apply the fix**

Replace lines 152–160:

```tsx
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -20
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/trading-monitor/DashboardClient.tsx
git commit -m "fix(desktop): eliminate dangling MediaQueryList from useState initializer"
```

---

### Task 3: Add aria-pressed to dc-view-toggle buttons

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx` (desktop layout section, view toggle ~line 718)

**Problem:** `dc-view-toggle` buttons lack `aria-pressed`, unlike the existing `TimeframeStrip` component. Screen readers cannot determine which view (Open/History) is active.

- [ ] **Step 1: Find the exact button lines**

Search for `dc-view-btn` in `DashboardClient.tsx` to locate the two buttons.

- [ ] **Step 2: Apply the fix**

Add `aria-pressed` to both buttons:

```tsx
            <div className="dc-view-toggle" role="group" aria-label="Panel view">
              <button
                type="button"
                className={`dc-view-btn${dcRightView === "positions" ? " is-active" : ""}`}
                aria-pressed={dcRightView === "positions"}
                onClick={() => setDcRightView("positions")}
              >
                Open
              </button>
              <button
                type="button"
                className={`dc-view-btn${dcRightView === "history" ? " is-active" : ""}`}
                aria-pressed={dcRightView === "history"}
                onClick={() => setDcRightView("history")}
              >
                History
              </button>
            </div>
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/trading-monitor/DashboardClient.tsx
git commit -m "fix(a11y): add aria-pressed and role=group to dc-view-toggle buttons"
```

---

### Task 4: Add skeleton loaders for desktop col-1 panels

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx` (desktop layout col-1 section ~lines 622–690)

**Problem:** All three col-1 panels (`PerformanceQualityPanel variant=gauges`, DD metrics grid, `PerformanceQualityPanel variant=radar`) render `null` while `balanceDetail` is loading. The entire left column is blank for 200–500ms on initial desktop load.

**Fix:** Show skeleton placeholders while loading.

- [ ] **Step 1: Wrap col-1 content with loading states**

Replace the col-1 `<div className="dc-left">` block. The three sections guarded by `{balanceDetail.data ? ... : null}` become:

```tsx
          {/* ── COL 1: gauges + DD ext + radar + bot performance ── */}
          <div className="dc-left">
            {balanceDetail.loading && !balanceDetail.data ? (
              <>
                <div className="skeleton-chart" style={{ height: 80 }} aria-hidden="true" />
                <div className="skeleton-chart" style={{ height: 60 }} aria-hidden="true" />
                <div className="skeleton-chart" style={{ height: 200 }} aria-hidden="true" />
              </>
            ) : balanceDetail.error ? (
              <InlineState tone="error" title="Quality metrics unavailable" message={balanceDetail.error} />
            ) : balanceDetail.data ? (
              <>
                <PerformanceQualityPanel
                  variant="gauges"
                  sharpeRatio={balanceDetail.data.summary.sharpeRatio}
                  profitFactor={balanceDetail.data.summary.profitFactor}
                  recoveryFactor={balanceDetail.data.summary.recoveryFactor}
                  winPercent={overview.data?.kpis.winPercent}
                  averageProfitTrade={positionsDetail.data?.summary.averageProfitTrade}
                  averageLossTrade={balanceDetail.data.summary.averageLossTrade}
                />

                <div className="kpi-detail-grid dc-metrics-grid" aria-label="DD extension">
                  <SummaryChip
                    label="ABS"
                    value={formatAbsoluteDrawdownValue(balanceDetail.data.summary.absoluteDrawdown, 2)}
                    tone={absDrawdownTone(balanceDetail.data.summary.absoluteDrawdown)}
                    meta="Abs drawdown"
                    fullValue={(() => {
                      const v = balanceDetail.data?.summary.absoluteDrawdown;
                      if (!Number.isFinite(v)) return "-";
                      return (v ?? 0) < 0 ? `-${formatCurrency(Math.abs(v ?? 0), 2)}` : "—";
                    })()}
                    hint={{ definition: "ABS วัดว่าบัญชีขาดทุนสุทธิเกินทุนที่ลงไปแล้วหรือไม่" }}
                  />
                  <SummaryChip
                    label="MAX"
                    value={formatCompactNumber(balanceDetail.data.summary.maximalDrawdownAmount, 2)}
                    tone={drawdownTone(balanceDetail.data.summary.maximalDrawdownAmount)}
                    meta="Max drawdown"
                    fullValue={formatCurrency(balanceDetail.data.summary.maximalDrawdownAmount, 2)}
                    hint={{ definition: "จำนวนเงินของการเทรดเสียสูงสุด" }}
                  />
                  <SummaryChip
                    label="DEP LOAD"
                    value={formatPlainPercent(balanceDetail.data.summary.maximalDepositLoad, 1)}
                    tone={depositLoadTone(balanceDetail.data.summary.maximalDepositLoad)}
                    meta="Margin / equity %"
                    hint={{ definition: "สัดส่วน margin ที่ใช้อยู่เทียบกับ equity" }}
                  />
                  <SummaryChip
                    label="EXPECT"
                    value={formatCompactSignedNumber(positionsDetail.data?.summary.expectedPayoff, 1)}
                    tone={toneFromNumber(positionsDetail.data?.summary.expectedPayoff)}
                    meta="Expected payoff"
                    fullValue={formatSignedCurrency(positionsDetail.data?.summary.expectedPayoff, 2)}
                    hint={{ definition: "กำไรเฉลี่ยต่อ position ที่ปิดแล้ว" }}
                  />
                </div>

                <PerformanceQualityPanel
                  variant="radar"
                  radarHeight={200}
                  sharpeRatio={balanceDetail.data.summary.sharpeRatio}
                  profitFactor={balanceDetail.data.summary.profitFactor}
                  recoveryFactor={balanceDetail.data.summary.recoveryFactor}
                  winPercent={overview.data?.kpis.winPercent}
                  averageProfitTrade={positionsDetail.data?.summary.averageProfitTrade}
                  averageLossTrade={balanceDetail.data.summary.averageLossTrade}
                  maximumConsecutiveWins={positionsDetail.data?.summary.maximumConsecutiveWins}
                  maximumConsecutiveLosses={positionsDetail.data?.summary.maximumConsecutiveLosses}
                />
              </>
            ) : null}

            <BotPnLPanel positions={positionsDetail.data?.historyPositions} />
          </div>
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/trading-monitor/DashboardClient.tsx
git commit -m "fix(desktop): add skeleton loaders for col-1 panels while balanceDetail loads"
```

---

### Task 5: Performance — stagger desktop detail API calls

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx:188-208`

**Problem:** On desktop, `profitDetail`, `balanceDetail`, and `pipsSummary` all fire immediately on mount — 3×N requests for N account cards. This can exhaust the DB connection pool and saturate API concurrency.

**Fix:** Gate the 3 detail APIs on `overview.data` being available. `overview` is already firing unconditionally; once it resolves per card, that card then fires its detail calls. This naturally serializes: critical data (overview + positions) loads first for all cards in parallel, then detail fills in per-card as overview completes. No artificial delays needed.

- [ ] **Step 1: Apply the URL guard change**

At lines 188–208, change the three API conditions from `(isDesktop || expandedKpi === "X")` to `(isDesktop && !!overview.data || expandedKpi === "X")`:

```tsx
  const profitDetail = useApiResource<ProfitDetailResponse>(
    (isDesktop && !!overview.data || expandedKpi === "gain") ? `/api/accounts/${account.id}/profit-detail?timeframe=${timeframe}` : null,
    {
      refreshKey,
      onRequestStateChange,
    },
  );
  const balanceDetail = useApiResource<BalanceDetailResponse>(
    (isDesktop && !!overview.data || expandedKpi === "dd") ? `/api/accounts/${account.id}/balance-detail?timeframe=${timeframe}` : null,
    {
      refreshKey,
      onRequestStateChange,
    },
  );
  const pipsSummary = useApiResource<PipsSummaryResponse>(
    (isDesktop && !!overview.data || expandedKpi === "pips") ? `/api/accounts/${account.id}/pips-summary?timeframe=${timeframe}` : null,
    {
      refreshKey,
      onRequestStateChange,
    },
  );
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -20
```
Expected: exits 0. The skeleton loaders from Task 4 now show while overview + detail load sequentially.

- [ ] **Step 3: Commit**

```bash
git add src/components/trading-monitor/DashboardClient.tsx
git commit -m "perf(desktop): stagger detail API calls — fire after overview resolves, not on mount"
```

---

### Task 6: Fix CSS grid-template-areas conflict at 2560px

**Files:**
- Modify: `src/app/globals.css` (2560px breakpoint, ~line 3524)

**Problem 1:** At 2560px, `grid-template-areas` lists `"heatmap heatmap right extra"` in row 2 with "right" as a named area. But `.dc-right` has `grid-row: 1 / span 2` from the base 1024px rules. The explicit span wins; the named area "right" in row 2 becomes a phantom hole that dc-heatmap may try to fill incorrectly.

**Fix 1:** Remove "right" from row 2 in the 2560px template and use a placeholder (`.`) instead. `dc-right` spans via its explicit rule.

**Problem 2:** The portrait override (`@media (orientation: portrait)`) is only inside the `1024px` breakpoint — it was designed for 3 columns. At 2560px portrait, the 4-column grid applies but `dc-heatmap { grid-column: 2 / span 2 }` only spans 2 of 4 columns.

**Fix 2:** Add a portrait override block inside the 2560px breakpoint.

- [ ] **Step 1: Fix the 2560px grid-template-areas**

Find the `@media (min-width: 2560px)` block (~line 3524) and change the grid-template-areas:

```css
@media (min-width: 2560px) {
  .dashboard-section > .account-card.account-card--desktop {
    --dc-pad-x:     clamp(14px, 0.70vw, 20px);
    --dc-pad-y:     clamp(12px, 0.60vw, 16px);
    --dc-gap:       clamp(10px, 0.50vw, 14px);
    --dc-chart-h:   clamp(140px, 12vh, 190px);

    grid-template-columns:
      repeat(4, minmax(0, 1fr));
    grid-template-areas:
      "left   middle right  extra"
      "heatmap heatmap .     extra";
  }

  /* Activate 4th column */
  .dc-extra { display: flex; }

  /* Portrait: heatmap spans all non-right columns */
  @media (orientation: portrait) {
    .dashboard-section > .account-card.account-card--desktop {
      grid-template-areas:
        "left   middle right  extra"
        "left   heatmap heatmap heatmap";
    }
    .dc-heatmap {
      grid-column: auto;
    }
  }
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build 2>&1 | tail -20
```
Expected: exits 0 (CSS is not type-checked by build but must not break compilation).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "fix(css): resolve grid-template-areas phantom hole at 2560px and add portrait override"
```

---

### Task 7: Add auto_https off to Caddyfile

**Files:**
- Modify: `Caddyfile` (global block, before the `:80 {` site block)

**Problem:** `docker-compose.yml` now exposes ports 443/tcp and 443/udp, but the Caddyfile only has a `:80` site block with no TLS configuration. Caddy's automatic HTTPS will attempt ACME certificate issuance in local dev, fail (no valid domain), and log errors or stall startup.

- [ ] **Step 1: Read current Caddyfile**

Confirm the Caddyfile opens directly with `:80 {` (no global block).

- [ ] **Step 2: Add global block with auto_https off**

Prepend to the beginning of `Caddyfile`:

```
{
	auto_https off
}

```

(Keep the existing `:80 {` block unchanged below it.)

- [ ] **Step 3: Verify docker-compose syntax**

```bash
docker compose config --quiet 2>&1 | head -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add Caddyfile
git commit -m "fix(caddy): disable auto_https to prevent ACME attempts on local dev with 443 ports"
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1 — compact error swallow (OpenPositionsPanel)
- ✅ Task 2 — dangling MQL (DashboardClient)
- ✅ Task 3 — aria-pressed (DashboardClient)
- ✅ Task 4 — col-1 skeleton loaders (DashboardClient)
- ✅ Task 5 — stagger 3×N detail API calls (DashboardClient)
- ✅ Task 6 — CSS grid-template-areas 2560px + portrait (globals.css)
- ✅ Task 7 — Caddyfile auto_https off

**Placeholder scan:** No TBDs, no "implement later", no stubs.

**Type consistency:** `InlineState`, `formatCurrency`, `formatCompactNumber` all already imported in `DashboardClient.tsx`. `PerformanceQualityPanel` variant props match the type definition. No new types introduced.
