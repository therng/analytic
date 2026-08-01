# MT5 Native Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

Decision record: [ADR-0001](../docs/decisions/0001-mt5-native-bridge-greenfield.md)
covers why this plan builds an isolated package rather than changing
`bridge_v2` in place, and the cutover/rollback/retirement conditions that
apply once Task 13's acceptance gate passes.

**Goal:** Build a greenfield, read-only MT5 Python bridge with fail-closed
terminal attachment, raw live/history acquisition, SQLite-authoritative
checkpointing and outbox publication, fenced Redis ownership, and operational
health.

**Architecture:** One supervised producer process owns one configured terminal
profile/login. The producer serializes all MT5 calls, commits complete deal/order
history windows and outbox messages atomically to one host-local SQLite journal,
and publishes at least once through fenced Redis operations. Live snapshots are
complete observations; history and live data preserve raw MT5 fields and opaque
broker-server timestamp values.

**Tech Stack:** Python 3.11+, Windows, `MetaTrader5`, stdlib `sqlite3`,
`redis-py`, `psutil`, `pydantic` v2, `pytest`, `hypothesis`, `ruff`, and `mypy`.

## Global constraints

- Create only files under the new `mt5_bridge_native/` package.
- Do not read, import, copy, wrap, modify, or test against an existing bridge,
  worker, Redis contract, or application database.
- The implementation reference is `docs/mql5book-native-python-support.md`;
  verify uncertain API behavior against official MQL5 Python documentation.
- Do not call `login`, `order_check`, `order_send`, or any terminal lifecycle
  control API. `shutdown()` closes only the Python connection.
- Treat MT5 event timestamps as opaque broker-server values and preserve them.
- Treat `None`, `False`, exceptions, timeouts, and malformed results as failure.
- Never infer a closed position from its absence in a live observation.
- SQLite alone owns acquired-history checkpoints and pending-publication truth.
- Redis ACKs, offsets, entries, or keys never advance a checkpoint.
- One host journal; login-isolated rows; one local writer and one distributed
  fenced owner per login.
- Do not store secrets in SQLite, Redis payloads, logs, fixtures, or source.
- No runtime deployment or existing-system cutover is included in this plan.

## Planned file map

```text
mt5_bridge_native/
  pyproject.toml                     package, lint, type, and test configuration
  README.md                          operator contract and durability boundary
  src/mt5_bridge_native/
    __init__.py                      package version only
    config.py                        immutable validated profiles
    clock.py                         UTC observation clock and raw boundary port
    errors.py                        failure classes and redacted error records
    models.py                        envelope, result, identity, and state models
    canonical.py                     canonical JSON, digests, deterministic IDs
    process_probe.py                 Windows process discovery/fingerprints
    mt5_port.py                      narrow read-only MT5 protocol
    mt5_adapter.py                   strict result classification/raw capture
    terminal_session.py              fail-closed preflight/connect/revalidation
    journal/
      connection.py                 SQLite pragmas, checks, transactions
      migrations.py                 ordered checksummed migrations
      migrations/001_initial.sql     initial schema from ARCHITECTURE.md
      repository.py                 window/checkpoint/outbox persistence
      backup.py                      online-backup and restore validation
    ownership.py                     local login lock and ownership interface
    redis_transport.py               leases, fencing, streams, live cache
    history.py                       deterministic window/reconciliation machine
    live.py                          complete live observation machine
    outbox.py                        claims, retries, and repeatable publication
    health.py                        state aggregation, metrics, redaction
    producer.py                      one-profile orchestration
    supervisor.py                    multi-profile child-process supervision
    cli.py                           validate, migrate, check, run, backup commands
  tests/
    contract/                        frozen JSON and ID fixtures
    unit/                            pure and fake-backed tests
    integration/                     SQLite/Redis/process/opt-in MT5 tests
    fault/                           crash and corruption harness
```

---

### Task 1: Freeze package boundaries, configuration, and failure vocabulary

**Files:**

- Create: `mt5_bridge_native/pyproject.toml`
- Create: `mt5_bridge_native/src/mt5_bridge_native/__init__.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/config.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/errors.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/models.py`
- Test: `mt5_bridge_native/tests/unit/test_config.py`
- Test: `mt5_bridge_native/tests/unit/test_models.py`

**Interfaces:**

- Produces `TerminalProfile`, `JournalConfig`, `RedisConfig`,
  `RetryPolicy`, `FailureClass`, `CallState`, `ProducerState`,
  `HistoryWindowState`, and `RedactedFailure`.
- `TerminalProfile.profile_id` is derived from non-secret canonical identity.
- All later tasks import these definitions; none defines parallel string states.

- [ ] **Step 1: Write failing configuration tests**

  Cover absolute executable/data paths, explicit portable boolean, positive
  timeout, required login/server/raw lower bound, canonical duplicate-login
  rejection, secret-shaped fields, and stable `profile_id`.

- [ ] **Step 2: Run the focused tests and confirm failure**

  Run:
  `python -m pytest tests/unit/test_config.py tests/unit/test_models.py -q`
  from `mt5_bridge_native/`.

  Expected: collection/import failure because the package contracts do not exist.

- [ ] **Step 3: Add the minimal package and typed models**

  Use frozen Pydantic models with `extra="forbid"`. Represent MT5 raw boundaries
  as integers, observation timestamps as aware UTC datetimes, and lifecycle
  states as enums. Do not add Redis clients, SQLite access, or MT5 imports.

- [ ] **Step 4: Prove secret rejection and deterministic identity**

  Add assertions that password/token/connection-string values cannot appear in
  model dumps and that field-order changes do not change `profile_id`.

- [ ] **Step 5: Run unit, lint, and type checks**

  Run:
  `python -m pytest tests/unit/test_config.py tests/unit/test_models.py -q`,
  `ruff check src tests`, and `mypy src`.

- [ ] **Step 6: Commit the isolated contract**

  Commit message: `feat: define native bridge configuration contracts`.

### Task 2: Freeze canonical serialization and wire fixtures

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/canonical.py`
- Create: `mt5_bridge_native/tests/contract/envelope-v1.json`
- Create: `mt5_bridge_native/tests/contract/history-deal-v1.json`
- Create: `mt5_bridge_native/tests/contract/history-order-v1.json`
- Create: `mt5_bridge_native/tests/contract/history-window-v1.json`
- Create: `mt5_bridge_native/tests/unit/test_canonical.py`
- Create: `mt5_bridge_native/tests/contract/test_contract_fixtures.py`

**Interfaces:**

- Produces `canonical_json_bytes(value) -> bytes`,
  `sha256_hex(data) -> str`, `record_event_id(...) -> str`, and
  `history_window_id(...) -> str`.
- Rejects NaN, infinity, unsupported objects, non-string mapping keys, and
  implicit datetime serialization.

- [ ] **Step 1: Write failing example and Hypothesis properties**

  Assert sorted-key compact UTF-8 output, finite-float behavior, lossless large
  integers, raw timestamp preservation, field-order independence, and stable
  IDs across repeated processes.

- [ ] **Step 2: Run tests and confirm missing canonical functions**

  Run:
  `python -m pytest tests/unit/test_canonical.py tests/contract/test_contract_fixtures.py -q`.

- [ ] **Step 3: Implement only the canonical encoder and ID functions**

  The record ID input is namespace, schema version, resource, natural identity,
  and payload digest. The window ID also includes profile, generation, raw
  bounds, policy version, and window revision.

- [ ] **Step 4: Generate and review frozen fixtures**

  Fixtures must show `schema`, message type, event/payload digest, producer
  identity/fence, terminal path digests, exact login/server,
  `observed_at_utc`, `event_time_semantic`, payload state, and raw payload.
  No secret or converted MT5 time is permitted.

- [ ] **Step 5: Run repeatability checks in separate Python processes**

  Run the contract suite twice with different `PYTHONHASHSEED` values and require
  byte-identical fixture output.

- [ ] **Step 6: Commit**

  Commit message: `feat: freeze native bridge wire contracts`.

### Task 3: Implement strict MT5 read-port semantics with fakes first

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/mt5_port.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/mt5_adapter.py`
- Create: `mt5_bridge_native/tests/fakes/fake_mt5.py`
- Create: `mt5_bridge_native/tests/unit/test_mt5_adapter.py`
- Create: `mt5_bridge_native/tests/integration/test_mt5_readonly.py`

**Interfaces:**

- `Mt5Port` exposes only `initialize`, `shutdown`, `version`,
  `terminal_info`, `account_info`, `positions_get`, `orders_get`,
  `history_deals_get`, `history_orders_get`, and `last_error`.
- `StrictMt5Adapter` returns `CallResult[T]` with
  `SUCCESS_NONEMPTY`, `SUCCESS_EMPTY`, or `FAILED`.
- The adapter never exposes `login` or trading methods.

- [ ] **Step 1: Write the full result-matrix tests**

  Cover named tuple, non-empty tuple, empty tuple, `None`, `False`, exception,
  timeout, malformed row, `_asdict()` failure, and a stale `last_error`.

- [ ] **Step 2: Confirm every test fails before implementation**

  Run: `python -m pytest tests/unit/test_mt5_adapter.py -q`.

- [ ] **Step 3: Implement the narrow protocol and fake**

  Make the fake record every call so tests can prove no prohibited method was
  invoked.

- [ ] **Step 4: Implement strict classification and raw capture**

  Capture `last_error()` immediately only on failure. Preserve `_asdict()` keys
  and values. Pass history boundaries as integers.

- [ ] **Step 5: Add opt-in read-only integration tests**

  Gate with `RUN_MT5_NATIVE_INTEGRATION=1`. Tests read identity and collections
  only and skip unless an already-running configured fixture is present.

- [ ] **Step 6: Run focused and static checks, then commit**

  Commit message: `feat: add strict read-only MT5 adapter`.

### Task 4: Build fail-closed Windows process preflight and terminal session

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/process_probe.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/terminal_session.py`
- Create: `mt5_bridge_native/tests/fakes/fake_process_probe.py`
- Create: `mt5_bridge_native/tests/unit/test_process_probe.py`
- Create: `mt5_bridge_native/tests/unit/test_terminal_session.py`
- Create: `mt5_bridge_native/tests/integration/test_windows_preflight.py`

**Interfaces:**

- `ProcessProbe.match(profile) -> ProcessFingerprint` returns exactly one
  verified PID/path/creation-time/command-line/owner-session/data-identity
  candidate or raises `PreflightIdentityError`.
- `TerminalSession.connect_verified(profile, fence) -> VerifiedSession`.
- `VerifiedSession.revalidate()` must pass before every poll.
- Any post-initialize mismatch calls only Python `shutdown()` and returns a
  quarantined failure.

- [ ] **Step 1: Write preflight failure tests**

  Include no process, two candidates, access denied, wrong executable, wrong
  `/portable`, wrong owner/session, unverifiable data identity, and fingerprint
  change before initialize.

- [ ] **Step 2: Write race and post-connect mismatch tests**

  Include unexpected process creation, PID replacement/reuse, creation-time
  change, terminal path/data path mismatch, disconnected terminal, wrong
  login/server, and account change after successful connection.

- [ ] **Step 3: Run tests and confirm failures**

  Run:
  `python -m pytest tests/unit/test_process_probe.py tests/unit/test_terminal_session.py -q`.

- [ ] **Step 4: Implement read-only process probing**

  Use `psutil`/Windows APIs without shell commands. Canonicalize paths, include
  process creation time to defeat PID reuse, and fail if any required evidence
  is inaccessible.

- [ ] **Step 5: Implement the connect/revalidate sequence**

  Call `initialize(path, timeout=..., portable=...)` only after the second
  fingerprint check. Never pass login/password/server. Compare `terminal_info`
  and `account_info` to profile and fingerprint, then enumerate processes again.

- [ ] **Step 6: Prove terminal control is absent**

  Add a source-level allowlist test that rejects calls to `terminate`, `kill`,
  `Popen`, `run`, `login`, `order_check`, and `order_send` in runtime modules.

- [ ] **Step 7: Run Windows opt-in integration and commit**

  Commit message: `feat: enforce fail-closed MT5 attachment`.

### Task 5: Create and migrate the host-local SQLite journal

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/journal/connection.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/journal/migrations.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/journal/migrations/001_initial.sql`
- Create: `mt5_bridge_native/src/mt5_bridge_native/journal/repository.py`
- Create: `mt5_bridge_native/tests/unit/test_journal_migrations.py`
- Create: `mt5_bridge_native/tests/integration/test_journal_repository.py`

**Interfaces:**

- `Journal.open(config) -> Journal` verifies path/ACL policy and applies WAL,
  FULL synchronous mode, foreign keys, busy timeout, and trusted-schema off.
- `JournalRepository.commit_window(expected_checkpoint, window, records,
  outbox) -> Checkpoint` performs one `BEGIN IMMEDIATE` transaction.
- `JournalRepository.claim_outbox(...)` uses expiring claims.

- [ ] **Step 1: Write pragma and migration tests**

  Assert every required pragma, migration checksum, exclusive migration lock,
  unknown/newer-version refusal, rollback of interrupted migration, all foreign
  keys, uniqueness constraints, and absence of secret columns.

- [ ] **Step 2: Write atomic repository tests**

  Assert window, immutable record versions, ordered window memberships,
  record/window outbox rows, and checkpoint commit together. Inject failure
  before every statement and immediately before commit.

- [ ] **Step 3: Confirm failures against an empty temporary directory**

  Run:
  `python -m pytest tests/unit/test_journal_migrations.py tests/integration/test_journal_repository.py -q`.

- [ ] **Step 4: Implement connection and migrations**

  Use stdlib `sqlite3`, explicit transactions, parameterized SQL, and one journal
  connection owner. Do not perform Redis or MT5 calls within a transaction.

- [ ] **Step 5: Implement repository compare-and-swap semantics**

  Reject a window if checkpoint generation/start changed. Reuse exact record
  versions; create linked corrections for changed payloads; create
  `history.window` outbox rows including empty windows.

- [ ] **Step 6: Run crash-safe integration tests and commit**

  Commit message: `feat: add durable native bridge journal`.

### Task 6: Add journal integrity, backup, and recovery policy

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/journal/backup.py`
- Create: `mt5_bridge_native/tests/integration/test_journal_recovery.py`
- Create: `mt5_bridge_native/tests/fault/test_journal_faults.py`

**Interfaces:**

- `check_journal(path, expected_host) -> JournalCheckResult`.
- `backup_journal(source, destination) -> BackupManifest` uses SQLite online
  backup and verifies the destination.
- Recovery returns explicit missing-new, missing-after-use, locked, corrupt, or
  incompatible outcomes; it never deletes/recreates evidence automatically.

- [x] **Step 1: Write recovery classification tests**

  Create fixtures for new path, external prior-use sentinel with missing DB,
  locked DB, malformed file, failed quick/integrity check, WAL recovery,
  migration checksum mismatch, and newer schema.

- [x] **Step 2: Write online-backup/restore tests**

  Mutate the source during backup, verify a consistent restored database, and
  prove copying only the main WAL-mode file is rejected as a backup procedure.

- [x] **Step 3: Run and confirm failure**

  Run:
  `python -m pytest tests/integration/test_journal_recovery.py tests/fault/test_journal_faults.py -q`.

- [x] **Step 4: Implement fail-closed checks and online backup**

  Preserve DB/WAL/SHM paths on failure and emit only redacted diagnostic data.

- [x] **Step 5: Run tests and commit**

  Commit message: `feat: add journal recovery and backup controls`.

### Task 7: Implement local ownership and fenced Redis primitives

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/ownership.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/redis_transport.py`
- Create: `mt5_bridge_native/tests/unit/test_ownership.py`
- Create: `mt5_bridge_native/tests/integration/test_redis_transport.py`

**Interfaces:**

- `LocalLoginLock.acquire(login, owner_id) -> LocalLock`.
- `RedisLease.acquire(login, owner_id, producer_epoch_id, ttl_ms)
  -> FenceCredential`, containing coordination epoch and token.
- `renew`, `release`, `publish_live_fenced`, and `append_stream_fenced` are
  atomic compare-owner/token operations.
- Redis methods have no journal/checkpoint mutation capability.

- [x] **Step 1: Write local duplicate-writer tests**

  Assert only one process can own a login, stale lock evidence is handled
  explicitly, and distinct logins can proceed concurrently.

- [x] **Step 2: Write Redis fencing tests**

  Assert tokens monotonic within a coordination epoch, TTL/renewal, wrong-owner
  failure, stale-token/epoch rejection, coordination reset, lease loss, atomic
  live update/stream append, Redis Cluster hash-slot alignment, and two-host
  contention.

- [x] **Step 3: Run against an isolated Redis instance and confirm failure**

  Gate integration tests with `RUN_REDIS_INTEGRATION=1` and a dedicated test URL.

- [x] **Step 4: Implement local lock and Lua-backed Redis operations**

  Keep credentials only in the client constructor and redact Redis exceptions.
  Ensure lease TTL exceeds the maximum initialize call plus verification margin,
  or renew it from an independent ownership watchdog.

- [x] **Step 5: Prove Redis cannot advance history**

  Add an architecture test that the transport imports no journal repository and
  accepts no checkpoint/window transition object.

- [x] **Step 6: Run tests and commit**

  Commit message: `feat: add fenced native bridge ownership`.

### Task 8: Implement the deterministic history state machine

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/clock.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/history.py`
- Create: `mt5_bridge_native/tests/unit/test_history.py`
- Create: `mt5_bridge_native/tests/integration/test_history_journal.py`

**Interfaces:**

- `RawBoundaryProvider.safe_end(profile) -> int` is explicit and testable.
- `HistorySynchronizer.run_next_window(session, checkpoint) -> WindowOutcome`.
- The synchronizer passes a fully validated `CommittedWindowInput` to the
  repository; it never changes checkpoint state directly.
- `reconcile(window_id)` creates revision `n+1` only when content changed.

- [x] **Step 1: Write window-planning and ordering tests**

  Cover required lower bound, half-open bounds, safety lag, maximum window size,
  deal/order ordering ties, overlap, empty resources, and deterministic retry.

- [x] **Step 2: Write failure and atomicity tests**

  Prove either resource failure aborts the combined window; invalid rows,
  identity drift, and serialization failures commit nothing.

- [x] **Step 3: Write reconciliation tests**

  Cover unchanged replay, late record, changed payload correction, prior revision
  supersession, and no forward-checkpoint movement during reconciliation.

- [x] **Step 4: Run focused tests and confirm failure**

  Run:
  `python -m pytest tests/unit/test_history.py tests/integration/test_history_journal.py -q`.

- [x] **Step 5: Implement minimal window and reconciliation machines**

  Keep calls serial, use integer bounds, validate the session identity before
  reads and before journal commit, and compute all bytes/IDs before transaction.

- [x] **Step 6: Run tests under multiple hash seeds and commit**

  Commit message: `feat: synchronize raw MT5 history durably`.

### Task 9: Implement complete live snapshots without close inference

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/live.py`
- Create: `mt5_bridge_native/tests/unit/test_live.py`
- Create: `mt5_bridge_native/tests/integration/test_live_redis.py`

**Interfaces:**

- `LivePublisher.poll_once(session, fence) -> LiveOutcome`.
- A complete snapshot requires successful account, positions, and orders reads.
- `live.error` does not overwrite `mt5:account:{login}:live`.

- [x] **Step 1: Write complete/empty/partial/failure tests**

  Prove empty position/order tuples are valid complete collections, any failed
  collection blocks snapshot replacement, and disappearance never emits a
  close/cancel event.

- [x] **Step 2: Write sequence and fencing tests**

  Assert stable retry within a producer epoch, no collision after restart, and
  stale-fence rejection.

- [x] **Step 3: Run and confirm failure**

  Run:
  `python -m pytest tests/unit/test_live.py tests/integration/test_live_redis.py -q`.

- [x] **Step 4: Implement serialized polling and fenced publication**

  Revalidate identity before the cycle, preserve raw fields, and record UTC only
  as observation metadata.

- [x] **Step 5: Run tests (commit deferred to task owner)**

  Commit message: `feat: publish complete native MT5 live state`.

### Task 10: Implement transactional-outbox draining and retry

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/outbox.py`
- Create: `mt5_bridge_native/tests/unit/test_outbox.py`
- Create: `mt5_bridge_native/tests/fault/test_outbox_crashes.py`

**Interfaces:**

- `OutboxPublisher.drain_once(limit) -> DrainOutcome`.
- Claims are SQLite-expiring leases. Success records Redis entry ID as
  diagnostic metadata only.
- Retry uses deterministic backoff; permanent failures quarantine one message
  and block health without changing the checkpoint.

- [ ] **Step 1: Write claim/retry tests**

  Cover two drainers, expired claim recovery, transient/permanent classification,
  deterministic schedule, maximum attempt policy, and lease loss.

- [ ] **Step 2: Write crash-window tests**

  Crash before append, after append/before `PUBLISHED`, and after
  `PUBLISHED`. Require identical event bytes/ID on replay and no checkpoint
  mutation.

- [ ] **Step 3: Run and confirm failure**

  Run:
  `python -m pytest tests/unit/test_outbox.py tests/fault/test_outbox_crashes.py -q`.

- [ ] **Step 4: Implement claim, fenced send, and journal update**

  Never hold a SQLite transaction across Redis I/O. Verify ownership before each
  send and stop draining immediately on fence uncertainty.

- [ ] **Step 5: Run tests and commit**

  Commit message: `feat: drain native bridge outbox safely`.

### Task 11: Add health, redaction, producer orchestration, and supervision

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/health.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/producer.py`
- Create: `mt5_bridge_native/src/mt5_bridge_native/supervisor.py`
- Create: `mt5_bridge_native/tests/unit/test_health.py`
- Create: `mt5_bridge_native/tests/unit/test_producer.py`
- Create: `mt5_bridge_native/tests/integration/test_supervisor.py`

**Interfaces:**

- `HealthAggregator.snapshot() -> HealthSnapshot` distinguishes acquired and
  published boundaries.
- `Producer.run(profile)` follows the architecture lifecycle exactly.
- `Supervisor.run(profiles)` starts isolated child producers and serializes
  journal migrations.

- [ ] **Step 1: Write health/redaction tests**

  Cover healthy, degraded, stale, not-owner, blocked, misconfigured, quarantined,
  acquired-ahead-of-published, journal failures, and unknown-field redaction.

- [ ] **Step 2: Write lifecycle tests**

  Assert startup order, standby behavior, renewal failure, identity drift,
  bounded reconnect with new preflight, graceful stop, transaction rollback,
  outbox drain deadline, and forced child restart without MT5 control.

- [ ] **Step 3: Run and confirm failure**

  Run:
  `python -m pytest tests/unit/test_health.py tests/unit/test_producer.py tests/integration/test_supervisor.py -q`.

- [ ] **Step 4: Implement health and one-profile orchestration**

  Use explicit state transitions. Make quarantine terminal until operator action.

- [ ] **Step 5: Implement multi-profile supervision**

  Use child processes because the MetaTrader module connection is treated as
  process-global. Never share a live MT5 adapter across profiles.

- [ ] **Step 6: Run tests and commit**

  Commit message: `feat: supervise native bridge producers`.

### Task 12: Add safe CLI and operator documentation

**Files:**

- Create: `mt5_bridge_native/src/mt5_bridge_native/cli.py`
- Create: `mt5_bridge_native/README.md`
- Create: `mt5_bridge_native/tests/unit/test_cli.py`
- Create: `mt5_bridge_native/tests/contract/test_no_existing_bridge_dependency.py`
- Modify: `mt5_bridge_native/pyproject.toml`

**Interfaces:**

- Commands: `validate-config`, `journal-check`, `journal-migrate`,
  `journal-backup`, and `run`.
- Destructive journal reset/recreate is deliberately absent.

- [ ] **Step 1: Write CLI safety tests**

  Assert validation does not initialize MT5, checks do not mutate, migration is
  explicit, backup uses the online API, `run` refuses failed preflight, and no
  command prints secrets.

- [ ] **Step 2: Write isolation guard**

  Scan imports and source references under the new package and fail on any
  existing bridge/package namespace or file traversal outside the approved
  reference and this package.

- [ ] **Step 3: Run and confirm failure**

  Run:
  `python -m pytest tests/unit/test_cli.py tests/contract/test_no_existing_bridge_dependency.py -q`.

- [ ] **Step 4: Implement CLI entry points**

  Require explicit config and journal paths; print redacted structured results;
  refuse ambiguous defaults.

- [ ] **Step 5: Document operations and durability**

  Document preflight limitations, the unavoidable `initialize()` race, required
  existing terminal state, SQLite/WAL backup, disk-loss boundary, Redis
  independence, quarantine recovery, and read-only API scope.

- [ ] **Step 6: Run tests and commit**

  Commit message: `docs: add native bridge operating contract`.

### Task 13: Full fault-injection and acceptance gate

**Files:**

- Create: `mt5_bridge_native/tests/fault/test_process_crash_matrix.py`
- Create: `mt5_bridge_native/tests/integration/test_end_to_end.py`
- Create: `mt5_bridge_native/ACCEPTANCE.md`

**Interfaces:**

- No new runtime interface. This task proves the system-wide contracts and
  records evidence.

- [ ] **Step 1: Enumerate every architecture acceptance criterion**

  Map each criterion in `ARCHITECTURE.md` to an exact automated test node ID or
  an explicitly opt-in Windows/MT5/Redis test.

- [ ] **Step 2: Run the transaction/outbox crash matrix**

  Kill the bridge child at every journal statement boundary and at every
  Redis/outbox boundary. Restart and assert no lost committed record,
  no double checkpoint advance, stable event IDs, and eventual outbox drain.

- [ ] **Step 3: Run the non-integration quality gate**

  Run:

  ```text
  python -m pytest tests/unit tests/contract tests/fault -q
  ruff check src tests
  ruff format --check src tests
  mypy src
  ```

- [ ] **Step 4: Run isolated Redis/SQLite integration**

  Run:
  `RUN_REDIS_INTEGRATION=1 python -m pytest tests/integration -q`,
  excluding the opt-in real MT5 marker when no terminal fixture exists.

- [ ] **Step 5: Run opt-in Windows/MT5 acceptance**

  With an already-running disposable terminal fixture, run only read APIs and
  prove preflight identity, raw fields, failure/empty distinction, and absence
  of terminal lifecycle control.

- [ ] **Step 6: Record exact evidence and unresolved environmental skips**

  `ACCEPTANCE.md` lists command, environment, result, timestamp, and skipped
  checks. A skipped required integration check prevents production GO.

- [ ] **Step 7: Perform final adversarial design/implementation review**

  Review terminal safety, time semantics, SQLite atomicity, outbox crash windows,
  fencing, secrets, and package isolation. Runtime rollout remains out of scope.

- [ ] **Step 8: Commit the acceptance evidence**

  Commit message: `test: verify native bridge acceptance criteria`.

## Phase gates

1. **Contract gate:** Tasks 1–2 pass; fixtures receive explicit review.
2. **Safety gate:** Tasks 3–4 pass before any real terminal integration.
3. **Durability gate:** Tasks 5–6 pass all crash/recovery tests.
4. **Coordination gate:** Task 7 proves local exclusion and distributed fencing.
5. **Acquisition gate:** Tasks 8–10 prove deterministic history/live/outbox flow.
6. **Operational gate:** Tasks 11–12 prove lifecycle, health, and safe operation.
7. **Acceptance gate:** Task 13 passes, including required environment-backed
   checks, before any deployment or cutover plan is written.

No gate authorizes modification or removal of an existing bridge.

## Post-migration follow-up status (2026-08-01)

- [ ] **P0 — Verify historical Deal/Order ingestion end-to-end.** For every active account, record the current backfill boundary, confirm whether `history.deal` or `history.order` events are emitted, and prove persistence into PostgreSQL under the current Account IDs.
- [ ] **P1 — Monitor the one-time Redis stream length gap.** Current stream growth is healthy and the memory drop was explained by approved legacy-key deletion. Re-open investigation only if `entries-added - length` grows again or other contradictory evidence appears.
- [x] **P2 — Restore `live.error` observability.** `bridge/worker.py` now logs structured failure lines and increments an in-process counter without changing retry or control flow. Regression coverage is in `bridge/tests/unit/test_worker_live_error_observability.py`.
- [x] **P3 — Retire legacy terminology.** The production `mt5n:v1:*` key namespace is gone. Remaining `namespace="mt5n:v1"` arguments inside deterministic event-ID generation are compatibility hash salts and must not be renamed without an explicit event-ID migration decision.
- [ ] **P4 — Deduplicate repeat discovery duplicate-login warnings (implemented, not yet deployed).** `bridge/discovery.py` and `bridge/supervisor.py` now track the `(login, pid)` identity of each "already discovered from another process" warning per rescan cycle and only re-log it when the set of currently-duplicated identities changes, instead of every rescan tick. Covered by `bridge/tests/unit/test_discovery.py` and `bridge/tests/integration/test_supervisor.py`. This change is present in the working tree only as of 2026-08-01; it has not been committed or deployed to the VPS bridge service.

These follow-ups are operational verification tasks for the deployed bridge and are separate from the greenfield implementation task sequence above.
