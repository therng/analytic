# MT5 Schema Consolidation & Analytics Metrics — Migration Plan

**Status:** Phases 1, 2, 4, 5 done, verified (2026-07-22). Phase 3 dormant — `worker` v1 retirement never scheduled, so R1 sequencing dependency never due. `ClosedPosition`, `AccountPerformanceBySymbol`/`AccountPerformanceByStrategy`, `Strategy` dropped; `Position` sole closed-trade source.

**Goal:** Resolve duplicate/dormant Prisma models around position lifecycle
(`Position` vs `ClosedPosition`, `OpenPosition` vs `PositionState`) and four
never-wired models (`PositionState`, `EquityState`, `Symbol`, `RiskMetricsSnapshot`),
via expand → migrate → switch → contract. Ship separate, independently
revertible PRs — never combine schema change with reader switch.

**Why doc exists:** `docs/architecture-data-models.md` already references this
file (three times) as plan governing "Technical Debt" deletions. Didn't
exist. This that file, backed by full Phase 0 code inventory (not assumptions).

---

## Domain design (locked)

| Model | Role | Fate |
|---|---|---|
| `Deal` / `Order` | Immutable MT5 execution/order events | Keep as-is. Source of truth for reconstruction. |
| `OpenPosition` | Live snapshot of currently-open positions (delete+recreate every poll) | Keep as-is. Confirmed correctly keyed (`tradingAccountId` = cuid) by both live writers. |
| `PositionExcursion` | Per-tick MAE/MFE samples while position open | Keep, but see Risk R1 below — only writer lives in worker being retired. |
| `Position` | Reconstructed lifecycle, closed-trade analytics | **Becomes sole source of truth.** Already is, in practice — every live dashboard feature reads it. |
| `ClosedPosition` | Duplicate of `Position`'s closed-trade shape | **Contract candidate.** One live consumer (`aggregate-performance.ts`), itself zero frontend callers today. |
| `PositionState` | Early-design MAE/MFE runtime state, FK footgun (`account_number` must hold cuid despite name) | **Drop. Zero writers, zero readers, confirmed by exhaustive grep.** |
| `EquityState` | Early-design equity source, raw snake_case fields (breaks naming convention) | **Drop.** Superseded by `EquitySnapshot`. |
| `Symbol` | Symbol spec cache | **Drop.** Never wired up, no writer ever existed. |
| `RiskMetricsSnapshot` | Sharpe/Sortino/VaR snapshot | **Drop.** Never wired up either side. |

## Invariants (must hold after migration, hold today for live paths)

1. One `(tradingAccountId, positionNo)` → at most one `Position` row.
2. Partial close: `closeTime` stays `null`, MAE/MFE stay unfinalized.
3. Fully closed (remaining volume = 0): set `closeTime`, aggregate `PositionExcursion`
   between `openTime`/`closeTime` into `mae`/`mfe`, upsert.
4. Ticket strings (`positionTicket`, `dealNo`, `orderTicket`) never cross accounts —
   every query and unique constraint scoped by `tradingAccountId` first.
5. `PositionExcursion` must have live writer as long as `Position.mae/mfe`
   expected non-null for newly-closed positions (see R1).

---

## Phase 0 — Inventory (COMPLETE — this section record of it)

### `Position` vs `ClosedPosition`

**Writers** (all upsert both models; two of three paths atomic):

| Path | Position | ClosedPosition | Atomic together? |
|---|---|---|---|
| `worker/bridge-consumer.ts` (legacy, live) | `:172` unconditional | `:184` gated by `if (accountNo)` | **No — confirmed live divergence risk today** |
| `worker/history-checkpoint.ts` (legacy backfill) | `:459` | `:469` | Yes, same `tx.$transaction` |
| `worker-v2/position-reconstructor.ts` (current prod) | `:295` | `:341` | Yes, same `prisma.$transaction([...])` |
| `worker-v3/processors/position-reconstructor.ts` | `:273` | `:315` | Dead code — no entrypoint, no npm script, nothing calls it |

**Readers:**

- `Position`: `trade-history.ts` (trade history API), `calculate-report-results.ts`
  (`AccountReportResult` cache), `account-data.ts` (whole dashboard bundle —
  overview/growth/win/profit/pips/symbols/holding-time via `preaggregated-cache.ts`).
  Every live user-facing feature.
- `ClosedPosition`: only `worker/aggregate-performance.ts`, computes
  `AccountPerformanceBySymbol`/`AccountPerformanceByStrategy`. That API branch
  (`route.ts` `?groupBy=symbol|strategy`) has **zero frontend callers anywhere in
  `src/components`** — confirmed grep for `groupBy=` across whole tree.

**Verdict:** two tables have three write paths keeping near-lockstep,
except legacy conditional gap above. Only one real consumer for
`ClosedPosition`, dead feature branch today. Consolidating onto
`Position` safe *for live dashboard* — only decision left: what to
do with symbol/strategy breakdown (see Phase 4).

**Naming trap for whoever executes this:** `isClosedPosition`/`summarizeClosedPositions`/
`closedPositionSummary` in `analytics.ts`/`preaggregated-cache.ts` operate on
**`Position`** rows filtered by `closeTime != null` — nothing to do with
`ClosedPosition` model. Don't let `grep -i closedposition` mislead into
thinking more real consumers exist than there are.

### `OpenPosition` vs `PositionState`

- `OpenPosition`: two live writers (`worker/equity-sampler.ts`, `worker-v2/live-sync.ts`),
  both correctly pass `account.id` (cuid). No bug. Read throughout dashboard
  (positions panel, account overview, positions API) — separate live Redis path
  (`useLiveData` in `DashboardCard.tsx`) preferred over DB value when fresh,
  DB value fallback.
- `PositionState`: **zero writers, zero readers, anywhere** — confirmed by
  exhaustive grep across `.ts/.tsx/.js/.py/.sql/.md`. FK footgun
  (`account_number` must hold `TradingAccount.id`, not `accountNo`, despite
  field name) real per schema's own relation definition, but landmine for
  future implementer, not active bug — nothing ever triggered it.

**Verdict:** not redundant, one live one abandoned. `OpenPosition` needs no
changes. `PositionState` zero-risk drop.

### `PositionExcursion` / `Deal` / `Order`

- All three key on MT5 ticket strings (`positionTicket`, `dealNo`, `orderTicket`),
  never Prisma cuid `id`. No relation-type confusion found anywhere.
- **MAE/MFE finalization happens in exactly one live place**:
  `worker-v2/position-reconstructor.ts:286`, aggregating `PositionExcursion`
  between `openTime`/`closeTime` via `computePositionMaeMfe`
  (`src/lib/trading/position-excursion.ts`), right before `Position`/
  `ClosedPosition` upsert transaction. Identical `worker-v3` copy dead code.
- **Second, legacy finalization path** exists: `worker/bridge-mapper.ts:143-144`
  writes `Position.mae/mfe` straight from bridge-supplied payload field, no
  `PositionExcursion` involved. Only fires for accounts still fed by
  *old* Python bridge — `bridge_v2` explicitly doesn't emit MAE/MFE or
  position-closed events (`bridge_v2/__init__.py:8`).
- **R1 — risk that matters most for sequencing:** `PositionExcursion`'s only
  writer `worker/equity-sampler.ts` (legacy `worker` v1, 60s cadence, 7-day
  retention). Only consumer `worker-v2`'s finalizer. Two
  different worker processes. **If `worker` v1 retired/decommissioned as part
  of any future consolidation without first moving sampler into `worker-v2`
  (or replacement), `worker-v2`'s MAE/MFE finalization silently degrades
  to `null` — aggregate query just returns no rows, no error, no signal.**
- **R2 — retention window:** `PositionExcursion` prunes at 7 days
  (`RETENTION_DAYS = 7`). Any position open longer than 7 days, or
  reconstruction running more than 7 days after close, aggregates over
  truncated or fully-pruned window. Caps what "aggregate PositionExcursion
  between open/close" can produce today, independent of this migration — worth
  decision (extend retention, or accept best-effort MAE/MFE for long-held
  positions) before leaning on it harder.
- `Deal.orderId` — written, never read anywhere. Vestigial.
- `Order.dealId` — hardcoded `null` in every mapper. Vestigial.
- `Order` table itself — **write-only, zero reads anywhere in app** (confirmed:
  no `.order.find*`/`aggregate`/`groupBy` outside tests). Kept for future use;
  not part of this migration's scope, but worth knowing nothing depends on it today.
- `Deal.positionId` — the one real, load-bearing string join: written by every
  mapper, read at `worker-v2/deal-consumer.ts` to trigger `reconstructPositionIfClosed`.
  Actual mechanism whole reconstruction pipeline runs on.

**Raw SQL / bridge_v2 direct DB access:** none, anywhere. `bridge_v2` (Python) has
no Postgres/Prisma/SQLAlchemy import at all — Redis only. Every worker write/read
against these 7 models goes through Prisma client; only raw SQL touching
them `scripts/cleanup.ts` (dev-only full-table `TRUNCATE`).

---

## Phase 1 — Additive schema (no writer/reader changes) — COMPLETE (2026-07-19)

Ship as own PR. Non-destructive only.

- [x] Dropped `PositionState`, `EquityState`, `Symbol`, `RiskMetricsSnapshot` models
      and back-relations on `TradingAccount`/`OpenPosition`. Production row
      counts confirmed zero before deployment (verified live via direct
      psql query, not assumed from code inventory alone).
- [x] Preserved intentional `if (accountNo)` behavior in
      `worker/bridge-consumer.ts` — existing test asserts when `accountNo`
      `undefined`, `Position` written and `ClosedPosition` correctly
      skipped, no error. Not the bug. Actual divergence risk: atomicity —
      when `accountNo` *is* present (only case that happens in
      production — `drainStream` always supplies it), `Position` and
      `ClosedPosition` upserts were two separate, non-atomic calls, so crash
      between them could leave `Position` written with no `ClosedPosition`
      counterpart. Fixed by executing `Position` and eligible `ClosedPosition`
      upserts atomically through `client.$transaction` when client supports
      it (real `prisma` client always does), falling back to sequential —
      today's exact behavior — when it doesn't (unit test's fake client). New
      test covers atomic path; existing accountNo-undefined test
      unchanged, still passes.
- [x] Added `@db.Decimal(28, 8)` to all 13 previously untyped `Decimal` columns on
      `ClosedPosition`, after validating existing data — 20,727 rows checked for
      truncation risk; only one row had float noise past 8 decimal places, safely
      rounded, no real precision lost.
- [x] Added `Deal @@index([tradingAccountId, type, time])`.
- [x] Added `Position @@index([tradingAccountId, symbol, closeTime])`.

**Verification:** Prisma validation and generation passed, lint passed, application
build passed. Bridge worker tests passed 7/7. Broader worker
suite passed 67/68, one confirmed pre-existing unrelated skip (verified via
`git stash` fails identically without this work applied). Cross-domain
review found no issues.

## Phase 2 — Decide fate of ClosedPosition's one consumer — COMPLETE (2026-07-22)

- [x] Confirmed: `groupBy=symbol|strategy` had zero UI consumers (re-verified,
      matching original inventory). Decision: not wanted.
- [x] Deleted `aggregate-performance.ts`'s job (and call site in
      `worker/index.ts`), `AccountPerformanceBySymbol`/
      `AccountPerformanceByStrategy` models, dead `groupBy=` API branch in
      `route.ts`, and `Strategy` (only consumer that same branch, so
      went fully orphaned as direct consequence of this decision — not
      originally in this plan's scope, but same logic applied).

Left `ClosedPosition` with zero live readers — precondition for
Phase 5's drop.

## Phase 3 — Fix writer (worker-v2 only; legacy `worker` stays as-is until retired)

- [ ] Keep dual-write (`Position` + `ClosedPosition`) through this phase — don't
      stop writing `ClosedPosition` until Phase 2 resolved and Phase 4 confirms
      parity. `Position` remains authoritative throughout.
- [ ] Resolve R1 explicitly: before `worker` v1 ever retired as part of any
      future worker consolidation, `equity-sampler.ts`'s `PositionExcursion`
      write must move to `worker-v2` (or eventual replacement) first, in
      separate PR, verified by confirming `Position.mae/mfe` still populates on
      newly-closed positions with `worker` v1 stopped in test environment.
      Hard sequencing dependency, not nice-to-have.
- [ ] Don't promote `worker-v3`'s duplicate `position-reconstructor.ts` — already
      silently diverged from `worker-v2`'s copy (missing `magic`/`reason`,
      different `corrupted.reason` shape). Dedupe against v2 first if v3 ever
      revived; don't assume safe drop-in.

## Phase 4 — Validate data parity — COMPLETE (2026-07-22, verified against real data)

- [x] `Position` vs `ClosedPosition` row-count and dollar-sum parity per account:
      closed count, gross profit/loss, commission, swap, volume, MAE/MFE null rate.
      **Re-run after VPS bridge fixed and real backfill data landed**
      (21,378 closed positions across 4 accounts): 100% match on every metric,
      0 orphans, 0 duplicate keys. Earlier same-day pass against empty
      DB vacuous — this real verdict. (Verification script,
      `scripts/verify-position-closedposition-parity.ts`, now deleted along
      with `ClosedPosition` itself — only purpose was this check.)
- [x] Confirmed `bridge-consumer.ts` gap (Phase 1 fix) left no orphans:
      0 out of 21,378 closed `Position` rows lacked `ClosedPosition` counterpart.
- [x] Duplicate `(tradingAccountId, positionNo)` check: 0 duplicates in either table.

## Phase 5 — Contract — COMPLETE (2026-07-22)

- [x] Stopped `ClosedPosition` writes in `worker-v2`/`worker` (all 3 live
      writer sites: `bridge-consumer.ts`, `history-checkpoint.ts`,
      `worker-v2/position-reconstructor.ts`). `worker-v3`'s duplicate copy
      deliberately left untouched — dead code, no entrypoint, plan
      already flags unsafe to assume drop-in match with `worker-v2`.
- [x] Deployed (rebuilt + restarted `web`/`worker`/`worker-v2` containers),
      observed: no worker errors, dashboard unaffected (nothing live read
      `ClosedPosition` post-Phase 2).
- [x] Dropped `ClosedPosition`, `AccountPerformanceBySymbol`,
      `AccountPerformanceByStrategy`, `Strategy` models + relations in
      migration `20260722002030_drop_closedposition_and_dead_performance_models`.
      No separate staging/prod environment exists for this repo today (single
      local docker-compose stack), so drop happened same session as
      write-stop rather than after separate observed poll-cycle window —
      accepted risk, explicitly confirmed with user first.
- [x] Updated `docs/architecture-data-models.md`'s Technical Debt section to
      remove now-resolved items.

## Not in scope for this plan

- `Order` table's zero-read status — flagged, not actioned. No writer/reader
  bug, just unused today; revisit only if feature needs it.
- `Deal.orderId` / `Order.dealId` vestigial fields — harmless as-is, rename/drop
  only if doing broader `Deal`/`Order` schema pass.
- Field renames (`positionId`→`positionTicket` etc.) for clarity — cosmetic,
  bundle into whichever phase touches those models anyway rather than
  dedicated pass.
- `worker` v1 retirement itself — out of scope here; plan only records
  R1 dependency it must satisfy *before* that retirement happens.

## PR breakdown

1. Phase 1 (additive schema + drop 4 zero-writer models + fix
   `bridge-consumer.ts` gap) — independently revertible, no reader changes. **Shipped.**
2. Phase 2 decision + implementation (recompute-from-Position or delete
   symbol/strategy breakdown).
3. Phase 3 (R1 sequencing fix, only if/when `worker` v1 retirement actually
   scheduled — otherwise phase dormant).
4. Phase 4 validation scripts (can ship as standalone script in `scripts/`,
   run manually before Phase 5).
5. Phase 5 contract (stop writes → observe → drop table), split into two
   deploys minimum.