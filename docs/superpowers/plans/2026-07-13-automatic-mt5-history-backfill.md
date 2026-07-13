# Automatic MT5 History Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:test-driven-development`. Work in current checkout because relevant bridge files already contain user-owned changes. Do not commit.

**Goal:** Make normal bridge startup backfill complete MT5 history in bounded chunks and advance only after Node worker durably persists each chunk and records its PostgreSQL checkpoint.

**Architecture:** Python publishes ordinal-bearing record envelopes followed by per-stream barriers, then waits for Redis mirror of PostgreSQL checkpoint. Node processes streams in order, atomically pairs each business upsert with chunk receipt/applied-count advancement, records three validated barriers, advances account checkpoint in final-barrier transaction, and mirrors committed state to Redis. Three PostgreSQL tables hold current state, sequential chunk proof, and replay receipts.

**Tech Stack:** Python 3 bridge, Redis Streams, Node.js/TypeScript worker, Prisma 6, PostgreSQL 15, `node:test`.

## Global Constraints

- `MIN_HISTORY_START_TS = 2000-01-01`; never epoch or `now - 30 days`.
- PostgreSQL is authoritative. Redis is transport/mirror only.
- Keep live polling active while history waits/backfills.
- Preserve independent Deal/Order `(timestamp, ticket)` cursors.
- Preserve raw MT5 server times through Python/Redis; convert once in Node mapper with `brokerUtcOffsetMinutes`.
- Record empty chunks and cross-chunk reconstruction state durably.
- Python must not connect PostgreSQL.
- No production data deletion, Redis reset, rebuild, migration application, deployment, commit, or push.

---

### Task 1: State-machine and durability RED tests

**Files:**
- Create: `bridge/test_history_sync.py`
- Modify: `bridge/test_mt5_bridge.py`
- Modify: `src/worker/bridge-consumer.test.ts`
- Create: `src/worker/bridge-protocol.test.ts`
- Create: `src/worker/history-checkpoint.test.ts`

**Interfaces under test:**
- Python: `_next_history_window(checkpoint, now_ts, chunk_days)`, `_history_barrier_payload(...)`, `_checkpoint_from_ack(...)`, `_serialize_reconstruction_state(...)`, `_restore_reconstruction_state(...)`, `build_arg_parser()`.
- TypeScript: `parseHistoryBarrier(raw, expectedKind)`, `applyHistoryBarrier(client, account, barrier)`, `mirrorHistoryCheckpoint(redis, accountNo, checkpoint)`, `ensureHistoryCheckpoint(client, accountId)`.

- [ ] Add Python test proving missing/incomplete checkpoint yields first bounded window from `MIN_HISTORY_START_TS`.
- [ ] Run `python3 -m unittest bridge/test_mt5_bridge.py` or repo fallback runner. Expected RED: new state-machine helpers absent.
- [ ] Add Python tests proving publish does not mutate confirmed checkpoint, ACK advances, final backfill ACK switches incremental, malformed/missing durable cursor raises, and reconstruction snapshot round-trips.
- [ ] Add CLI test proving `backfill-history`, `--backfill-window-days`, and `--backfill-start-date` are rejected.
- [ ] Add Node tests proving business upsert and ordinal increment are atomic; duplicate ordinal is idempotent; missing ordinal blocks; expected/applied mismatch blocks; one/two barriers do not advance; third barrier advances; empty chunk advances; fork/gap rejects; reconstruction JSON reaches checkpoint.
- [ ] Run `node --import tsx --test src/worker/history-checkpoint.test.ts src/worker/bridge-consumer.test.ts`. Expected RED: checkpoint module/interfaces absent.

### Task 2: PostgreSQL durable checkpoint schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260713120000_add_bridge_history_checkpoints/migration.sql`

**Interfaces:**
- `TradingAccount.bridgeHistoryCheckpoint`
- `TradingAccount.bridgeHistoryChunks`
- `BridgeHistoryCheckpoint` one row/account.
- `BridgeHistoryChunk` one row/deterministic sequential chunk with expected/applied counts and barrier Redis IDs.
- `BridgeHistoryRecord` one row/chunk/stream/ordinal replay receipt.

- [ ] Add Prisma models with raw server times/tickets as `BigInt`, reconstruction as `Json`, per-stream expected/applied counts, rolling payload digests, barrier Redis IDs/timestamps, cascade relations, and account/sequence indexes.
- [ ] Create migration without applying to production. Use isolated migration diff or write reviewed SQL when local DB migration generation would mutate unrelated state.
- [ ] Add SQL CHECK constraints:

```sql
CHECK (phase IN ('backfill', 'incremental'));
CHECK (completed_through_server_time >= coverage_start_server_time);
CHECK (window_end_server_time > window_start_server_time);
CHECK (deals_applied_count BETWEEN 0 AND deals_expected_count);
CHECK (orders_applied_count BETWEEN 0 AND orders_expected_count);
CHECK (positions_applied_count BETWEEN 0 AND positions_expected_count);
CHECK ((phase = 'backfill' AND backfill_completed_at IS NULL)
    OR (phase = 'incremental' AND backfill_completed_at IS NOT NULL));
```

- [ ] Run `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`. Expected PASS without connecting.
- [ ] Run `npx prisma generate`. Expected PASS; only generated ignored artifacts change.
- [ ] Inspect migration for destructive statements. Expected: three creates, indexes, constraints, FKs only.

### Task 3: Worker barrier transaction and Redis recovery

**Files:**
- Create: `src/worker/history-checkpoint.ts`
- Create: `src/worker/bridge-protocol.ts`
- Modify: `src/worker/bridge-consumer.ts`
- Modify: `src/worker/bridge-consumer.test.ts`
- Test: `src/worker/history-checkpoint.test.ts`

**Interfaces:**

```ts
export type HistoryBarrierStream = "deals" | "orders" | "position-closed";
export interface HistoryCursor { time: number; ticket: number }
export interface HistoryBarrier {
  version: 1; type: "barrier"; accountNo: string; chunkId: string;
  stream: HistoryBarrierStream; parentChunkId: string | null;
  windowStartServerTime: string; windowEndServerTime: string;
  recordCount: number; recordsSha256: string;
  dealCursor: { time: string; ticket: string };
  orderCursor: { time: string; ticket: string };
  reachedPresent: boolean;
  reconstructionState: Record<string, unknown> | null;
}
export async function applyHistoryBarrier(...): Promise<DurableCheckpoint>;
export async function mirrorHistoryCheckpoint(...): Promise<void>;
```

- [ ] Implement strict record/barrier parsers, payload hashes, deterministic chunk-ID verification, and stream-local ordinals.
- [ ] Implement initial checkpoint creation at `946684800` with `phase=backfill`.
- [ ] Implement record transaction: exact next ordinal performs domain upsert plus applied-count increment; earlier ordinal is replay; later ordinal is gap.
- [ ] Persist `Position` and `ClosedPosition` together in same record transaction.
- [ ] Implement barrier transaction. Barrier requires applied count/digest match; final barrier advances only when all three barriers exist and parent/window/cursors match checkpoint.
- [ ] Treat already committed exact chunk as idempotent replay. Reject competing active chunk, fork, metadata mismatch, cursor regression, or coverage gap.
- [ ] Persist Position barrier reconstruction state into chunk and final checkpoint.
- [ ] Publish ACK and compatibility cursor mirrors only after transaction commit.
- [ ] Update stream consumer: legacy records use existing path but cannot advance coverage; automatic records use chunk transaction; barriers use checkpoint transaction; Redis XACK follows durable staging.
- [ ] Remove approximate MAXLEN from uncommitted automatic history publication; trim through committed barrier IDs after durable mirror publication.
- [ ] Hydrate valid mirrors from PostgreSQL every worker startup/loop. Reject inconsistent completed state loudly.
- [ ] Run focused Node tests. Expected PASS.

### Task 4: Python automatic bounded lifecycle

**Files:**
- Modify: `bridge/mt5_bridge.py`
- Modify: `bridge/test_mt5_bridge.py`

**Interfaces:**

```python
MIN_HISTORY_START_TS = datetime(2000, 1, 1).timestamp()
HISTORY_CHUNK_DAYS = int(os.environ.get("HISTORY_CHUNK_DAYS", "30"))

def _next_history_window(checkpoint, now_ts, chunk_days): ...
def _checkpoint_from_ack(raw): ...
def _history_barrier_payload(...): ...
```

- [ ] Parse only PostgreSQL-backed ACK mirror as authority. Ignore legacy cursor as source.
- [ ] Keep history coordinator in daemon thread started before main live poll loop.
- [ ] Wait without guessing when mirror absent or invalid; log actionable error.
- [ ] For confirmed boundary, fetch Deals and Orders only within bounded window. Filter each using independent tuple cursor.
- [ ] Reconstruct close events in chronological Deal order; serialize remaining open reconstruction state.
- [ ] Publish versioned records with deterministic ordinal/count/hash metadata, then all three barriers, including barriers for empty chunks.
- [ ] Wait until valid mirror advances coverage. Redis acceptance alone changes no local confirmed state.
- [ ] Restore reconstruction snapshot and resume after restart.
- [ ] Mark final catch-up chunk `reachedPresent`; consume worker-confirmed `incremental` phase; continue bounded incremental sync.
- [ ] Ensure MT5 call failure publishes no barriers and retries same confirmed boundary.
- [ ] Run Python tests after each minimal implementation increment. Expected PASS.

### Task 5: Remove obsolete manual lifecycle

**Files:**
- Modify: `bridge/mt5_bridge.py`
- Modify: `bridge/README.md`
- Modify: `bridge/test_mt5_bridge.py`

- [ ] Remove `run_backfill_history` and CLI branch `--mode backfill-history`.
- [ ] Remove manual `--backfill-window-days`, `--backfill-start-date`, `HISTORY_BACKFILL_DAYS`, and `BACKFILL_START_DATE` behavior.
- [ ] Keep read-only discovery diagnostic without production writes.
- [ ] Document automatic state machine, PostgreSQL authority, mirror keys, chunk config, failure behavior, and production gate.
- [ ] Search for stale manual commands:

```bash
rg -n "backfill-history|backfill-start-date|backfill-window-days|HISTORY_BACKFILL_DAYS|BACKFILL_START_DATE" bridge docs scripts
```

Expected: no active CLI/config guidance; historical superseded docs may remain explicitly historical.

### Task 6: Verification and review package

**Files:**
- Review only all scoped files; no commit/deploy.

- [ ] Run Python bridge/tracking tests.
- [ ] Run `node --import tsx --test src/worker/history-checkpoint.test.ts src/worker/bridge-consumer.test.ts src/worker/bridge-mapper.test.ts`.
- [ ] Run related worker/trading tests affected by schema/consumer changes.
- [ ] Run Prisma validate/generate.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Inspect `git diff --check`, scoped diff/stat, and migration SQL.
- [ ] Run independent specification and code-quality review; fix Critical/Important issues and rerun focused tests.
- [ ] Present migration SQL, rollback/risk notes, scoped diff, exact test results, and production execution plan.
- [ ] Stop. Await explicit authorization before migration application, deployment, rebuild, commit, or push.
