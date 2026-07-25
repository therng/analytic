# Worker V3 — Implementation Plan & V2 Gap Analysis

**Status banner (2026-07-16):** Gated by [`docs/superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md`](superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md) Package 6 — start broad P2 schema work only after all accounts pass the new plan's coverage acceptance criteria.

Companion to `worker-v3-redis-contract.md`. Written after inspecting the actual
repository (Prisma schema, `src/worker/`, `src/worker-v2/`, `bridge_v2/`).

## 0. Approach: build V3, seeded from V2's proven pure modules

**Decision.** Build `src/worker-v3/` as an isolated new worker exactly as the
spec asks. The spec explicitly contemplates an existing worker ("must remain
available... must not be deleted") and rules to build the new one anyway, so
`src/worker-v2/`'s existence is **not** a blocker — it is the situation the spec
already addresses. `src/worker-v2/` stays untouched and running.

To waste nothing, V3 **seeds its pure, side-effect-free logic modules from V2**
(`decimal`, `mt5-enums`, `mappers`, `validators`, `position-reconstructor`) by
copying the tested functions into the fresh `src/worker-v3/` tree and adapting
imports. Copying proven pure logic into a new isolated worker is not
"extending the existing architecture"; it is a clean new worker that reuses
tested functions. Everything stateful (consumers, checkpoints, aggregations,
reconciliation, health persistence) is built new in V3.

**Context.** A from-scratch modular worker already exists at `src/worker-v2/`,
actively developed, implementing a large fraction of the V3 architecture:

- Redis consumer groups with batch read, `XAUTOCLAIM`-equivalent pending
  reclaim, abort-aware loop, exponential backoff (`stream-consumer.ts`).
- Separate deal / order consumers (`deal-consumer.ts`, `order-consumer.ts`).
- Exact-decimal arithmetic layer (`decimal.ts`), never JS floats for money.
- Canonical closed-trade reconstruction from raw deals, handling
  in/out/inout/out_by, partial closes, multiple fills, reversals, and
  ambiguous reopen detection (`position-reconstructor.ts`).
- Versioned validators, mappers, MT5 enum decoders.
- Live sync (AccountSnapshot + OpenPosition) with a completeness guard.
- Isolated health server (port 9200), graceful shutdown, isolated streams
  (`mt5:v2:history:*`), isolated build scripts (`build:worker-v2`, etc.).

Building `src/worker-v3/` from zero would **duplicate** all of the above.
Per spec §17/§28 ("smallest compatible change", "do not rewrite unrelated
legacy code") and the spec's own escape clause ("stop only if an unrecoverable
contradiction exists"), this is the contradiction. **Recommendation: treat
`src/worker-v2/` as the V3 baseline and close the gaps below**, rather than
fork a third parallel worker. If a clean `src/worker-v3/` namespace is required
for cutover isolation, promote V2's proven modules into it rather than
re-authoring from scratch.

This decision is flagged for the user. The rest of this plan is written to be
valid under either choice — the gaps and phases are the same work regardless of
directory name.

## 1. Schema gap analysis

Spec §9 lists 16 required entities. Current schema (`prisma/schema.prisma`,
23 models) status:

| Spec entity                | Status                | Notes                                                                                                                                                                                                                         |
| -------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TradingAccount             | **exists**            | has `brokerUtcOffsetMinutes`, `accountNo`. Needs unique index review on login.                                                                                                                                                |
| AccountIdentitySnapshot    | **missing**           | identity is only on `TradingAccount`; no history of company/server/owner/leverage changes (spec §4.1).                                                                                                                        |
| AccountSnapshot            | **partial**           | exists but keyed one-row-per-account (`upsert where tradingAccountId`), so it is _current state_, not the immutable snapshot history spec §4.7 wants. Needs a captured-at-keyed history table.                                |
| Deal                       | **exists**            | `(tradingAccountId, dealNo)` unique; has commission/swap/fee/profit as Decimal. Missing some MT5 fields (deal `reason`, `time_msc`, `external_id`, `magic`, raw payload/source-message-id audit columns).                     |
| HistoricalOrder            | **exists as `Order`** | `(tradingAccountId, orderTicket)`. Missing many MT5 fields (state enums, time_msc, expiration, reason, filling/time mode, external id, position_by).                                                                          |
| ClosedTrade                | **partial**           | `ClosedPosition` + `Position` hold reconstructed closed trades, but lack canonical fields spec §4.4 wants: entry/exit order & deal id arrays, partial-close count, MAE/MFE, close reason, fully-closed flag, source revision. |
| OpenPosition               | **exists**            | keyed `(tradingAccountId, positionNo)`. Missing MAE/MFE/peak-floating/update-time fields (spec §4.5).                                                                                                                         |
| WorkingOrder               | **exists**            | table present; **not currently written by V2** (no producer stream).                                                                                                                                                          |
| BalanceLedgerEntry         | **missing**           | spec §6 ordered event ledger.                                                                                                                                                                                                 |
| BalanceCurvePoint          | **missing**           | spec §6.                                                                                                                                                                                                                      |
| AccountPerformanceSummary  | **partial**           | `AccountReportResult` is the legacy precomputed cache; not versioned per spec §7/§16, not reproducible-from-PG-only by contract.                                                                                              |
| AccountPerformanceSequence | **missing**           | consecutive win/loss sequences (spec §7.19–7.24).                                                                                                                                                                             |
| WorkerConsumerState        | **missing**           | durable checkpoint (spec §12). V2 has none — bridge cursor is Redis-only.                                                                                                                                                     |
| WorkerMessageFailure       | **missing**           | poison-message store (spec §12.15).                                                                                                                                                                                           |
| WorkerReconciliationRun    | **missing**           | spec §17.                                                                                                                                                                                                                     |
| WorkerAccountHealth        | **missing**           | health persisted per account (spec §18); V2 health is in-memory only.                                                                                                                                                         |

Legacy `BridgeHistoryCheckpoint/Chunk/Record` belong to `src/worker/` and are
**out of scope** — do not migrate or reuse (CLAUDE.md "Known Follow-up").

## 2. Capability gap analysis (behavior)

| Spec area                                              | V2 today                                             | Gap                                                        |
| ------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| Idempotent deal/order upsert                           | yes, unique-key upsert                               | ok                                                         |
| Ack after commit                                       | yes (`stream-consumer` acks only on handler `"ack"`) | verify handler returns leave-pending on DB failure         |
| Out-of-order deals                                     | yes (reconstructor sorts by time,ticket)             | ok                                                         |
| Partial close / multi-fill / reversal / inout / out_by | yes (`position-reconstructor`)                       | ambiguous-reopen only _reported_, not modeled              |
| Canonical trade counting for stats                     | partial (ClosedPosition exists)                      | no performance service consumes it yet                     |
| Balance ledger / curve                                 | **none**                                             | build from Deal ledger (spec §6)                           |
| Performance metrics (§7 all)                           | **none**                                             | build versioned aggregation service                        |
| Drawdown (abs/max/relative)                            | **none**                                             | build + spec §8 fixture                                    |
| Open-position completeness                             | count-vs-heartbeat guard                             | no snapshotId/schemaVersion (producer gap)                 |
| Working orders                                         | **none**                                             | needs producer stream (bridge change, document separately) |
| Durable checkpoint / recovery                          | **none** (Redis cursor only)                         | `WorkerConsumerState` in PG                                |
| Poison message → PG + DLQ                              | **none**                                             | `WorkerMessageFailure` + optional DLQ stream               |
| Reconciliation jobs                                    | **none**                                             | spec §17                                                   |
| Persisted health                                       | in-memory only                                       | `WorkerAccountHealth`                                      |
| Backfill state machine                                 | producer cursor only                                 | consumer-side coverage proof (spec §19)                    |
| Full deterministic rebuild command                     | **none**                                             | `rebuild-account` reading PG only                          |
| Golden MT5 parity fixture                              | **none**                                             | spec §22                                                   |
| Load/benchmark script                                  | **none**                                             | spec §23                                                   |

## 3. Phased plan (dependency-ordered)

Phases map to spec §25. Each phase = one focused commit, English messages.
Legacy `src/worker/` and current `src/worker-v2/` stay running throughout.

- **P1 (done)** Repo + contract inspection → this doc + the contract doc.
- **P2** Schema migration: add the missing tables (AccountIdentitySnapshot,
  AccountSnapshot **history** variant, BalanceLedgerEntry, BalanceCurvePoint,
  AccountPerformanceSummary(v3), AccountPerformanceSequence, WorkerConsumerState,
  WorkerMessageFailure, WorkerReconciliationRun, WorkerAccountHealth) and extend
  Deal/Order/OpenPosition/ClosedTrade with missing MT5 + audit columns.
  Non-destructive, additive only. Review indexes per spec §10 against real API
  queries in `src/app/api/accounts/`.
- **P3** Durable consumer checkpoint (`WorkerConsumerState`): ack only after
  PG commit; store last-committed stream id per (stream, group, consumer).
- **P4** Poison handling: `WorkerMessageFailure` + optional
  `mt5:v2:history:deals:dead` DLQ; bounded retry with backoff; never ack a
  failed write.
- **P5** Canonical `ClosedTrade` model + reconstruction upgrade (entry/exit id
  arrays, partial-close count, fully-closed flag, source revision).
- **P6** Balance ledger + curve (spec §6), deterministic & replayable from PG.
- **P7** Performance aggregation service, versioned (spec §7): all metrics,
  incremental + full-rebuild, compared in tests.
- **P8** Drawdown service + spec §8 fixture (exact decimals).
- **P9** Reconciliation (spec §17) — report-only; destructive repair gated
  behind an explicit `--repair` flag.
- **P10** Persisted health (`WorkerAccountHealth`) + freshness/lag metrics.
- **P11** Golden MT5 parity fixture (spec §22) + load/benchmark script (§23).
- **P12** Shadow-run vs legacy, cutover checklist, final report.

Producer-dependent items (working-order stream, snapshot completeness
envelope) are **deferred** and, if needed, proposed as the smallest compatible
bridge change in a separate doc (spec §17).

## 4. Non-negotiables carried into every phase

Exact decimals only (`decimal.ts` / Prisma.Decimal / PG NUMERIC); preserve MT5
identifiers; idempotent upserts; ack-after-commit; failed write leaves message
pending; out-of-order safe; canonical trades (not raw deal counts) for stats;
no 100-row caps; no delete-all-positions without a validated complete snapshot;
no floating-point money; no `any` to suppress TS errors; no swallowed errors;
no bridge contract changes without a separate documented proposal.

## 5. Verification per spec §26 (run, don't claim)

`npm run lint`, `npx tsc --noEmit`, `npm test` (focused worker-v2/v3 test files),
`npm run build`, `npm run build:worker-v2` (and `build:worker-v3` if forked),
`python3 -m pytest -q bridge_v2/tests`, Prisma validate + generate, plus the
replay-idempotency, graceful-shutdown, golden-parity, and load tests as their
phases land. Integration tests needing live Redis+Postgres run against the
isolated `npm run test:env:up` stack; results reported as run / skipped /
infra-unavailable, never assumed.
