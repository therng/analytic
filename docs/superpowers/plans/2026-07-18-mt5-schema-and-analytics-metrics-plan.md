# MT5 Schema Consolidation & Analytics Metrics — Migration Plan

**Status:** Phase 1 complete and verified. Migration `20260719222335_mt5_schema_phase1_drop_dead_models` has been deployed. No reader switch or `ClosedPosition` contract changes have been made.

**Goal:** Resolve the duplicate/dormant Prisma models around position lifecycle
(`Position` vs `ClosedPosition`, `OpenPosition` vs `PositionState`) and the four
never-wired models (`PositionState`, `EquityState`, `Symbol`, `RiskMetricsSnapshot`),
using expand → migrate → switch → contract. Ship in separate, independently
revertible PRs — never combine a schema change with a reader switch.

**Why this doc exists:** `docs/architecture-data-models.md` already references this
file (three times) as the plan governing the "Technical Debt" deletions. It didn't
exist. This is that file, backed by a full Phase 0 code inventory (not assumptions).

---

## Domain design (locked)

| Model | Role | Fate |
|---|---|---|
| `Deal` / `Order` | Immutable MT5 execution/order events | Keep as-is. Source of truth for reconstruction. |
| `OpenPosition` | Live snapshot of currently-open positions (delete+recreate every poll) | Keep as-is. Confirmed correctly keyed (`tradingAccountId` = cuid) by both live writers. |
| `PositionExcursion` | Per-tick MAE/MFE samples while a position is open | Keep, but see Risk R1 below — its only writer lives in the worker being retired. |
| `Position` | Reconstructed lifecycle, closed-trade analytics | **Becomes the sole source of truth.** Already is, in practice — every live dashboard feature reads it. |
| `ClosedPosition` | Duplicate of `Position`'s closed-trade shape | **Contract candidate.** One live consumer (`aggregate-performance.ts`), which itself has zero frontend callers today. |
| `PositionState` | Early-design MAE/MFE runtime state, FK footgun (`account_number` must hold a cuid despite the name) | **Drop. Zero writers, zero readers, confirmed by exhaustive grep.** |
| `EquityState` | Early-design equity source, raw snake_case fields (breaks naming convention) | **Drop.** Superseded by `EquitySnapshot`. |
| `Symbol` | Symbol spec cache | **Drop.** Never wired up, no writer ever existed. |
| `RiskMetricsSnapshot` | Sharpe/Sortino/VaR snapshot | **Drop.** Never wired up on either side. |

## Invariants (must hold after migration, hold today for the live paths)

1. One `(tradingAccountId, positionNo)` → at most one `Position` row.
2. Partial close: `closeTime` stays `null`, MAE/MFE stay unfinalized.
3. Fully closed (remaining volume = 0): set `closeTime`, aggregate `PositionExcursion`
   between `openTime`/`closeTime` into `mae`/`mfe`, upsert.
4. Ticket strings (`positionTicket`, `dealNo`, `orderTicket`) never cross accounts —
   every query and unique constraint is scoped by `tradingAccountId` first.
5. `PositionExcursion` must have a live writer for as long as `Position.mae/mfe`
   is expected to be non-null for newly-closed positions (see R1).

---

## Phase 0 — Inventory (COMPLETE — this section is the record of it)

### `Position` vs `ClosedPosition`

**Writers** (all upsert both models; two of three paths are atomic):

| Path | Position | ClosedPosition | Atomic together? |
|---|---|---|---|
| `worker/bridge-consumer.ts` (legacy, live) | `:172` unconditional | `:184` gated by `if (accountNo)` | **No — confirmed live divergence risk today** |
| `worker/history-checkpoint.ts` (legacy backfill) | `:459` | `:469` | Yes, same `tx.$transaction` |
| `worker-v2/position-reconstructor.ts` (current prod) | `:295` | `:341` | Yes, same `prisma.$transaction([...])` |
| `worker-v3/processors/position-reconstructor.ts` | `:273` | `:315` | Dead code — no entrypoint, no npm script, nothing calls it |

**Readers:**

- `Position`: `trade-history.ts` (trade history API), `calculate-report-results.ts`
  (`AccountReportResult` cache), `account-data.ts` (the whole dashboard bundle —
  overview/growth/win/profit/pips/symbols/holding-time via `preaggregated-cache.ts`).
  This is every live user-facing feature.
- `ClosedPosition`: only `worker/aggregate-performance.ts`, which computes
  `AccountPerformanceBySymbol`/`AccountPerformanceByStrategy`. That API branch
  (`route.ts` `?groupBy=symbol|strategy`) has **zero frontend callers anywhere in
  `src/components`** — confirmed by grep for `groupBy=` across the whole tree.

**Verdict:** the two tables have three write paths keeping them in near-lockstep,
except the legacy conditional gap above. Only one real consumer exists for
`ClosedPosition`, and it's a dead feature branch today. Consolidating onto
`Position` is safe *for the live dashboard* — the only decision left is what to
do with the symbol/strategy breakdown (see Phase 4).

**Naming trap for whoever executes this:** `isClosedPosition`/`summarizeClosedPositions`/
`closedPositionSummary` in `analytics.ts`/`preaggregated-cache.ts` operate on
**`Position`** rows filtered by `closeTime != null` — nothing to do with the
`ClosedPosition` model. Don't let a `grep -i closedposition` mislead you into
thinking there are more real consumers than there are.

### `OpenPosition` vs `PositionState`

- `OpenPosition`: two live writers (`worker/equity-sampler.ts`, `worker-v2/live-sync.ts`),
  both correctly pass `account.id` (cuid). No bug. Read throughout the dashboard
  (positions panel, account overview, positions API) — a separate live Redis path
  (`useLiveData` in `DashboardCard.tsx`) is preferred over the DB value when fresh,
  DB value is the fallback.
- `PositionState`: **zero writers, zero readers, anywhere** — confirmed by
  exhaustive grep across `.ts/.tsx/.js/.py/.sql/.md`. The FK footgun
  (`account_number` must hold `TradingAccount.id`, not `accountNo`, despite the
  field name) is real per the schema's own relation definition, but it's a
  landmine for a future implementer, not an active bug — nothing has ever
  triggered it.

**Verdict:** not redundant, one live one abandoned. `OpenPosition` needs no
changes. `PositionState` is a zero-risk drop.

### `PositionExcursion` / `Deal` / `Order`

- All three key on MT5 ticket strings (`positionTicket`, `dealNo`, `orderTicket`),
  never the Prisma cuid `id`. No relation-type confusion found anywhere.
- **MAE/MFE finalization happens in exactly one live place**:
  `worker-v2/position-reconstructor.ts:286`, aggregating `PositionExcursion`
  between `openTime`/`closeTime` via `computePositionMaeMfe`
  (`src/lib/trading/position-excursion.ts`), right before the `Position`/
  `ClosedPosition` upsert transaction. The identical `worker-v3` copy is dead code.
- A **second, legacy finalization path** exists: `worker/bridge-mapper.ts:143-144`
  writes `Position.mae/mfe` straight from a bridge-supplied payload field, no
  `PositionExcursion` involved at all. This only fires for accounts still fed by
  the *old* Python bridge — `bridge_v2` explicitly does not emit MAE/MFE or
  position-closed events (`bridge_v2/__init__.py:8`).
- **R1 — the risk that matters most for sequencing:** `PositionExcursion`'s only
  writer is `worker/equity-sampler.ts` (legacy `worker` v1, 60s cadence, 7-day
  retention). Its only consumer is `worker-v2`'s finalizer. These are two
  different worker processes. **If `worker` v1 is retired/decommissioned as part
  of any future consolidation without first moving the sampler into `worker-v2`
  (or wherever replaces it), `worker-v2`'s MAE/MFE finalization silently degrades
  to `null` — the aggregate query just returns no rows, no error, no signal.**
- **R2 — retention window:** `PositionExcursion` prunes at 7 days
  (`RETENTION_DAYS = 7`). Any position open longer than 7 days, or any
  reconstruction running more than 7 days after close, aggregates over a
  truncated or fully-pruned window. This caps what "aggregate PositionExcursion
  between open/close" can produce today, independent of this migration — worth
  a decision (extend retention, or accept best-effort MAE/MFE for long-held
  positions) before leaning on it harder.
- `Deal.orderId` — written, never read anywhere. Vestigial.
- `Order.dealId` — hardcoded `null` in every mapper. Vestigial.
- `Order` table itself — **write-only, zero reads anywhere in the app** (confirmed:
  no `.order.find*`/`aggregate`/`groupBy` outside tests). Kept for future use;
  not part of this migration's scope, but worth knowing nothing depends on it today.
- `Deal.positionId` — the one real, load-bearing string join: written by every
  mapper, read at `worker-v2/deal-consumer.ts` to trigger `reconstructPositionIfClosed`.
  This is the actual mechanism the whole reconstruction pipeline runs on.

**Raw SQL / bridge_v2 direct DB access:** none, anywhere. `bridge_v2` (Python) has
no Postgres/Prisma/SQLAlchemy import at all — Redis only. Every worker write/read
against these 7 models goes through the Prisma client; the only raw SQL touching
them is `scripts/cleanup.ts` (dev-only full-table `TRUNCATE`).

---

## Phase 1 — Additive schema (no writer/reader changes) — COMPLETE (2026-07-19)

Ship as its own PR. Non-destructive only.

- [x] Dropped `PositionState`, `EquityState`, `Symbol`, `RiskMetricsSnapshot` models
      and their back-relations on `TradingAccount`/`OpenPosition`. Production row
      counts were confirmed as zero before deployment (verified live via direct
      psql query, not assumed from the code inventory alone).
- [x] Preserved the intentional `if (accountNo)` behavior in
      `worker/bridge-consumer.ts` — an existing test asserts that when `accountNo`
      is `undefined`, `Position` is written and `ClosedPosition` is correctly
      skipped, without error. That is not the bug. The actual divergence risk was
      atomicity: when `accountNo` *is* present (the only case that happens in
      production — `drainStream` always supplies it), the `Position` and
      `ClosedPosition` upserts were two separate, non-atomic calls, so a crash
      between them could leave `Position` written with no `ClosedPosition`
      counterpart. Fixed by executing the `Position` and eligible `ClosedPosition`
      upserts atomically through `client.$transaction` when the client supports
      it (the real `prisma` client always does), falling back to sequential —
      today's exact behavior — when it doesn't (the unit test's fake client). A
      new test covers the atomic path; the existing accountNo-undefined test is
      unchanged and still passes.
- [x] Added `@db.Decimal(28, 8)` to all 13 previously untyped `Decimal` columns on
      `ClosedPosition`, after validating existing data — 20,727 rows checked for
      truncation risk; only one row had float noise past 8 decimal places, safely
      rounded, no real precision lost.
- [x] Added `Deal @@index([tradingAccountId, type, time])`.
- [x] Added `Position @@index([tradingAccountId, symbol, closeTime])`.

**Verification:** Prisma validation and generation passed, lint passed, and the
application build passed. Bridge worker tests passed 7/7. The broader worker
suite passed 67/68, with one confirmed pre-existing unrelated skip (verified via
`git stash` that it fails identically without this work applied). Cross-domain
review found no issues.

## Phase 2 — Decide the fate of ClosedPosition's one consumer

Before touching `ClosedPosition` itself, resolve `AccountPerformanceBySymbol`/
`AccountPerformanceByStrategy` — the sole reason `ClosedPosition` still has a
live reader:

- [ ] Confirm with product/UI: is the `groupBy=symbol|strategy` breakdown wanted?
      It's fully computed and typed server-side (`preaggregated-cache.ts`
      `bySymbol`/`openBySymbol`) but has **zero UI consumer today** per both
      this inventory and `docs/architecture-data-models.md`'s own Symbols-tab note.
- [ ] **If wanted:** recompute it from `Position` + `Deal` instead of
      `ClosedPosition`, matching every other metric's source-boundary rule
      (`Position` = win rate/profit factor/averages, per CLAUDE.md). This
      removes `ClosedPosition`'s last reason to exist.
- [ ] **If not wanted:** delete `aggregate-performance.ts`'s job,
      `AccountPerformanceBySymbol`/`AccountPerformanceByStrategy` models, and the
      dead `groupBy=` API branch outright. Simpler, and nothing today depends on it.

Either branch ends with `ClosedPosition` having zero live readers — the
precondition for Phase 5's drop.

## Phase 3 — Fix the writer (worker-v2 only; legacy `worker` stays as-is until retired)

- [ ] Keep dual-write (`Position` + `ClosedPosition`) through this phase — do not
      stop writing `ClosedPosition` until Phase 2 is resolved and Phase 4 confirms
      parity. `Position` remains authoritative throughout.
- [ ] Resolve R1 explicitly: before `worker` v1 is ever retired as part of any
      future worker consolidation, `equity-sampler.ts`'s `PositionExcursion`
      write must move to `worker-v2` (or its eventual replacement) first, in a
      separate PR, verified by confirming `Position.mae/mfe` still populates on
      newly-closed positions with `worker` v1 stopped in a test environment.
      This is a hard sequencing dependency, not a nice-to-have.
- [ ] Do not promote `worker-v3`'s duplicate `position-reconstructor.ts` — it has
      already silently diverged from `worker-v2`'s copy (missing `magic`/`reason`,
      different `corrupted.reason` shape). Dedupe against v2 first if v3 is ever
      revived; don't assume it's a safe drop-in.

## Phase 4 — Validate data parity

Before any reader switches (there's really only one to switch — see Phase 2):

- [ ] `Position` vs `ClosedPosition` row-count and dollar-sum parity per account:
      closed count, gross profit/loss, commission, swap, volume, MAE/MFE null rate.
- [ ] Confirm the `bridge-consumer.ts` gap (Phase 1 fix) hasn't left historical
      accounts with `Position` rows lacking a `ClosedPosition` counterpart —
      query for orphans before relying on parity checks that assume 1:1.
- [ ] Duplicate `(tradingAccountId, positionNo)` check across both tables.

## Phase 5 — Contract

- [ ] Stop `ClosedPosition` writes in `worker-v2`/`worker` (both writer sites).
- [ ] Deploy, observe (worker errors, dashboard empty states — should be none,
      since nothing live reads `ClosedPosition` post-Phase 2).
- [ ] Drop `ClosedPosition` model + relations in a follow-up migration once
      confirmed clean in production for one full poll cycle window.
- [ ] Update `docs/architecture-data-models.md`'s Technical Debt section to
      remove the now-resolved items.

## Not in scope for this plan

- `Order` table's zero-read status — flagged, not actioned. No writer/reader
  bug, just unused today; revisit only if a feature needs it.
- `Deal.orderId` / `Order.dealId` vestigial fields — harmless as-is, rename/drop
  only if doing a broader `Deal`/`Order` schema pass.
- Field renames (`positionId`→`positionTicket` etc.) for clarity — cosmetic,
  bundle into whichever phase touches those models anyway rather than a
  dedicated pass.
- `worker` v1 retirement itself — out of scope here; this plan only records the
  R1 dependency it must satisfy *before* that retirement happens.

## PR breakdown

1. Phase 1 (additive schema + drop the 4 zero-writer models + fix the
   `bridge-consumer.ts` gap) — independently revertible, no reader changes. **Shipped.**
2. Phase 2 decision + implementation (recompute-from-Position or delete
   symbol/strategy breakdown).
3. Phase 3 (R1 sequencing fix, only if/when `worker` v1 retirement is actually
   scheduled — otherwise this phase is dormant).
4. Phase 4 validation scripts (can ship as a standalone script in `scripts/`,
   run manually before Phase 5).
5. Phase 5 contract (stop writes → observe → drop table), split into two
   deploys minimum.
