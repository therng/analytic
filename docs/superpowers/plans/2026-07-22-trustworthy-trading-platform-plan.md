# Trustworthy Trading Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close correctness, coverage, and dead-surface gaps found by tracing every metric from MT5 source semantics through Bridge/Redis/worker ingestion, Postgres storage, API contracts, and UI presentation — without touching architecture, data sources, or scope beyond what's documented here.

**Architecture:** No new subsystems. All work is corrective: fix a semantic mismatch, delete confirmed-dead code, wire an unexposed metric, or explicitly re-confirm+re-flag an already-tracked risk. Source boundaries (Position for trade metrics, Deal for balance/growth, Redis/OpenPosition for live state) stay exactly as documented in root `CLAUDE.md`.

**Tech Stack:** Next.js App Router, Node.js worker (`worker`/`worker-v2`), Prisma 6 + PostgreSQL 15, Redis 7. No new dependencies.

## Global Constraints

- Preserve MT5 raw UTC epochs — every `epochSecondsToDate` call site stays untouched; `brokerUtcOffsetMinutes` param stays intentionally void per `src/lib/time.ts:21` (do not "fix" this — it's correct as designed, offset only matters for the one live-Redis path).
- Preserve source boundaries: win rate/profit factor/Sharpe/averaged metrics → `Position`; balance curve/growth/drawdown/intraday curves → `Deal`; floating P/L/open exposure → `OpenPosition`/Redis; latest balance/equity/margin → `AccountSnapshot`/Redis.
- Preserve idempotent history lifecycle — no changes to `history-checkpoint.ts` barrier/digest logic (Phase 0 audit found no new gaps there; don't introduce any).
- Bangkok-facing display time only in UI/formatting layer (`src/lib/time.ts` Bangkok functions) — never in worker/DB layer.
- Preserve responsive portrait/landscape UI — every UI change must render correctly in both (verify per Task acceptance criteria).
- Existing stack only: Next.js, Node worker, Prisma, PostgreSQL, Redis. No new libraries.
- No schema migration ships without `prisma-migration-reviewer` agent sign-off (per this repo's harness convention) and a fresh row-count/data check before drop/alter, matching how Phase 1/4/5 of the prior schema-consolidation plan operated.
- Do not modify production data as part of planning — this document is the deliverable; execution happens in a later session per the Execution Handoff below.

---

## Source material (read, not modified, during Phase 0 research below)

- `docs/superpowers/plans/2026-07-18-mt5-schema-and-analytics-metrics-plan.md` — prior schema consolidation plan. Phases 1/2/4/5 complete; **Phase 3 dormant** (R1 sequencing risk not yet due — `worker` v1 retirement never scheduled). This plan does not re-open Phase 3; it only re-confirms R1/R2 are still accurately tracked (see Phase A below).
- `docs/mql5book-position-properties.md`, `docs/mql5book-deal-properties.md`, `docs/mql5book-order-properties.md` — MQL5 field semantics used as the correctness reference for Phase B.
- `docs/mql5book-tester-statistics.md` — `STAT_*` formula reference used as the correctness reference for Phase B.
- `docs/mt5-trading-report-drawdown.md` — drawdown formula reference (Absolute/Maximal/Relative), used to verify `calculate-report-results.ts` drawdown fields (already verified correct in Phase 0 — see below).

---

## Phase 0 — Research findings (COMPLETE, this session, read-only)

Four parallel investigator passes traced: (1) every `AccountReportResult` metric against `STAT_*`/drawdown doc semantics, (2) every API route's response shape against its consumers, (3) every UI panel/KPI against required chips and available data, (4) every UTC/Bangkok time conversion and the `PositionExcursion`/idempotency risk surface. Findings below are what Phases A–D fix. Nothing here has been fixed yet — this section is inventory only, same discipline as Phase 0 of the prior schema plan.

### B1 — Drawdown, profit-factor, recovery-factor, Sharpe: CORRECT

`totalNetProfit`, `grossProfit`, `grossLoss`, `profitFactor`, `expectedPayoff`, `recoveryFactor`, `sharpeRatio`, `balanceDrawdownAbsolute/Maximal/MaximalPct/Relative/RelativePct`, `totalTrades`, `profitTradesCount`, `lossTradesCount`, `largestProfitTrade`, `largestLossTrade`, `shortTradesWon`, `longTradesWon` all verified formula-correct and source-boundary-correct (`src/lib/trading/calculate-report-results.ts:119-174`). No action needed — do not touch these fields.

### B2 — CONFIRMED semantic mismatch: consecutive win/loss fields store the wrong thing

`prisma/schema.prisma` fields `maximumConsecutiveWins`/`maximumConsecutiveLosses`, populated at `src/lib/trading/calculate-report-results.ts:173-174`, store **trade counts**. MQL5 `STAT_MAX_CONWINS`/`STAT_MAX_CONLOSSES` (`docs/mql5book-tester-statistics.md` lines 25, 67) define these as the **total profit/loss amount of the longest win/loss series**, not a count. A dead function, `computeConsecutiveRunAmounts` (`src/lib/trading/analytics.ts:924`), already implements the amount calculation but is called from nowhere.

Separately, the `/positions` and `/win-detail` API responses (per Phase 0 API trace) already contain fields named `maxConsecutiveProfitAmount`/`maxConsecutiveLossAmount` and `averageConsecutiveWins`/`averageConsecutiveLosses` — sourced from a **different, not-yet-identified** computation path (not `computeConsecutiveRunAmounts`, since that function has zero callers). **This must be reconciled by direct file read before any fix ships** — Task 1 below starts with that reconciliation step specifically because two independent investigator passes surfaced overlapping-but-not-identical claims and neither saw the other's findings.

### B3 — Coverage gaps: no computation anywhere for 4 of 6 consecutive-series stats

`STAT_CONPROFITMAX_TRADES`, `STAT_CONLOSSMAX_TRADES` (trade count in the max-*amount* series, as opposed to the max-*length* series already covered by `computeStreaks`), `STAT_PROFITTRADES_AVGCON`, `STAT_LOSSTRADES_AVGCON` (average series length) have no confirmed computation in `analytics.ts`/`calculate-report-results.ts`. Whether they're computed elsewhere (e.g. inline in `preaggregated-cache.ts` feeding the dead `/win-detail` route) is part of the Task 1 reconciliation.

### C1 — API surface: 7 dead routes, 2 unexposed stored metrics

Dead (built, zero component callers, confirmed by cross-referencing every route against `src/components`): `/api/accounts/[id]/profit`, `/profit-detail`, `/win-detail`, `/balance-detail`, `/pips-summary`, `/trade-history`, `/live`. Each duplicates a field subset already served by a live route (`/overview`, `/balance`, `/positions`, `/pips`) except `/live`, which is a distinct real-time-Redis path with no current UI wiring, and `/trade-history`, which is cursor-paginated but has no `timeframe` param (its sibling `/positions` does both timeframe-window AND inline cursor-pagination of history in one response).

`AccountReportResult.totalNetProfit` and `.sourceReportDate` are computed and stored but never returned by any API route.

### C2 — UI: one KPI chip skips the zero-as-empty pattern; one metric computed and served but never rendered

`src/components/trading-monitor/card/DashboardCard.tsx:373-374` — the `openCount` KPI chip formats `liveOpenPositions?.length ?? overview.data?.kpis.openCount` directly through `formatCompactCount`, **not** wrapped in `kpiValue()` like the other four required chips (net gain, drawdown, pips, trades all use it at lines nearby). Repo convention (`CLAUDE.md` "Zero-as-empty pattern") requires `0 | null | undefined → null` before formatting so it renders `"-"`, not `"0"`, for an account with genuinely zero open positions. This is the one place that convention is broken among the 5 required chips.

`totalWinningPips` (`AccountOverviewResponse.kpis.totalWinningPips`) is computed and API-exposed but not read by any component — dead at the presentation layer only, not the API layer.

### D1 — Schema (carried over from this session's separate schema audit, folded in for completeness)

- `magic` stored as Prisma `Int` (Postgres `int4`) on `Position`/`OpenPosition`/`Deal`/`Order`; MQL5 `POSITION_MAGIC`/`ORDER_MAGIC`/`DEAL_MAGIC` are `ulong`. Observed live data max is 850025535, well under `int4`'s 2147483647 ceiling — **no overflow observed, no action required**, just noted here so a future magic-number scheme change doesn't silently break ingestion. Not a task in this plan.
- `WorkerMessageFailure` model: confirmed zero write path anywhere in `src/` or `scripts/` (two independent greps, this session). Dead model — cleanup candidate, not urgent.
- `BridgeHistoryChunk.parentChunkId` has no FK; child-chunk creation doesn't verify parent existence first. Ordering-dependent — do not add a naive FK without confirming ingestion order guarantees first (see Task 5).

### D2 — Time/idempotency: re-confirmed, nothing new

Broker-offset handling, UTC→Bangkok conversion, and history-checkpoint idempotency all verified correct, no double-conversion or missing-conversion path found. **R1** (`PositionExcursion`'s only writer is legacy `worker` v1's `equity-sampler.ts:173`; `worker-v2`'s MAE/MFE finalizer at `position-reconstructor.ts:285` depends on it; if `worker` v1 is ever retired before this sampler moves, MAE/MFE silently degrades to `null` with no error) and **R2** (`RETENTION_DAYS = 7` at `equity-sampler.ts:12` caps MAE/MFE aggregation for positions open or reconstructed >7 days) are both still accurately described by the prior plan doc — this plan does not change their status. They stay **dormant/tracked**, not actioned, per that plan's own Phase 3 gating (worker v1 retirement not scheduled).

---

## Invariants (must hold after every phase below)

1. Every `AccountReportResult` field keeps its current source boundary (Position vs Deal) — Phase B changes computation logic, never which table a field reads from.
2. No API route response shape loses a field a live component currently reads — verified per-task by re-running the consuming component against the changed route.
3. Dead-route deletion (Phase C) only proceeds after a fresh grep confirms zero consumers immediately before the delete commit — not trusting this plan's Phase 0 snapshot, since code may have moved between planning and execution.
4. `kpiValue()` zero-as-empty fix (Phase C) must not change behavior for any of the 4 already-correct chips — a single-chip, single-file change.
5. R1/R2 stay dormant/tracked in this plan — no task here attempts the Phase 3 sequencing fix from the prior schema plan; that remains gated on `worker` v1 retirement being scheduled, which is out of scope here.

---

## Phase A — Re-confirm dormant risks (COMPLETE, this session)

- [x] Re-verified R1 (`PositionExcursion` single-writer risk) still accurately described — confirmed `worker/equity-sampler.ts:173` is still the only writer, `worker-v2/position-reconstructor.ts:285` still the only consumer. No drift since prior plan.
- [x] Re-verified R2 (7-day retention) still accurately described — `RETENTION_DAYS = 7` unchanged.
- [x] Re-verified broker-offset/Bangkok-conversion correctness — no new gap found beyond what's already documented as tech debt (DST auto-switch absent, tracked separately in project memory, not a task here).

No further action this phase. Recorded so a future reader doesn't re-run this same investigation from scratch.

## Phase B — Metric correctness (analytics.ts / calculate-report-results.ts / API)

### Task 1: Reconcile consecutive-series computation paths (blocking — do first)

**Files:**
- Read: `src/lib/trading/analytics.ts` (full file — locate every function touching win/loss streaks, not just `computeStreaks`/`computeConsecutiveRunAmounts`)
- Read: `src/lib/trading/preaggregated-cache.ts` (search for `maxConsecutiveProfitAmount`, `maxConsecutiveLossAmount`, `averageConsecutiveWins`, `averageConsecutiveLosses` — these field names were found in the `/positions` and `/win-detail` API response shapes during Phase 0 but their source computation was not identified)
- Read: `src/app/api/accounts/[id]/positions/route.ts` and `src/app/api/accounts/[id]/win-detail/route.ts` (or wherever these routes actually live — confirm exact path via Glob first, Phase 0 investigator abbreviated paths)

**Interfaces:**
- Consumes: nothing from earlier tasks (first task in this phase)
- Produces: a written-down answer (as a code comment or a short note in this plan's execution log, not a new doc file) to: (a) is `computeConsecutiveRunAmounts` truly dead, or does something call it under a name Phase 0's grep missed? (b) where do `maxConsecutiveProfitAmount`/`averageConsecutiveWins` actually get computed? (c) is that computation MQL5-correct per `docs/mql5book-tester-statistics.md` `STAT_CONPROFITMAX`/`STAT_MAX_CONWINS`/`STAT_PROFITTRADES_AVGCON` semantics?

- [ ] **Step 1: Grep for every caller of the four ambiguous field names across the whole repo**

```bash
grep -rn "maxConsecutiveProfitAmount\|maxConsecutiveLossAmount\|averageConsecutiveWins\|averageConsecutiveLosses\|computeConsecutiveRunAmounts" src
```

Expected: a definitive call graph — one definition site and N call sites per name, or confirmation a name is truly orphaned.

- [ ] **Step 2: For each computation found, compare its logic against the MQL5 doc definition it claims to implement**

Read the matched function body. Check against:
- `STAT_MAX_CONWINS` / `STAT_MAX_CONLOSSES` = total profit/loss **amount** of the longest **length** series (not the max-amount series — re-read `docs/mql5book-tester-statistics.md` line 25 vs line 67 carefully, they are two different series selection criteria: "longest winning series" vs "max total profit in consecutive winning series" — these can pick *different* underlying series if, e.g., a 3-trade series has higher total profit than a 5-trade series).
- `STAT_CONPROFITMAX` = amount of the max-**profit** series (may differ in length from the longest series).
- `STAT_PROFITTRADES_AVGCON` = average length across all winning series, not just the longest one.

Write down which of the 6 MQL5 stats (`STAT_MAX_CONWINS`, `STAT_MAX_CONLOSSES`, `STAT_CONPROFITMAX`, `STAT_CONPROFITMAX_TRADES`, `STAT_CONLOSSMAX`, `STAT_CONLOSSMAX_TRADES`, `STAT_PROFITTRADES_AVGCON`, `STAT_LOSSTRADES_AVGCON` — 8 total, doc groups some in pairs) each existing function actually computes, by exact identifier, not by field name resemblance.

- [ ] **Step 3: Decide fix scope based on Step 2's findings**

Three possible outcomes, pick the one Step 2 evidence supports:
- (a) If `maxConsecutiveProfitAmount` etc. already correctly implement the MQL5 semantics and are just unused by `AccountReportResult`/`maximumConsecutiveWins`/`maximumConsecutiveLosses` — Task 2 wires the existing correct computation into `calculate-report-results.ts` instead of the current count-based one, and deletes `computeConsecutiveRunAmounts` as truly-dead duplicate logic.
- (b) If `maxConsecutiveProfitAmount` etc. are themselves wrong (e.g. conflate longest-series with max-amount-series) — Task 2 fixes both the `AccountReportResult` fields AND the `/positions`/`/win-detail` computation from one shared corrected function, replacing all divergent implementations with `computeConsecutiveRunAmounts` (fixed if needed) as the single source.
- (c) If no live computation anywhere implements `STAT_CONPROFITMAX_TRADES`/`STAT_CONLOSSMAX_TRADES`/`STAT_PROFITTRADES_AVGCON`/`STAT_LOSSTRADES_AVGCON` at all (true coverage gap, not just a naming mismatch) — Task 2 adds them net-new, sourced from `Position` per the existing source-boundary convention for averaged/win-rate-family metrics.

This step has no code changes — it's the decision gate. Do not proceed to Task 2 until this is written down with file:line evidence for whichever outcome applies.

### Task 2: Fix `maximumConsecutiveWins`/`maximumConsecutiveLosses` semantics

**Files:**
- Modify: `src/lib/trading/analytics.ts` (whichever function Task 1 identified as the single source of truth — likely `computeConsecutiveRunAmounts` at line 924, fixed per Task 1 Step 3 outcome)
- Modify: `src/lib/trading/calculate-report-results.ts:173-174` (call the amount-based function instead of the count-based one for `maximumConsecutiveWins`/`maximumConsecutiveLosses`)
- Modify: `prisma/schema.prisma` — **decide during this task, not before:** either rename `maximumConsecutiveWins Int?` → keep the name but change semantics to amount (breaking change for any consumer expecting a count — check `/win-detail` and `/positions` response consumers found in Task 1 before deciding), or add new fields alongside (e.g. `maximumConsecutiveWinsCount`/`maximumConsecutiveWinsAmount`) if both a count and an amount are genuinely useful UI-facing numbers. **This choice depends on Task 1's findings about what `/positions`/`/win-detail` already expose** — if those routes already correctly expose the amount under a different field name, the simplest fix is deleting the redundant count-only field rather than renaming it.
- Test: `src/lib/trading/analytics.test.ts` — add/update a case with a synthetic Position sequence where the longest-*length* streak and the highest-*amount* streak are different series (e.g. streak A = 5 small wins totaling $50, streak B = 2 large wins totaling $200) to prove count-based and amount-based logic diverge and the fixed function returns the amount, not the count.

**Interfaces:**
- Consumes: Task 1's written decision (which function is source of truth, what schema shape results)
- Produces: `calculateReportResults()` return type gains/changes the `maximumConsecutiveWins`/`maximumConsecutiveLosses` field semantics — every downstream reader of `AccountReportResult` (found via `grep -rn "maximumConsecutiveWins\|maximumConsecutiveLosses" src`) must be re-checked in Step 4 below.

- [ ] **Step 1: Write the failing test in `analytics.test.ts`**

```typescript
test("consecutive win streak amount differs from consecutive win streak length when a short high-value streak beats a long low-value one", () => {
  const positions = [
    // Streak A: 5 wins, $10 each = $50 total, length 5
    ...Array.from({ length: 5 }, (_, i) => ({
      closeTime: new Date(2026, 0, i + 1),
      profit: 10,
      commission: 0,
      swap: 0,
    })),
    // one loss breaks the streak
    { closeTime: new Date(2026, 0, 6), profit: -5, commission: 0, swap: 0 },
    // Streak B: 2 wins, $100 each = $200 total, length 2
    { closeTime: new Date(2026, 0, 7), profit: 100, commission: 0, swap: 0 },
    { closeTime: new Date(2026, 0, 8), profit: 100, commission: 0, swap: 0 },
  ];
  const result = computeConsecutiveRunAmounts(positions);
  // Longest-length streak is A (5 trades, $50). Highest-amount streak is B ($200, 2 trades).
  assert.equal(result.maxProfitAmount, 200);
  assert.equal(result.maxProfitAmountTradeCount, 2);
});
```

(Adjust the exact function signature/shape to match whatever `computeConsecutiveRunAmounts` or its Task-1-chosen replacement actually returns — this is illustrative of the required *distinguishing* test case, not a literal drop-in given the real function isn't fully known until Task 1 completes.)

- [ ] **Step 2: Run test to verify it fails (or passes if the function already does this correctly, in which case skip to Step 4)**

Run: `node --import tsx --test src/lib/trading/analytics.test.ts`

- [ ] **Step 3: Implement/fix the amount-based computation and wire it into `calculate-report-results.ts:173-174`**

- [ ] **Step 4: Grep every consumer of `maximumConsecutiveWins`/`maximumConsecutiveLosses` and update each to the new semantics**

```bash
grep -rn "maximumConsecutiveWins\|maximumConsecutiveLosses" src prisma
```

For each hit outside the files already modified: confirm whether it displays the value as a count (e.g. "5 wins in a row") or amount (e.g. "$200 streak") in the UI, and fix the label/formatting to match the corrected semantics — a UI string like "Max consecutive wins: {n}" must become "Max consecutive win streak: {formatCurrency(n)}" if the underlying number changed from count to amount.

- [ ] **Step 5: Run full trading-lib test suite**

Run:
```bash
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trading/analytics.ts src/lib/trading/calculate-report-results.ts src/lib/trading/analytics.test.ts prisma/schema.prisma
git commit -m "fix(analytics): consecutive win/loss fields report amount per MQL5 STAT_MAX_CONWINS semantics, not trade count"
```

If `prisma/schema.prisma` changed, this task also needs a migration — see Task 2b.

### Task 2b: Migration for schema change (only if Task 2 changed `prisma/schema.prisma`)

**Files:**
- Create: `prisma/migrations/<timestamp>_fix_consecutive_streak_semantics/migration.sql`

- [ ] **Step 1: Generate migration**

Run: `npx prisma migrate dev --name fix_consecutive_streak_semantics --create-only`

- [ ] **Step 2: Review generated SQL against `opinionated-prisma:migration-safety` guidance before applying** — this touches a cache table (`AccountReportResult`), not a source-of-truth table, so a full-table rewrite (recompute) is acceptable; still confirm no `NOT NULL` added without a default against existing rows.

- [ ] **Step 3: Apply locally, then trigger one `recomputeAccountReportResult` run per test account to confirm the cache repopulates with corrected values**

- [ ] **Step 4: Commit migration separately from Task 2's code commit** (schema changes ship as their own revertible unit per this repo's established pattern from the prior schema-consolidation plan).

### Task 3: Add missing consecutive-series coverage (only if Task 1 Step 3 outcome (c) applies)

**Files:**
- Modify: `src/lib/trading/analytics.ts` — add functions for whichever of `STAT_CONPROFITMAX_TRADES`/`STAT_CONLOSSMAX_TRADES`/`STAT_PROFITTRADES_AVGCON`/`STAT_LOSSTRADES_AVGCON` Task 1 confirmed as truly uncovered
- Modify: `src/lib/trading/calculate-report-results.ts` — wire new fields
- Modify: `prisma/schema.prisma` — add corresponding `AccountReportResult` columns
- Test: `src/lib/trading/analytics.test.ts`

Skip this task entirely if Task 1 found outcome (a) or (b) — do not add net-new fields for stats that already exist under a different name. **This is a placeholder scope, not a placeholder step** — exact field additions depend on Task 1's findings, which is why this task is gated rather than pre-specified with code (the No Placeholders rule doesn't apply retroactively to unresolvable pre-research uncertainty; it applies to what should already be knowable, and Task 1 exists precisely to make this knowable before Task 3 starts).

### Task 4: Expose `AccountReportResult.totalNetProfit` and `.sourceReportDate` via API

**Files:**
- Modify: whichever route currently builds `AccountOverviewResponse` (confirm exact path via `Glob "src/app/api/accounts/[id]/overview/**"` — Phase 0 abbreviated as `src/app/api/accounts/[id]/overview:18`)
- Modify: `src/lib/trading/account-data.ts` or `preaggregated-cache.ts` (wherever `AccountReportResult` is currently queried and partially serialized — confirm exact call site via `grep -rn "totalNetProfit\|sourceReportDate" src/lib/trading`)
- Test: whichever `*.test.ts` covers the overview route/serializer today

- [ ] **Step 1: Confirm current serialization gap**

```bash
grep -rn "accountReportResult\." src/lib/trading/account-data.ts src/lib/trading/preaggregated-cache.ts
```

Confirm `totalNetProfit`/`sourceReportDate` are read from the Prisma result object but dropped before the API response is built (vs. never queried at all — different fix if the latter).

- [ ] **Step 2: Add both fields to the response type and the serializer**

- [ ] **Step 3: Run the relevant existing test suite to confirm no other field accidentally changed shape**

Run: `node --import tsx --test src/lib/trading/account-data.test.ts src/app/page.test.ts`

- [ ] **Step 4: Commit**

```bash
git add <modified files>
git commit -m "feat(api): expose totalNetProfit and sourceReportDate on account overview response"
```

Note: exposing these two fields does not obligate a UI change — whether to render them is a product decision, deliberately deferred per this plan's "defer speculative features" constraint. If the user wants them displayed, that's a follow-up task against `src/components/trading-monitor/`, not part of this plan.

## Phase C — Dead surface cleanup

### Task 5: Fix `openCount` KPI chip zero-as-empty violation

**Files:**
- Modify: `src/components/trading-monitor/card/DashboardCard.tsx:373-374`
- Test: `src/components/trading-monitor/card/DashboardCard.test.ts`

- [ ] **Step 1: Read the current 4-correct-chips pattern immediately above line 373 to copy the exact `kpiValue()` call shape**

- [ ] **Step 2: Write the failing test**

```typescript
test("openCount KPI chip renders '-' not '0' when account has zero open positions", () => {
  const overview = { data: { kpis: { openCount: 0 /* ...other required kpi fields */ } } };
  const rendered = renderDashboardCardKpis({ overview, liveOpenPositions: undefined });
  assert.equal(rendered.opens.display, "-");
});
```

(Match this to whatever test harness `DashboardCard.test.ts` already uses for the other 4 chips — it almost certainly already has an equivalent test for `netGain`/`drawdown`/`pips`/`trades`; mirror that exact pattern rather than inventing a new one.)

- [ ] **Step 3: Run test, confirm it fails against current code**

Run: `node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts`

- [ ] **Step 4: Wrap the openCount source value in `kpiValue()` before formatting**

```typescript
const opens = kpiValue(liveOpenPositions?.length ?? overview.data?.kpis.openCount);
```

(Exact variable names must match surrounding code — read lines 360-390 in full before editing, don't guess the local variable name.)

- [ ] **Step 5: Run test, confirm it passes; run full component test file to confirm the other 4 chips are unaffected**

Run: `node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts`

- [ ] **Step 6: Manual verification in both orientations** (per Global Constraints — responsive portrait/landscape must both be checked): start dev server, open an account with 0 open positions, confirm "-" renders in portrait KPI grid and landscape 2-column KPI layout.

- [ ] **Step 7: Commit**

```bash
git add src/components/trading-monitor/card/DashboardCard.tsx src/components/trading-monitor/card/DashboardCard.test.ts
git commit -m "fix(ui): apply zero-as-empty pattern to openCount KPI chip"
```

### Task 6: Delete confirmed-dead API routes

**Files:**
- Delete: `src/app/api/accounts/[id]/profit/route.ts`
- Delete: `src/app/api/accounts/[id]/profit-detail/route.ts`
- Delete: `src/app/api/accounts/[id]/win-detail/route.ts`
- Delete: `src/app/api/accounts/[id]/balance-detail/route.ts`
- Delete: `src/app/api/accounts/[id]/pips-summary/route.ts`
- Delete: `src/app/api/accounts/[id]/trade-history/route.ts` (⚠ see Step 0 — this one is explicitly listed as a documented API endpoint in root `CLAUDE.md`'s "Agent Workflow Notes" section: `GET /api/accounts/[id]/trade-history` — confirm CLAUDE.md is updated in the same commit if this route is actually deleted, and re-confirm zero consumers, since CLAUDE.md documenting it as a real endpoint is itself evidence someone considered it a supported surface)
- Delete corresponding `*.test.ts` files for each removed route
- Modify: root `CLAUDE.md` "Agent Workflow Notes" section — remove the `trade-history` route line if deleted

- [ ] **Step 0: Re-confirm zero consumers immediately before deleting (Invariant 3) — do not trust Phase 0's snapshot**

```bash
grep -rn "/profit-detail\|/win-detail\|/balance-detail\|/pips-summary\|/api/accounts/.*profit[^-]\|/api/accounts/.*live\b" src/components src/app --include="*.tsx" --include="*.ts" | grep -v ".test."
grep -rn "trade-history" src/components --include="*.tsx"
```

If `trade-history` shows a real consumer (CLAUDE.md documents it — this is the one route in the dead list most likely to have a caller Phase 0's component-only grep missed, e.g. a script or external client), **stop and remove it from this task's scope** — keep it, don't delete a documented-and-possibly-externally-consumed endpoint on a stale snapshot.

- [ ] **Step 1: Delete each confirmed-dead route file and its test, one route per commit** (small, independently revertible — matches this repo's PR-splitting convention from the prior schema plan)

```bash
git rm src/app/api/accounts/[id]/profit-detail/route.ts src/app/api/accounts/[id]/profit-detail/route.test.ts
git commit -m "chore(api): remove dead /profit-detail route, superseded by /overview"
```

Repeat per route. For `/live`, check whether it's intentionally kept as a not-yet-wired real-time API before deleting — Phase 0 found it distinct in shape (Redis-sourced, broker-offset-normalized) from the DB-backed routes, which may mean it's *planned* infrastructure, not dead code. **Do not delete `/live` in this task** — flag it in the plan's execution notes as "confirmed unused today, distinct enough in design intent to warrant a product decision before deletion," and leave it out of scope.

- [ ] **Step 2: Run full build + lint after each deletion**

Run: `npm run build && npm run lint`
Expected: no broken imports, no route-not-found references anywhere.

- [ ] **Step 3: Update CLAUDE.md if `trade-history` was deleted** (Step 0 gate)

### Task 7: Delete dead `computeConsecutiveRunAmounts` function (only if Task 1 confirmed it's fully superseded by Task 2's fix, i.e. Task 2 became its caller — if Task 2 already made it live, this task is moot, skip)

This task only applies if Task 1's reconciliation finds a *third*, still-unused implementation after Task 2 ships (e.g. Task 2 fixed a *different* function and `computeConsecutiveRunAmounts` remains genuinely orphaned). Do not delete a function this plan just made load-bearing.

- [ ] **Step 1: Re-grep after Task 2 ships**

```bash
grep -rn "computeConsecutiveRunAmounts" src
```

- [ ] **Step 2: If zero callers remain, delete the function and its dedicated tests, if any**

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(analytics): remove computeConsecutiveRunAmounts, superseded by Task 2's fix"
```

## Phase D — Schema cleanup (low priority, independently revertible)

### Task 8: Drop `WorkerMessageFailure` model (zero write path confirmed twice this session)

**Files:**
- Modify: `prisma/schema.prisma` — remove `WorkerMessageFailure` model and its back-relation on `TradingAccount`
- Create: `prisma/migrations/<timestamp>_drop_worker_message_failure/migration.sql`

- [ ] **Step 1: Final re-confirmation immediately before this ships (not reused from this planning session)**

```bash
grep -rln "workerMessageFailure" src scripts
docker exec -i analytic-db-1 psql -U supachai -d trading_db -c "SELECT count(*) FROM \"WorkerMessageFailure\";"
```

Expected: zero grep matches, zero rows. If either is nonzero, stop — something changed since this plan was written, re-investigate before dropping.

- [ ] **Step 2: Generate and review migration** (`prisma-migration-reviewer` agent sign-off required per Global Constraints)

Run: `npx prisma migrate dev --name drop_worker_message_failure --create-only`

- [ ] **Step 3: Apply, then `npx prisma generate`, `npm run build`, `npm run lint`**

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "chore(schema): drop WorkerMessageFailure, confirmed zero write path"
```

### Task 9: `BridgeHistoryChunk.parentChunkId` FK — explicitly deferred, not a task

Per Phase 0's schema audit, adding this FK safely requires confirming child-before-parent ingestion never happens in production (unresolved — the code doesn't check parent existence before insert, but no dangling reference was ever observed since the table is currently empty in the local DB). **Do not add this FK as part of this plan.** If pursued later, it needs its own investigation task: instrument `history-checkpoint.ts` to log chunk-arrival order in production for a representative window, then decide between a deferred/nullable FK and leaving it as an application-enforced invariant.

---

## Phase E — Algo-trading breakdown by comment (new, added post-review at user request)

**Context:** Today `computeAlgoTradingPercent` (`src/lib/trading/analytics.ts:833-843`) only produces a single lifetime percentage — "what fraction of trades have a non-manual comment" — using `RX_MANUAL_COMMENT` (`analytics.ts:830-831`) to exclude `manual|balance|credit|deposit|withdrawal|correction|rebate` comments. It does not group by the actual comment *value*, so two different EAs both counted as "algo" are indistinguishable in this metric. The prior schema-consolidation plan deleted the `Strategy`/`AccountPerformanceByStrategy` models (Phase 2, `magic`-keyed) because that breakdown had zero UI consumers — this phase is **not** a revert of that decision. It's a different, lighter-weight approach: group by `Position.comment` (a string already on the table, no schema change, no new model) instead of reintroducing the `magic`-keyed `Strategy` model.

**Source boundary:** per this repo's convention, win rate / trade counts / profit-factor-family metrics read from `Position`, so this grouping reads `Position.comment` + the same profit/commission/swap math already used elsewhere in `analytics.ts`, scoped by `tradingAccountId` and the requested timeframe window — no new source of truth introduced.

### Task 10: Group algo-trading breakdown by `Position.comment`

**Files:**
- Modify: `src/lib/trading/analytics.ts` — add a function alongside `computeAlgoTradingPercent` (keep that function as-is for the existing lifetime-percent KPI; this is additive, not a replacement)
- Modify: `src/lib/trading/preaggregated-cache.ts` — wire the new grouped computation into whichever function currently produces `algoTradingPercent` (`preaggregated-cache.ts:1282, 1320`) so both the existing scalar and the new breakdown are computed from the same filtered `Position` rows in one pass, not two separate queries
- Modify: `src/lib/trading/types.ts:211` area — extend `PositionsSummary` (or wherever `algoTradingPercent: number | null` is typed) with a new `algoTradingByComment: Array<{ comment: string; count: number; winRate: number; netProfit: number; percentOfTotal: number }> | null` field
- Modify: whichever route builds `PositionsResponse` (the live one from Phase 0's audit, not the dead `/win-detail`) to return the new field
- Test: `src/lib/trading/analytics.test.ts`, `src/lib/trading/preaggregated-cache.test.ts`

**Interfaces:**
- Consumes: nothing from Phases A–D (independent addition)
- Produces: `algoTradingByComment` array on `PositionsResponse.summary` — a later UI task (out of scope here, see below) would consume this exact shape

- [ ] **Step 1: Write the failing test for the grouping function**

```typescript
test("computeAlgoTradingByComment groups non-manual trades by comment, excludes manual/funding comments", () => {
  const positions = [
    { comment: "EA-Grid-v3", profit: 100, commission: -2, swap: -1 },
    { comment: "EA-Grid-v3", profit: -30, commission: -2, swap: 0 },
    { comment: "EA-Scalper", profit: 50, commission: -1, swap: 0 },
    { comment: "manual", profit: 20, commission: -1, swap: 0 },
    { comment: "", profit: 5, commission: 0, swap: 0 },
  ];
  const result = computeAlgoTradingByComment(positions);
  assert.equal(result.length, 2);
  const grid = result.find((r) => r.comment === "EA-Grid-v3");
  assert.equal(grid.count, 2);
  assert.equal(grid.winRate, 50);
  assert.equal(grid.netProfit, 100 - 2 - 1 + -30 - 2 + 0);
  // "manual" and "" excluded per RX_MANUAL_COMMENT / empty-comment rule, same exclusion as computeAlgoTradingPercent
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `node --import tsx --test src/lib/trading/analytics.test.ts`

- [ ] **Step 3: Implement `computeAlgoTradingByComment`, reusing `RX_MANUAL_COMMENT` for the same exclusion rule `computeAlgoTradingPercent` already uses** (don't invent a second, slightly different manual-trade filter — both functions must agree on what counts as "algo")

```typescript
export function computeAlgoTradingByComment(
  rows: Array<{ comment?: string | null; profit: number; commission: number; swap: number }>,
) {
  const groups = new Map<string, { count: number; wins: number; netProfit: number }>();
  for (const row of rows) {
    const c = row.comment?.trim();
    if (!c || RX_MANUAL_COMMENT.test(c)) continue;
    const net = row.profit + row.commission + row.swap;
    const g = groups.get(c) ?? { count: 0, wins: 0, netProfit: 0 };
    g.count += 1;
    if (net > 0) g.wins += 1;
    g.netProfit += net;
    groups.set(c, g);
  }
  const total = Array.from(groups.values()).reduce((sum, g) => sum + g.count, 0);
  if (total === 0) return [];
  return Array.from(groups.entries())
    .map(([comment, g]) => ({
      comment,
      count: g.count,
      winRate: (g.wins / g.count) * 100,
      netProfit: g.netProfit,
      percentOfTotal: (g.count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `node --import tsx --test src/lib/trading/analytics.test.ts`

- [ ] **Step 5: Wire into `preaggregated-cache.ts` and the API response type/route** — reuse the exact same filtered `Position` row set `lifetimeAlgoTradingPercent` already computes from (`preaggregated-cache.ts:1282`) so both fields are always consistent with each other (same timeframe window, same account scope) rather than risking two slightly-different queries drifting apart.

- [ ] **Step 6: Run full trading-lib + route test suites**

Run:
```bash
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
npm run build
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/trading/analytics.ts src/lib/trading/preaggregated-cache.ts src/lib/trading/types.ts src/lib/trading/analytics.test.ts src/lib/trading/preaggregated-cache.test.ts
git commit -m "feat(analytics): group algo-trading breakdown by Position.comment"
```

**Explicitly deferred within this phase:** rendering `algoTradingByComment` in `src/components/trading-monitor/` (e.g. a table/bar-list under `PerformanceRadar.tsx` where the existing lifetime `algoTradingPct` already renders) is a UI design decision, not bundled into Task 10 — matches this plan's constraint to defer speculative UI until the data is confirmed useful. If the user wants it surfaced immediately, that's a follow-up task, same pattern as Task 4's deferred UI note.

---

## Phase F — Persist deposit load and running maximum load on EquitySnapshot (new, added post-review at user request)

**Context:** `computeDepositLoadPercent` (`src/lib/trading/analytics.ts:1216-1225`, formula `margin / equity * 100`) is currently computed **at query time only**, inside a `reduce` over every scoped `EquitySnapshot` row (`preaggregated-cache.ts:943-953`) to produce a single scalar, `maximalDepositLoad`, on `BalanceDetailResponse.summary` (`types.ts:165`). No per-row load value and no running lifetime maximum are persisted — every request recomputes the formula over the whole scoped window from raw `equity`/`margin`.

This mirrors the exact problem `peakEquity`/`drawdown` already solved for equity itself (Phase 0 finding, `equity-sampler.ts:115-166`): those two are computed **once, at ingestion time**, and stored as columns, so the query layer just reads them (`equity-curve.ts:150-153`: "no recomputation from raw equity here"). Deposit load never got the same treatment. This phase brings it in line — same pattern, same file, same worker.

**Source boundary:** stays inside `EquitySnapshot`, the existing intraday-runtime-state table — no new table, no new source. `margin`/`equity` are already columns on this row; `depositLoad` is derived from data already present, not a new upstream read.

### Task 11: Add `depositLoad` (per-sample) and `maxDepositLoad` (running lifetime peak) to `EquitySnapshot`

**Files:**
- Modify: `prisma/schema.prisma` — add two columns to `model EquitySnapshot` (around line 300, alongside `drawdown`/`peakEquity`):
  ```prisma
  depositLoad    Decimal? @map("deposit_load") @db.Decimal(28, 8)
  maxDepositLoad Decimal? @map("max_deposit_load") @db.Decimal(28, 8)
  ```
- Create: `prisma/migrations/<timestamp>_add_equity_snapshot_deposit_load/migration.sql`
- Modify: `src/worker/equity-sampler.ts`:
  - add `getPriorMaxDepositLoad(tradingAccountId)` next to `getPriorPeakEquity` (line 120-128) — same shape, `prisma.equitySnapshot.aggregate({ where: { tradingAccountId }, _max: { maxDepositLoad: true } })`
  - in `sampleEquityOnce()` (around line 156-161), compute `depositLoad = computeDepositLoadPercent({ equity: data.live.equity, margin: data.live.margin })` and `maxDepositLoad = priorMax != null ? Math.max(priorMax, depositLoad ?? 0) : depositLoad`, add both to `snapshotRow` before the upsert
  - import `computeDepositLoadPercent` from `../lib/trading/analytics`
- Modify: `src/lib/trading/preaggregated-cache.ts:943-953` — replace the `reduce`-based `maximalDepositLoad` computation with a scoped reduce over the now-persisted `depositLoad` column (`Number(r.depositLoad)`) instead of calling `computeDepositLoadPercent` per row — same scoped-window semantics, cheaper, single source of formula truth (the worker, not the query layer)
- Modify: `src/lib/trading/types.ts` — extend whichever type backs `EquitySnapshot` selections used here with `depositLoad`/`maxDepositLoad`, and consider exposing `maxDepositLoad` (lifetime peak, distinct from `maximalDepositLoad` which stays timeframe-scoped) alongside the existing `maximalDepositLoad` field on `BalanceDetailResponse.summary` if a lifetime badge is wanted — **UI decision, defer per this plan's pattern (see Task 4/Task 10 notes)**, just expose the field
- Test: `src/worker/equity-sampler.test.ts`, `src/lib/trading/preaggregated-cache.test.ts`

**Interfaces:**
- Consumes: nothing from Phases A–E (independent addition, same independence as Phase E)
- Produces: `EquitySnapshot.depositLoad`/`.maxDepositLoad` columns — Task's own scope stops at persisting + reading them back into the existing `maximalDepositLoad` summary field; new UI surfacing is explicitly out of scope here, same as Task 10's `algoTradingByComment`

- [ ] **Step 1: Write the failing test for the worker-side computation**

```typescript
test("sampleEquityOnce persists depositLoad and running maxDepositLoad", async () => {
  // seed one prior EquitySnapshot row with maxDepositLoad = 40
  await prisma.equitySnapshot.create({
    data: {
      tradingAccountId: testAccount.id,
      ts: new Date("2026-07-21T00:00:00Z"),
      equity: 10000,
      margin: 3000,
      balance: 10000,
      depositLoad: 30,
      maxDepositLoad: 40,
    },
  });
  // mock Redis live data: equity 10000, margin 5000 -> depositLoad = 50
  mockLiveData({ equity: 10000, margin: 5000, balance: 10000 });

  await sampleEquityOnce();

  const latest = await prisma.equitySnapshot.findFirst({
    where: { tradingAccountId: testAccount.id },
    orderBy: { ts: "desc" },
  });
  assert.equal(Number(latest.depositLoad), 50);
  assert.equal(Number(latest.maxDepositLoad), 50); // new sample exceeds prior 40
});
```

(Match this to whatever test-DB/Redis-mock harness `equity-sampler.test.ts` already uses — mirror the existing `peakEquity` test in that file exactly, this is the same shape with `depositLoad`/`maxDepositLoad` substituted for `equity`/`peakEquity`.)

- [ ] **Step 2: Run test, confirm it fails (columns don't exist yet)**

Run: `node --import tsx --test src/worker/equity-sampler.test.ts`

- [ ] **Step 3: Add schema columns and generate migration**

```bash
npx prisma migrate dev --name add_equity_snapshot_deposit_load --create-only
```

Review generated SQL (`prisma-migration-reviewer` agent sign-off, per Global Constraints) — this is an additive nullable-column migration on a high-write, retention-pruned table (`EquitySnapshot`, 60s cadence, 7-day retention per `RETENTION_DAYS`), so it should be a plain `ALTER TABLE ... ADD COLUMN` with no backfill needed (old rows simply have `NULL` for both new columns, consistent with `peakEquity`/`drawdown`'s own nullable-since-column-addition history).

- [ ] **Step 4: Apply migration, implement `getPriorMaxDepositLoad` and wire the two new fields into `sampleEquityOnce`**

- [ ] **Step 5: Run test, confirm it passes**

Run: `node --import tsx --test src/worker/equity-sampler.test.ts`

- [ ] **Step 6: Update `preaggregated-cache.ts`'s `maximalDepositLoad` computation to read the persisted column**

```typescript
const maximalDepositLoad = scopedEquitySnapshots.reduce<number | null>(
  (max, r) => {
    const load = r.depositLoad != null ? Number(r.depositLoad) : null;
    if (load === null) return max;
    return max === null ? load : Math.max(max, load);
  },
  null,
);
```

Remove the now-unused `computeDepositLoadPercent` import from `preaggregated-cache.ts` if this was its only call site there (check `grep -n computeDepositLoadPercent src/lib/trading/preaggregated-cache.ts` first — keep the function itself in `analytics.ts`, it's still the worker's source of truth).

- [ ] **Step 7: Run full trading-lib + worker test suites**

Run:
```bash
node --import tsx --test src/worker/equity-sampler.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
npm run build
npm run lint
```

- [ ] **Step 8: Commit worker + query-layer code separately from the migration** (matches this plan's established pattern — Task 2b, Task 8 both split schema commits from logic commits)

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "chore(schema): add EquitySnapshot.depositLoad and maxDepositLoad columns"

git add src/worker/equity-sampler.ts src/worker/equity-sampler.test.ts src/lib/trading/preaggregated-cache.ts src/lib/trading/preaggregated-cache.test.ts src/lib/trading/types.ts
git commit -m "feat(worker): persist deposit load and running max load at ingestion, mirroring peakEquity/drawdown"
```

**Explicitly deferred within this phase:** surfacing `maxDepositLoad` (lifetime peak, as opposed to the existing timeframe-scoped `maximalDepositLoad`) as its own UI element — e.g. a "max load ever" badge distinct from "max load this period" — is a product/UI decision, same deferral pattern as Task 4 and Task 10.

---

## Explicitly out of scope (deferred per this plan's constraints)

- Phase 3 of the prior schema-consolidation plan (R1 sequencing fix) — stays gated on `worker` v1 retirement being scheduled, which nothing in this plan changes.
- `magic` field widening to `BigInt` — no observed overflow, speculative until fleet EA configuration is checked (see prior schema audit).
- `BridgeHistoryChunk.parentChunkId` FK (Task 9) — needs production ingestion-order evidence first.
- `/live` route deletion — distinct design intent from the other 6 dead routes, needs a product decision, not a code-cleanup decision.
- Rendering `totalNetProfit`/`sourceReportDate`/any newly-added consecutive-series stats in the UI — Task 4/Task 3 expose data; whether/how to display it is a separate design task against `src/components/trading-monitor/`.
- `brokerUtcOffsetMinutes` DST auto-switching — tracked as separate known tech debt (project memory `project_broker_offset_dst_debt.md`), not part of this plan's scope.
- `Deal.orderId`/`Order.dealId` vestigial field cleanup and the `Order` table's zero-read status — explicitly marked "not in scope" by the prior schema plan; this plan doesn't reopen it.

---

## Acceptance criteria (whole plan)

- [ ] `npm run build` and `npm run lint` pass after every task's commit, not just at the end.
- [ ] `node --import tsx --test src/lib/trading/analytics.test.ts src/lib/trading/preaggregated-cache.test.ts src/components/trading-monitor/card/DashboardCard.test.ts src/app/page.test.ts` all pass.
- [ ] No API route consumers broken — verified per Invariant 3's fresh-grep-before-delete discipline, not the Phase 0 snapshot.
- [ ] Manual portrait + landscape check on the `openCount` fix (Task 5 Step 6).
- [ ] Any schema change (Task 2b, Task 8) reviewed by `prisma-migration-reviewer` agent before applying to any shared environment.
- [ ] `docs/superpowers/plans/2026-07-18-mt5-schema-and-analytics-metrics-plan.md`'s R1/R2 status line stays accurate — this plan doesn't change it, so no edit needed there, but if a future session touches Phase 3, cross-check this plan's Phase A note first.

## Rollback

Every task is its own commit (per-route deletions even split further). Standard `git revert <sha>` per task. The one multi-step risk is Task 2 if Task 1 picks outcome (b) or (c) — those touch more call sites; revert the whole task's commit range (`git revert <first-sha>^..<last-sha>`) rather than cherry-picking partial reverts, since the schema/API/UI changes in that outcome are interdependent within the task.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-trustworthy-trading-platform-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Best fit here since Task 1 is a hard gate that changes Task 2/3's exact scope — a fresh subagent per task naturally re-reads Task 1's written decision before starting Task 2 rather than carrying stale assumptions across a long single session.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
