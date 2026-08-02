# Ingestion review — Bug A: bridge_v2 history sync window bound

**Adds to, does not replace, the prior entries in this file** (Node-side
`epochSecondsToDate` fix, `b81f835`). This entry covers a separate,
independently-confirmed bug in `bridge_v2`'s history sync loop.

## What changed

- `bridge_v2/main.py`: `_history_loop` now computes `now_epoch` as broker-local
  (`true_utc_now + broker_utc_offset_minutes * 60`), not true UTC. New required
  CLI arg `--broker-utc-offset-minutes` (fails loud if omitted — no default).
- `bridge_v2/run_all_v2.py`: new `--broker-offset LOGIN=MINUTES` (repeatable),
  threaded through `_spawn()` to each child. `run()` refuses to supervise
  (logs an error, does not spawn) any login missing from `--broker-offset`
  rather than guessing.
- `history_publisher.py` is **unchanged** — its logic was already correct
  once fed a `now_epoch` in the right clock space; the bug was entirely in
  what `main.py` passed it.
- Docs corrected: `bridge_v2/README.md` "Time handling", `serializers.py`
  module docstring, `scripts/set-broker-utc-offset.ts` header comment — all
  previously asserted "MT5 epochs are already UTC, no offset applied", which
  is the same false claim `b81f835` corrected on the Node side.

## Evidence

**Root cause.** MT5's `positions_get()` (live) and `history_deals_get()`
(history) share one clock base — the broker trade server's own wall clock,
confirmed by the discriminator test in `b81f835`'s review entry (identical
raw epoch from both APIs for the same ticket). `bridge_v2/main.py`'s history
loop computed its query window's upper bound from `datetime.now(timezone.utc)`
— true UTC — then handed it straight to `history_deals_get()`, which compares
it against broker-local `deal.time`. Every query's effective bound was
therefore always `brokerUtcOffsetMinutes` short of real broker "now".

**Confirmed, not inferred — with a non-tautological test.** An initial check
("cursor tracks wall-clock 1:1") was correctly challenged as circular: `window_end`
is *defined* as `now_epoch - grace`, so of course it tracks true time,
regardless of whether MT5 actually returned matching data. The valid test:
10 most-recently-ingested deals for account 7954220, each imported within
seconds of being ingested (real-time), each showing a **`182 ± 0.5` minute**
lag between `imported_at` and the deal's own (corrected) true-UTC `time` —
tight and consistent, matching `brokerUtcOffsetMinutes` (180) plus fixed
overhead (grace + poll interval), not the wide scatter a generic latency
issue would produce. Every account was structurally frozen ~3 hours behind
real broker activity, permanently, until fixed.

**Note:** this is a separate bug from the specific 14:01→21:20 halt on
account 7948784 investigated the same session (MT8 terminal crash / failover
sequence) — that halt's root cause was not conclusively identified; it
resolved after an incidental worker-v2 restart. Bug A explains the *chronic*
~3h lag; it does not explain that one-off multi-hour halt.

## Design decision (confirmed with user)

Offset source: **CLI arg, per-login** (`--broker-offset LOGIN=MINUTES`), not
a single global env var (breaks the day a different-broker account is added)
and not a live Redis/DB lookup (keeps `bridge_v2` DB-free by design, per its
existing docstring). Verified before implementing: all 5 current accounts
share the same broker (`ICMarketsSC-MT5-2`) and offset (180) — SELECT against
`Account` confirmed this — so a per-login CLI list is a safe, minimal change
today and correct if that ever changes.

## Deployment status

**Code only, not deployed to the VPS.** Per explicit user decision, this
commit ships the fix to git but does NOT edit the live
`bridge_v2/service_wrapper.ps1` or restart the `MT5BridgeV2` nssm service.
Deploying requires adding `--broker-offset 7948784=180 7950622=180
7953093=180 7954220=180 7998410=180` to that script and restarting the
service — this briefly interrupts live ingestion for all 5 accounts and was
deliberately deferred to a separate, explicit action.

**Once deployed:** the next poll after restart will compute a correct
broker-local `now_epoch`. Since `window_start` (the cursor) already lives in
broker-local space (inherited from prior `window_end` values) and
`HISTORY_WINDOW_DAYS` (30) comfortably covers the ~3h gap, the very next
sync call self-heals in one chunk — no separate backfill/reset needed for
this bug specifically. (The historical Deal/Order/Position mixed-epoch-
convention seam from `b81f835` is a separate, still-open item.)

## Validation checklist

- [x] `python3 -m pytest -q bridge_v2/tests` → 92 passed, 1 skipped (7 new
      tests: `_parse_broker_offsets` parsing/error cases, `_spawn` includes
      the offset in the child's argv via a mocked `subprocess.Popen` — no
      real process launched — and `main.py`'s CLI now hard-requires
      `--broker-utc-offset-minutes`).
- [x] `python3 -m py_compile` on all touched files — clean.
- [x] No secret/credential/.env file in diff.
- [x] `history_publisher.py`'s own logic untouched — single-point fix at the
      one place true-UTC leaked in, matching "smallest correct fix."
- [ ] Live VPS deployment — explicitly deferred, not part of this commit.

**Verdict: pass for the code fix. VPS deployment is a separate, pending action.**

bridge-ingestion review: pass

---

# Ingestion review — Native bridge (bridge/) + worker-v2 current-state verification

**Adds to, does not replace, the prior entries in this file.** Read-only
review of the native MT5 bridge (`bridge/`) → Redis → worker-v2 → Postgres
path as of `c185527`. No files changed. Envelope semantics traced end-to-end:
raw MT5 epoch → bridge SQLite journal + outbox → per-account history stream
(`mt5:account:{login}:stream:history`) → worker-v2 upsert → Postgres.

## Findings

1. **UTC/offset — runtime correct; AGENTS.md:10 wording conflicts (doc fix recommended).**
   - Bridge publishes raw broker-server epochs untouched; envelope declares
     `event_time_semantic="mt5-broker-server-raw"` (`bridge/history.py:515`). No
     offset arithmetic anywhere on the bridge side (`history_boundary.py`
     docstring, `bridge/README.md:49`, `mt5_adapter.py` passes `start_raw`/`end_raw`
     straight through).
   - Worker converts exactly once: `epochSecondsToDate` subtracts `offsetMinutes`
     (`src/lib/time.ts:28-33`), applied to Deal (`mappers.ts:23`), Order
     `time_setup`/`time_done`/`time_expiration` (`mappers.ts:80-90`), OpenPosition
     (`mappers.ts:138`). Production-verified (`time.ts:19-26`, account 7954220).
   - `AGENTS.md:10` "Never shift MetaTrader Python epochs by broker-server offset"
     + "worker persist those UTC instants" literally contradicts the worker's
     single subtraction. Under a strict reading a future agent could "fix" the
     worker to stop converting and silently corrupt every timestamp. **Recommend**
     rewording AGENTS.md to: bridge publishes raw broker-server epochs; worker
     converts exactly once via `TradingAccount.brokerUtcOffsetMinutes`. Not a
     runtime defect.

2. **Missing history starts 2025-01-01 — PASS.**
   `bridge/config.py:10` `DEFAULT_HISTORY_LOWER_BOUND_RAW = 1735689600`;
   `_expected_checkpoint` clamps start to `history_lower_bound_raw`
   (`history.py:266-274`); `recover_history_lower_bound` raises obsolete empty
   checkpoints with journal backup + CAS (`repository.py:296-373`); PG
   `BridgeHistoryCheckpoint` defaults + backfill UPDATE (migration
   `20260726043000_set_history_start_2025`). No epoch-0 or rolling-now fallback.

3. **Idempotency — PASS.**
   Uniqueness: `Deal @@unique([tradingAccountId, dealNo])`
   (`schema.prisma:194`), `Order @@unique([tradingAccountId, orderTicket])`
   (`:336`), `Position @@unique([tradingAccountId, positionNo])` (`:161`).
   Worker upserts on those composites (`history-consumer.ts:101-110,153-162`).
   Bridge dedupes outbox by `event_id`, reuses the first durable publication
   obligation (`repository.py:474-507`), skips already-outboxed event IDs
   (`history.py:350-355`). Position reconstruction fail-closed on
   corrupted/ambiguous-reopen (`history-consumer.ts:118-126`).

4. **Checkpoint advance / ack mirror — PASS (doc note).**
   Bridge commits window + records + outbox + checkpoint advance in one
   `BEGIN IMMEDIATE` transaction (`repository.py:600-742`); advance is
   `max(expected.next_window_start_raw, window.end_raw)` inside it
   (`:710-737`). `mt5:bridge:history-ack:{login}` is written ONLY by
   `mirrorHistoryCheckpoint` (`history-checkpoint.ts:268-283`), post-commit,
   and only from the legacy recovery path (`history-recovery.ts:233`, invoked by
   `scripts/reset-history.ts:194`) — NOT wired into live `src/worker-v2/index.ts`.
   The bridge never reads the key; derived mirror per `AGENTS.md:10`.
   `docs/architecture-data-models.ts:32` documents BridgeHistoryCheckpoint/Chunk/
   Record as "retired, unused by live consumer." Note: the AGENTS.md:10 clause
   "advance PostgreSQL BridgeHistoryCheckpoint only after all barriers/counts/
   digests commit" describes that retired path — the live path owns checkpointing
   in the bridge SQLite journal. Recommend an AGENTS.md wording update.

5. **Restart / empty / Redis-loss / out-of-order — PASS.**
   Empty range → IDLE, no commit (`history.py:152-153`); empty-content window
   (0 deals / 0 orders) commits and advances coverage. Overlap windows dedupe
   (`history.py:143-147` + event-id/record-version chain). Redis loss: outbox
   claim lease + attempt_count + delivery_failure_count + max_attempts=8 →
   quarantine (`repository.py:769-939`); cleanup touches only PUBLISHED rows
   older than retention (`:930-939`). Worker acks only after DB success, leaves
   pending on failure (`history-consumer.ts:128-135,163-170`). Replay/reconcile
   tests in `bridge/tests/integration/test_history_journal.py`.
   - Observation (not a defect): malformed-envelope deals are `ack`ed and skipped
     (`history-consumer.ts:51-56,92-93`); since the bridge will not re-publish a
     matching-digest record and the worker cannot persist invalid JSON, such a
     deal is permanently absent from Postgres. Acceptable terminal-state design.

6. **positionNetPnl / pips — PASS.**
   `computeDealNetProfit = profit + swap + commission` (`mappers.ts:46-52`);
   position reconstruction netPnl includes swap + commission
   (`position-reconstructor.ts`). `Position.pips` is never written by the
   worker; the read path derives it via `positionPips` from open/close price +
   instrument spec (`analytics/instrument.ts:93-118`,
   `preaggregated/positions.ts:25-32`). Source boundary (Position) respected.

7. **Secrets — PASS.**
   Only `.env.test.example` + `bridge/.env.example` tracked; `.gitignore`
   covers `.env`/`.env.test` (lines 71-74, 180-184). docker-compose.yml /
   Caddyfile use env interpolation. `bridge/errors.py` redacts secret-shaped
   fields. CI `postgresql://ci:ci@localhost:5432/ci` is a test-fixture
   credential (observation only).

8. **Migrations / indexes — PASS (forward-looking note).**
   Recent Deal/Order/Position indexes (`20260708035435_mt5_runtime_db_hardening`,
   `20260719222335_mt5_schema_phase1_drop_dead_models`) are created without
   `CREATE INDEX CONCURRENTLY`. Already applied on freshly-built tables, so low
   risk today; future index migrations on the growing Deal/Order/Position tables
   should use CONCURRENTLY. The index set matches query paths (time-range,
   closeTime, positionId, symbol).

## Validation

- Python: `.venv-bridge-test/bin/python -m pytest -q bridge/tests` → **374 passed,
  4 skipped, 1 warning** in 3.40s. Warning: unregistered `@pytest.mark.integration`
  at `bridge/tests/integration/test_redis_transport.py:152` (cosmetic; register in
  a conftest). The 4 skipped are Redis-dependent integration tests — unavailable
  integration checks reported explicitly.
- TS: `node --import tsx --test src/worker-v2/*.test.ts` → all passed (replay
  idempotency, mappers, position reconstruction).
- No FTP / HTML report / manual import / file-hash path reintroduced
  (`history-consumer.ts:1-11` header, `docs/architecture-data-models.ts:32`).
- No secrets/credentials in diff (read-only review; only pre-existing uncommitted
  `.agents/skills/pipeline-health-check/SKILL.md` + `package-lock.json`, unrelated).

## Verdict: pass

No runtime defects found in the native ingestion path. Recommended follow-ups
(doc alignment, not code): reword `AGENTS.md:10` offset + BridgeHistoryCheckpoint
clauses; register `@pytest.mark.integration` in a conftest; use `CREATE INDEX
CONCURRENTLY` for future index migrations on large tables.

bridge-ingestion review: pass
