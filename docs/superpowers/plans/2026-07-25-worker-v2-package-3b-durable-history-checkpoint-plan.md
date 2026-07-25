# Package 3b — Durable History Publishing + Checkpoint Persistence for Worker V2

**Status:** Planning only. No code changed by this document. Supersedes nothing — this is the concrete implementation plan for Package 3 (durable Worker V2 ingestion) referenced by `docs/superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md` and scoped by `docs/superpowers/plans/2026-07-17-worker-v3-package3a-schema-and-corrupted-lifecycle.md`.

**Scope discipline:** Package 3b only. Packages 4 (bridge acknowledged replay / durable-mode cursor gating), 5 (gated production rollout), 6 (worker-v3 P2 broad schema) are explicitly out of scope and untouched. No public dashboard behavior changes. No Redis/Postgres/consumer-group resets. No production data touched — this plan targets local/isolated test stacks only until a separate, explicitly approved rollout.

**Status update (2026-07-26):** Increment 2a (`ensureHistoryCheckpoint`, `persistHistoryRecord`) landed on branch `package-3b/durable-history-checkpoint`, reviewed, accepted. This update finalizes the Positions-barrier design ahead of Increment 2b (`persistHistoryBarrier` + reconciliation) and consumer wiring.

---

## 1a. Finalized Positions-barrier semantics

Supersedes the tentative wording in §3/Task 1 above. The third barrier is **local and PostgreSQL-authoritative** — no synthetic Redis stream, no wire message. It is stamped by worker-v2 itself once it can prove, from durable state alone, that every distinct Position touched by this chunk has been reconstructed to a terminal outcome.

**Touched-position derivation (deterministic, no schema change, no in-memory state):**

`BridgeHistoryRecord` has no `chunkId → positionId` column and `Deal` has no `chunkId` column, so derivation goes through the one link that already exists: `BridgeHistoryRecord(chunkId, stream="deals").eventKey` → `Deal.dealNo`. **Contract (binding from this point forward): for `stream="deals"`, `eventKey` MUST equal the deal's `dealNo` exactly** (not a prefixed string) — this is what makes touched-position derivation a pure join, re-runnable identically after any restart, with zero reliance on in-memory accumulation during ingestion. Given a chunk's full list of `dealNo`s (from its `BridgeHistoryRecord` rows), touched positions = distinct `Deal.positionId` among those rows where `direction ∈ {in, out, inout, out_by}`.

**Reconstruction:** each unique touched `positionId` is reconstructed via an injected callback (kept decoupled from `position-reconstructor.ts`'s real `PrismaClient`/`computePositionMaeMfe` dependencies — see Task 2 rationale). Outcomes:
- `"closed"` / `"open"` → **resolved** (successful reconstruction; `"open"` — i.e. still-open — is success, not a pending state).
- `"corrupted"` / `"ambiguous-reopen"` → **blocking** (durable, retryable, described below).
- `"no-deals"` → unreachable by construction (we only reconstruct positions we just derived from persisted deals for); if it occurs, that's an invariant violation and the reconciliation pass throws rather than silently treating it as any outcome.

**Positions-barrier fires (`positionsBarrierAt` stamped) if and only if zero blocking outcomes remain after a reconciliation attempt.** Checkpoint advancement requires all three: `dealsBarrierAt`, `ordersBarrierAt`, and this locally-computed `positionsBarrierAt`.

## 1b. `reconstructionState` — PostgreSQL-authoritative, retry-capable

Stored in the existing `BridgeHistoryChunk.reconstructionState` `Json?` column (no migration — the column already exists, unused by worker-v2 today). Shape:

```ts
interface ReconstructionState {
  schemaVersion: 1;
  algorithmVersion: number;        // position-reconstructor.ts algorithm version in effect
  attemptedAt: string;             // ISO timestamp of this reconciliation attempt
  touchedPositionCount: number;    // total distinct positions this chunk touches (stable across retries)
  resolvedPositionCount: number;   // closed + open, cumulative across attempts
  blocking: Array<{
    positionId: string;
    outcome: "corrupted" | "ambiguous-reopen";
    reason: string | null;
    dealIds: string[];             // this chunk's dealNos that touched this position — the "related deal identifiers"
  }>;
}
```

**Retry semantics, PostgreSQL-only (no in-memory state survives restart or replay):** every reconciliation attempt re-reads the chunk's *previous* `reconstructionState` (if any) to determine which positions were already resolved — those are skipped. Every position still absent from a prior attempt, or present in the prior attempt's `blocking` list, is re-attempted. Because the injected reconstruction callback re-derives its answer from all currently-known deals for that `positionId` (not just this chunk's), a position that was blocking due to bad/incomplete upstream data resolves automatically the next time reconciliation runs for this chunk, once the underlying data is valid — no special-cased "retry" code path, just calling the same idempotent function again. `blocking` in the stored state always reflects only the *current* attempt's unresolved set, never a stale accumulation.

**Known scope boundary (surfaced, not hidden):** nothing in Package 3b schedules that "run again" call automatically on a timer — it happens whenever `persistHistoryBarrier` is next invoked for that chunk (a genuine redelivered/replayed barrier message, or a deliberate operator-triggered reprocess). A chunk stuck on a blocking outcome halts that account's checkpoint advancement (by design — never emit a guessed Position) until something re-triggers reconciliation. This is diagnosable (the full reason lives in `reconstructionState`) but not self-healing on a schedule within this package's scope.

## 1c. Task 3 completion notes (producer envelope upgrade, done)

`bridge_v2/history_publisher.py` now emits the chunk/ordinal/barrier envelope this module requires. Design points (full rationale in the module's own docstring):

- `chunkId = f"{window_start}:{window_end}"`, deterministic from window bounds rather than an opaque counter — recoverable if the bridge's Redis cursor state is ever lost while the consumer's checkpoint isn't (reseed `prev_epoch` by splitting the checkpoint's `lastCompletedChunkId`).
- Records sorted by `(time, ticket)` before ordinal assignment — MT5 row order isn't guaranteed across calls, and ordinal stability is load-bearing for replay-safety.
- Canonical JSON hashing (`sort_keys=True, separators=(",",":")`) for `payloadSha256` — whitespace/key-order drift would otherwise make replay a permanent digest conflict instead of a safe no-op.
- Digest-chain algorithm (`next_records_sha256`) pinned cross-language against `history-checkpoint.ts`'s `nextRecordsSha256` via `bridge_v2/tests/test_history_publisher_envelope.py` — both fold `sha256(prev_hex + payload_hex)` seeded from `sha256("").hexdigest()`. This is the one piece where Python and TypeScript run the *same* algorithm independently and must produce byte-identical output, since the consumer re-chains its own digest from arriving records and compares it against the producer's declared barrier `recordsSha256`.
- `eventKey` for the deals stream is `str(ticket)`, matching `mapDealToPrisma`'s `dealNo: String(record.ticket)` exactly — the contract from §1a.

**Known, accepted gaps (logged, not solved in this package):**
- A retried tail window (`window_end = min(cursor + window_days, now)`) can get a different `chunkId` than an earlier attempt if `now` moved between tries, orphaning the earlier partially-applied chunk. The new chunk still completes correctly — harmless orphaned rows, not a correctness break.
- The cursor advances on publish success independent of consumer progress (Package 4 territory). A chunk blocked on a reconstruction outcome lets later chunks pile up pending, correctly rejected with "history coverage gap" until the blocking chunk resolves. Expected and unbounded within this package's scope.

---

## 1. Exact current producer flow (`bridge_v2/history_publisher.py`)

`sync_history_once()` (lines 49–85) is the entire producer today:

1. Read cursor from `mt5:v2:history:{login}:cursor` (Redis), default `history_start_epoch()` (`2026-01-01`, `config.py:15`).
2. If `cursor >= now_epoch` → idle, return.
3. Compute one bounded window `[cursor, min(cursor + 30d, now))`.
4. Fetch `history_deals_get` / `history_orders_get` from MT5. Raise on MT5 failure **before** any Redis write (cursor never advances on failure — the one real invariant enforced today).
5. Pipeline-`XADD` every raw deal/order row as an untyped `{login, kind, record}` envelope (`_stream_message`, line 40) onto `config.STREAM_DEALS` / `config.STREAM_ORDERS` — **non-transactional pipeline** (`transaction=False`, line 72).
6. Unconditionally `write_cursor(window_end)` (line 80) once the pipeline executes — advance is keyed only on "did XADD not throw", not on any downstream durability signal.

**What is explicitly absent** (per the file's own docstring, lines 3–13): no chunk id, no parent chunk id, no ordinal, no expected count, no event key, no payload SHA-256, no barrier messages, no PostgreSQL ACK wait. This is a flat, non-idempotent-by-envelope stream (idempotency today comes only from stable MT5 ticket numbers surviving into the consumer's upsert key, not from any producer-side receipt).

## 2. Exact worker consumer flow and account-resolution path

`src/worker-v2/deal-consumer.ts` (`makeDealHandler`, mirrored by `order-consumer.ts`):

1. `stream-consumer.ts` batch-reads + reclaims pending entries (`xClaim`/`xAutoClaim`-equivalent), calls the handler per entry, `XACK`s only if the handler returns `"ack"` (`stream-consumer.ts:48-49,123-124`).
2. Handler parses `{login, kind, record}` JSON (no envelope versioning).
3. `resolveAccountByLogin(registry, payload.login)` — `account-registry.ts:16-21` — a plain `Map<accountNo, TradingAccount>` snapshot loaded at startup (`loadAccountRegistry`, `index.ts:48`) and refreshed every `WORKER_V2_ACCOUNT_REFRESH_MS` (default 60s, `index.ts:21-22,50-60`). **Not per-message DB lookup** — resolution is against an in-memory cache up to 60s stale.
4. Validates + maps the record, `prisma.deal.upsert` keyed `(tradingAccountId, dealNo)` (single-table write, no transaction, no chunk/checkpoint linkage at all — confirmed by empty grep for `BridgeHistoryCheckpoint|Chunk|Record` under `src/worker-v2/`).
5. If the deal closes a position, calls `reconstructPositionIfClosed` (Package 3a) — returns `"closed" | "still-open" | "ambiguous-reopen" | "corrupted"`; only `"closed"` writes a row (`ClosedPosition`/`Position`); `"corrupted"`/`"ambiguous-reopen"` only `console.error` today (Package 3b's actual job per the 3a doc: route these to a durable failure sink instead).
6. Returns `"ack"` in nearly every branch except a DB-write exception or an unconfigured `brokerUtcOffsetMinutes` (`"leave-pending"`).

**Account-resolution gap for this plan:** the registry snapshot means a message referencing a `TradingAccount` created after the last refresh, or one whose id was recreated (delete+recreate same `accountNo`), resolves against a stale/missing entry for up to 60s — directly relevant to crash-recovery scenario 4 below.

## 3. Where BridgeHistoryCheckpoint / Chunk / Record should be written and read

**Do not re-derive this — a complete, tested implementation already exists:** `src/worker/history-checkpoint.ts` (671 lines) + its tests (`history-checkpoint.test.ts`, `history-recovery.integration.test.ts`). It already implements, against the *same three tables* Package 3b needs:

- `ensureHistoryCheckpoint` — idempotent checkpoint row creation, seeded at `946684800` (2000-01-01 epoch), matching CLAUDE.md's "never fall back to now-30d, always 2000-01-01" rule.
- `persistHistoryRecord` — per-record transaction: find-or-create chunk, verify chunk metadata hasn't forked, verify expected-count agreement, **replay-safe** via `(chunkId, stream, ordinal)` unique receipt lookup (returns `null` on exact replay, throws on digest mismatch at the same ordinal, throws on ordinal gap), then upserts the domain row (`Deal`/`Order`/`Position`) and advances the chunk's applied-count/digest, all inside one `tx.$transaction`.
- `persistHistoryBarrier` — per-stream barrier arrival; advances checkpoint only once all three stream barriers (`dealsBarrierAt`, `ordersBarrierAt`, `positionsBarrierAt`) are set on the same chunk, verifies count/digest agreement before allowing barrier arrival, flips `phase: "backfill" → "incremental"` and stamps `backfillCompletedAt` exactly when `chunk.reachedPresent` is true at the moment the *first* barrier-completing transition happens.
- `mirrorHistoryCheckpoint` — writes Redis `mt5:bridge:history-ack:{accountNo}` / `history-cursor:{accountNo}` mirrors **after** the PostgreSQL transaction commits (never before), and can `xTrim` streams up to the last confirmed barrier id.

**Package 3b's real task is reconciliation, not invention:** port/adapt this module (or a thin `src/worker-v2`-scoped wrapper around it) to (a) worker-v2's account-resolution path (`resolveAccountByLogin` against the registry, not a fresh query), and (b) `bridge_v2`'s stream topology, which today has **no `position-closed` stream at all** — worker-v2 derives closed positions inline via `position-reconstructor.ts` rather than the legacy bridge's explicit third stream. This is the one genuine architectural gap the legacy code doesn't already solve: the existing barrier-completion logic hard-codes exactly three streams (`deals`, `orders`, `position-closed`); worker-v2 has two raw streams plus a derived reconstruction, so Package 3b must decide whether "position-closed" barrier completion in the ported module should instead gate on **local reconstruction completion for the chunk's positions**, not a third incoming stream. This decision must be made explicit in Task 1 below before any code is written.

## 4. Transaction boundaries and ordering guarantees

Preserve exactly the legacy invariants (already proven under test):

1. One `$transaction` per record: chunk upsert/verify → count/digest check → replay-receipt check → domain row upsert → chunk counters advance → `bridgeHistoryRecord.create`. All atomic — if the domain upsert throws, the chunk counters and receipt never move.
2. One `$transaction` per barrier: chunk barrier-field update → re-read chunk → check whether the third barrier just landed → checkpoint gap/fork checks → checkpoint update. Also atomic.
3. Redis XACK happens **only after** the record-transaction commits successfully (mirrors legacy `bridge-consumer.ts:89` calling `persistHistoryRecord` before returning `"ack"`).
4. Redis mirror write (`mirrorHistoryCheckpoint`) happens **only after** the checkpoint-transaction commits, and is treated as a disposable cache — `mirrorHistoryCheckpoint` is designed to be safely re-derivable from PostgreSQL alone (proven by the existing test "durable PostgreSQL checkpoint rebuilds both Redis mirrors after Redis flush").
5. No cross-account transaction ever spans two `tradingAccountId`s — every write is scoped to one chunk id, which is itself account-scoped (`durableHistoryChunkId = "{accountId}:{transportChunkId}"`).

## 5. Idempotency keys and duplicate/replay behavior

- **Record idempotency:** `(chunkId, stream, ordinal)` unique key on `BridgeHistoryRecord` — exact replay (same eventKey + same payloadSha256 at the same ordinal) is a no-op (`return null`, no re-write). A digest mismatch at the same ordinal throws (`"history record replay digest conflict"`) — never silently overwrites.
- **Domain-row idempotency:** unchanged, existing `(tradingAccountId, dealNo)` / `(tradingAccountId, orderTicket)` / `(tradingAccountId, positionNo)` unique upserts — safe even if the record-transaction is retried before the receipt row is visible (upsert is naturally idempotent independent of the receipt).
- **Chunk idempotency:** `durableHistoryChunkId(accountId, transportChunkId)` — the transport-level chunk id `bridge_v2` will need to start generating (it emits none today) becomes the durable primary key, scoped per account so two accounts can reuse the same transport chunk id without collision (already proven: "same transport chunk ID advances independent account checkpoints").
- **Barrier idempotency:** re-arriving barrier for an already-`completedAt` chunk returns the existing checkpoint (or `null` if it's no longer the current checkpoint) — never re-advances.
- **Ordinal gap detection:** `envelope.ordinal > applied` throws `"history record ordinal gap for {stream}"` — this is what forces `bridge_v2` to guarantee delivery order and completeness per chunk, a new producer-side obligation Package 3b introduces (today `history_publisher.py` has no ordinals at all).

## 6. Crash recovery behavior

| Scenario | Behavior | Why safe |
|---|---|---|
| **Publish succeeds, checkpoint write fails** (worker crashes mid-`persistHistoryRecord`/`persistHistoryBarrier`) | Redis message stays un-XACK'd (ack only follows successful transaction commit) → redelivered to another/restarted consumer via pending-entries reclaim (`stream-consumer.ts` `xClaim` loop). Reprocessing hits the exact-replay path (same ordinal, same digest) → no-op, or continues from wherever the transaction actually committed. | Redis delivery ⊇ Postgres durability is the standing invariant; nothing is ever considered done until the DB transaction returns. |
| **Checkpoint write succeeds, publish (Redis ack/mirror) fails** | PostgreSQL is already the source of truth for `phase`/`backfillCompletedAt`/cursors; `mirrorHistoryCheckpoint` writing to Redis afterward is a best-effort cache refresh. If it fails, the *next* successful barrier (or a scheduled reconciliation read) rewrites the mirror from Postgres. Existing test proves full-mirror rebuild from Postgres after Redis flush. | Redis mirror is explicitly documented as reconstructable, never authoritative (matches CLAUDE.md: "Redis transport and coordination mirror, not authoritative source"). |
| **Worker crashes before ACK** | Entry remains in the consumer group's pending-entries list; `stream-consumer.ts`'s reclaim loop (`xAutoClaim`-equivalent, already runs every loop iteration per commit `a3f8273`) picks it up on the next worker (or restarted same worker) after the idle-reclaim threshold. Reprocessing is idempotent per point 5 above. | No message is ever acked before its transaction commits — standard at-least-once with idempotent consumer. |
| **Account IDs are recreated** (same `accountNo`, new `TradingAccount.id`, e.g. account deleted and re-onboarded) | `BridgeHistoryCheckpoint`/`Chunk`/`Record` all cascade-delete via `onDelete: Cascade` on `tradingAccountId`/`accountId` FK — old checkpoint/chunks vanish with the old account row. A message referencing the old login resolves to the *new* `TradingAccount.id` only after the registry refresh (up to `WORKER_V2_ACCOUNT_REFRESH_MS`, default 60s) picks up the new row; `ensureHistoryCheckpoint` then creates a **fresh** checkpoint at `2000-01-01` for the new id — this is correct (new account identity ⇒ new coverage history, no silent grafting onto stale coverage) but means a narrow window where in-flight messages for the recreated login are processed against a stale/absent registry entry and go to `"leave-pending"` or get logged as unknown-login, not silently misattributed to the wrong account. This must be covered explicitly by a test (Task 6 below) — it is a real edge case, not hypothetical, given `TradingAccount` has no soft-delete today. | Cascade delete + fresh checkpoint-per-id + registry staleness fails safe (pending/rejected), never cross-attributes. |

## 7. How phase transitions from backfill to incremental

Unchanged from the existing (tested) logic: a chunk's `reachedPresent` flag (set by the producer based on `window_end >= now_epoch` — already computed by `history_publisher.py:84`, just not currently transmitted) is carried on every record/barrier envelope for that chunk. The **first** barrier-completion transaction (all three barriers landed) for a chunk where `reachedPresent === true` and the checkpoint is still `phase === "backfill"` flips `phase → "incremental"` in the same transaction that advances `completedThroughServerTime`. Subsequent chunks (now live/incremental) never flip it back.

## 8. How `backfillCompletedAt` and `completedThroughServerTime` are set

Both are set **inside the same barrier-completion transaction** described above, not as a separate step:

- `completedThroughServerTime` := the completing chunk's `windowEndServerTime`, unconditionally, on every successful barrier-completion (backfill or incremental).
- `backfillCompletedAt` := `new Date()` **only** on the specific transaction where `phase` flips `"backfill" → "incremental"`; every subsequent transaction passes through the existing value unchanged (`checkpointToDurable` even throws if `phase === "incremental"` but `backfillCompletedAt` is null — a built-in consistency guard worth preserving verbatim).

## 9. Required tests

Reuse the existing legacy suite as the pattern reference — same fixture/assertion shape, ported to worker-v2's account-registry + bridge_v2 envelope shape:

- **Unit** (pure, no DB): chunk metadata-fork detection, ordinal-gap detection, digest-mismatch-at-same-ordinal detection, three-barrier completion gate, phase-flip-only-once, `backfillCompletedAt` immutability after first set — mirror `history-checkpoint.test.ts`'s existing 15 cases against the ported module.
- **Integration** (real Postgres via `npm run test:env:up`): full record→barrier→checkpoint-advance flow against the isolated test stack; `persistHistoryRecord`/`persistHistoryBarrier` transaction atomicity under injected mid-transaction failure.
- **Replay**: re-deliver an already-fully-processed record and an already-completed barrier — assert zero additional writes, zero counter drift, same returned checkpoint.
- **Restart**: simulate worker crash between record-commit and XACK (kill process / throw after commit before ack in a test harness) — assert redelivery reprocesses safely with no duplicate domain rows and no double-counted chunk counters.
- **Multi-account identical-ticket isolation**: two accounts each emit a deal with the same `dealNo`/ticket number in the same or overlapping chunk windows — assert both persist independently (`(tradingAccountId, dealNo)` composite key already guarantees this at the domain layer; this test proves the *chunk/checkpoint* layer doesn't cross-contaminate via a shared transport chunk id, per the existing "same transport chunk ID advances independent account checkpoints" pattern).
- **Account-recreation edge case** (new, not in the legacy suite): delete+recreate a `TradingAccount` mid-stream, assert cascade-deleted old checkpoint, fresh checkpoint at 2000-01-01 for new id, and no message misattribution during the registry-staleness window.

## 10. Files to modify, in implementation order

1. `bridge_v2/history_publisher.py` — add chunk id, ordinal, expected count, event key, payload SHA-256, `reachedPresent` to every published record; emit barrier messages per stream after a window's records are fully queued. (Producer envelope upgrade — the actual behavior change users will notice least; publish semantics stay additive.)
2. `bridge_v2/config.py` — chunk-id generation strategy (likely `{login}:{window_start}:{window_end}` or a monotonic counter persisted alongside the existing cursor key), stream key naming for any new barrier channel.
3. New: `src/worker-v2/history-checkpoint.ts` — ported/adapted copy of `src/worker/history-checkpoint.ts`, resolving the position-closed-barrier-vs-inline-reconstruction question from §3 (recommend: gate the third "barrier" on local reconstruction-complete-for-chunk rather than a wire message, since worker-v2 has no producer for it).
4. `src/worker-v2/deal-consumer.ts`, `src/worker-v2/order-consumer.ts` — wire `persistHistoryRecord`/`persistHistoryBarrier` calls in place of today's bare `prisma.deal.upsert`/`prisma.order.upsert`, using the existing `AccountRegistry` resolution (no change to registry itself unless Task 6's account-recreation test demands a resolution tweak).
5. `src/worker-v2/history-checkpoint.test.ts` (new) — unit suite per §9.
6. Integration test file (new, e.g. `src/worker-v2/history-checkpoint.integration.test.ts`) — opt-in via env flag matching the existing `RUN_HISTORY_RECOVERY_INTEGRATION=1` convention.
7. `CLAUDE.md` — add the new opt-in integration test command to the verification command list once it exists (matches existing convention for `history-recovery.integration.test.ts`).

No changes to: `src/app/api/**`, any React component, `docker-compose.yml` service topology, Packages 4/5/6 scope.

## 11. Migration needs

**None required.** Every table (`BridgeHistoryCheckpoint`, `BridgeHistoryChunk`, `BridgeHistoryRecord`) and every column this plan needs already exists in `prisma/schema.prisma`, already migrated, already exercised by the legacy path. Package 3a already added `reconstructionAlgorithmVersion`. This is purely application-code wiring against an existing, unmodified schema — consistent with the user's "preserve Package 3a schema" instruction, trivially satisfied since nothing here touches `schema.prisma`.

## 12. Explicit non-goals

- Do not touch `bridge_v2/live_publisher.py` or any live (non-history) stream contract.
- Do not enable a durable-mode cursor-gating toggle in the producer (that is Package 4's job — this plan only makes the *data* durable and replay-safe; the *cursor* still advances on publish-success exactly as it does today, per §1, until Package 4 explicitly changes that).
- Do not touch `src/worker/**` (legacy) at all — it stays running, untouched, as-is.
- Do not resolve the `2026-01-01` vs `2000-01-01` history-start discrepancy between `bridge_v2/config.py:15` and CLAUDE.md/legacy's `946684800` (2000-01-01) seed — **flagging this here as a real open contradiction worth a separate decision**, but changing the backfill start date is out of scope for 3b (3b only makes whatever window bridge_v2 already chooses to publish durable and replay-safe; it does not change what that window is).
- Do not add a `WorkerMessageFailure`-equivalent sink in this pass unless Task 1's position-closed-barrier decision requires one for corrupted/ambiguous lifecycles — if it does, treat that as an explicit Task 1b, not a silent scope creep (the table was dropped once already for having zero write path; don't recreate it speculatively).
- Do not run any migration, docker-compose, or production command as part of *this planning step* — this document is read-only output.

---

## Proposed Architecture

```
bridge_v2/history_publisher.py
  └─ sync_history_once()
       ├─ generate chunk_id, ordinal per record, reachedPresent flag  (NEW)
       ├─ XADD RecordEnvelope-shaped messages (versioned, ordinal-tagged)  (CHANGED)
       └─ XADD HistoryBarrier per stream once window's records are queued  (NEW)
                 │
                 ▼
        Redis streams: mt5:v2:history:{login}:deals / :orders  (existing keys, richer envelope)
                 │
                 ▼
src/worker-v2/deal-consumer.ts / order-consumer.ts
  ├─ resolveAccountByLogin (existing, unchanged)
  ├─ validate + map (existing, unchanged)
  ├─ persistHistoryRecord(tx)  ─── NEW: src/worker-v2/history-checkpoint.ts (ported)
  │     chunk upsert/verify → replay-receipt check → domain upsert → counters
  ├─ on barrier envelope: persistHistoryBarrier(tx)
  │     3-barrier gate (deals, orders, reconstruction-complete) → checkpoint advance
  │     phase flip backfill→incremental, backfillCompletedAt stamp
  ├─ mirrorHistoryCheckpoint(redis)  ─── after commit, best-effort
  └─ XACK only after transaction commits (existing pattern, unchanged)
```

## Numbered Implementation Tasks

**Task 1 — Resolve position-closed barrier semantics (decision + design note, no code)**
Decide and document (in this plan or a short addendum) whether worker-v2's third barrier gates on local reconstruction-completion-for-chunk vs. a new synthetic stream. Acceptance: written decision + rationale, reviewed before Task 2 starts.

**Task 2 — Port `history-checkpoint.ts` to `src/worker-v2/`**
Copy + adapt `ensureHistoryCheckpoint`/`persistHistoryRecord`/`persistHistoryBarrier`/`mirrorHistoryCheckpoint`/`durableHistoryChunkId` for worker-v2's `DbLike` surface and Task 1's decision. Acceptance: module compiles, unit tests (§9) pass in isolation with a mocked/in-memory `DbLike`, no import from `src/worker/**`.

**Task 3 — Upgrade `bridge_v2/history_publisher.py` envelope**
Add chunk id, ordinal, expected count, event key, payload SHA-256, `reachedPresent` to records; emit per-stream barrier after each window. Acceptance: `python3 -m pytest -q bridge_v2/tests` green including new envelope-shape assertions; cursor-advance invariant (never advance on MT5 failure) still holds.

**Task 4 — Wire consumers**
Replace bare upserts in `deal-consumer.ts`/`order-consumer.ts` with `persistHistoryRecord`/`persistHistoryBarrier` calls; keep XACK-after-commit ordering. Acceptance: existing worker-v2 test suite (`deal-consumer` behavior, position-reconstructor) still green; new integration test (Task 6) passes against `test:env:up` stack.

**Task 5 — Unit test suite**
Port/adapt the 15 legacy `history-checkpoint.test.ts` cases. Acceptance: all pass, no DB dependency.

**Task 6 — Integration + replay + restart + multi-account + account-recreation tests**
Per §9, against isolated `npm run test:env:up` stack, opt-in via env flag. Acceptance: all scenarios pass; failure injection (mid-transaction crash sim) proves no partial state.

**Task 7 — Documentation + verification wiring**
Update `CLAUDE.md` with the new opt-in test command; note Package 3b completion status in this plan's own status banner. Acceptance: doc updated, no other prose changed.

## Validation Commands (per task, cumulative)

```bash
python3 -m pytest -q bridge_v2/tests
node --import tsx --test src/worker-v2/*.test.ts
RUN_WORKER_V2_HISTORY_INTEGRATION=1 node --import tsx --test src/worker-v2/history-checkpoint.integration.test.ts   # against test:env:up
npm run lint
npx tsc --noEmit
npm run build:worker-v2
npm run build
npx prisma validate
```

## Rollback Strategy

- Every task is additive/isolated to `src/worker-v2/**` and `bridge_v2/history_publisher.py` — no schema migration exists to roll back (§11).
- If Task 3's envelope upgrade misbehaves in the isolated test stack, revert `history_publisher.py` to the current flat-envelope version (single file, single commit revert) — worker-v2 consumers (pre-Task 4) already tolerate the old `{login, kind, record}` shape, so producer and consumer upgrades can be reverted independently without breaking each other mid-rollback.
- If Task 4's consumer wiring misbehaves, revert to the current bare-upsert consumer — no durable checkpoint rows exist yet in production for worker-v2 to lose, since Package 3b's checkpoint rows are net-new for this pipeline (legacy `src/worker/` checkpoint rows are untouched, separate accountId-keyed rows, unaffected either way).
- No production/VPS execution, no live account enablement, no Redis/Postgres reset at any point in this plan — rollback is always "revert the commit," never "undo data."
