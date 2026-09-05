# MT5 Native Bridge — Greenfield Architecture Specification

Status: implemented in production (`bridge/`, per ADR-0001) — retained as the
design/contract reference, no longer a gate on implementation.

Decision record: [ADR-0001](../docs/decisions/0001-mt5-native-bridge-greenfield.md)
covers why this is a separate greenfield package instead of an in-place
`bridge_v2` change, the alternatives considered, isolation requirements, and
the cutover/rollback/retirement conditions. This document specifies the
resulting contract; it does not re-argue that decision.

## 0. Design basis and invariants

This is a new Python package and protocol namespace. It does not import, wrap,
adapt, or preserve any existing bridge, worker, Redis, or database contract.
The only repository reference used by this design is
`docs/mql5book-native-python-support.md`. API behavior was cross-checked against
the official MetaTrader 5 Python Integration documentation.

Non-negotiable invariants:

1. MT5 event timestamps are opaque broker-server timestamp values in this
   contract. Preserve them exactly; never label or convert them to UTC.
2. Bridge-generated observation times are UTC and are explicitly separate from
   MT5 event time.
3. `None`, `False`, exceptions, and invalid result shapes are failures, never
   successful empty results.
4. An empty tuple is empty success only for an API whose documented successful
   collection result permits it.
5. Missing active state is an observation, not evidence of a close.
6. SQLite is the bridge-owned durable authority for acquired history and pending
   publication. Redis never advances history progress.
7. Every accepted history window commits its raw records, deterministic
   identifiers, outbox rows, and checkpoint transition in one SQLite
   transaction.
8. At most one producer may publish for a login in the configured coordination
   domain. Every publication is fenced.
9. The bridge never intentionally launches, stops, restarts, logs in, switches,
   or otherwise controls an MT5 terminal.

## 1. Responsibilities and explicit non-responsibilities

### Responsibilities

- Attach to one explicitly configured, already-running MT5 terminal per producer.
- Verify the Windows process, executable path, portable mode, data identity,
  terminal identity, login, and server before allowing publication.
- Acquire raw account state, active positions, active orders, history deals, and
  history orders using read-only Python API calls.
- Publish complete live observations and immutable history events in a new
  namespace.
- Synchronize history from a required configured lower bound to a safe trailing
  edge, then reconcile recent windows for late visibility.
- Preserve all named-tuple fields and raw numeric/string values.
- Provide deterministic identity, retries, recovery, health, and diagnostics.
- Own a host-local SQLite journal and transactional outbox.

### Non-responsibilities

- Launching, terminating, restarting, logging in, switching, or configuring MT5.
- Calling trading APIs, including `login`, `order_check`, or `order_send`.
- Inferring closed positions from active snapshots.
- Converting or interpreting broker-server timestamps.
- Computing analytics or normalized business semantics.
- Guaranteeing delivery exactly once. Delivery is at least once with stable IDs.
- Surviving total loss of the host or journal disk without external backup.
- Treating Redis keys, acknowledgements, stream offsets, or consumer state as
  durable acquisition progress.

## 2. Terminal connection and `/portable` behavior

Each immutable terminal profile contains:

```text
profile_id                 stable hash of canonical configured identity
executable_path            absolute allowlisted terminal64.exe path
portable                   required explicit boolean
expected_data_path         absolute canonical terminal data path
expected_login             integer
expected_server            exact server string
process_match_policy       executable + command line + owner/session criteria
initialize_timeout_ms      bounded timeout
coordination_domain        deployment-wide ownership domain
history_lower_bound_raw    raw MT5 broker-time integer; default 1735689600
```

Secrets are not part of the profile. The bridge never supplies login, password,
or server to `initialize`.

### Fail-closed attach sequence

1. Enumerate candidate `terminal64.exe` processes using a read-only Windows
   process inspection interface.
2. Require exactly one candidate matching canonical executable path, expected
   `/portable` mode, expected data identity evidence, OS user/session, and
   profile rules. Incomplete, inaccessible, or ambiguous evidence is failure.
3. Record a preflight fingerprint: PID, process creation time, executable file
   identity, canonical path, command line mode, and expected data path.
4. Acquire the host-local login lock and distributed Redis lease.
5. Immediately re-read the candidate fingerprint. Any change fails preflight.
6. Call `initialize(executable_path, timeout=..., portable=...)` without account
   credentials.
7. Read `version()`, `terminal_info()`, and `account_info()`. All must succeed.
8. Require terminal path/data path, portable expectation, connected state,
   account login, and server to match the profile and preflight fingerprint.
9. Re-enumerate the OS process. Reject unexpected process creation, replacement,
   PID/creation-time change, executable change, or candidate ambiguity.
10. Only after every check succeeds may the producer enter `OWNED_READY`.

Officially, `initialize()` may launch a terminal if required and exposes no
attach-only flag. Therefore a race exists between final preflight and
`initialize()`. This design minimizes and detects that race but does not claim
the Python API guarantees attach-only behavior.

Any unexpected launch or identity mismatch causes immediate Python
`shutdown()`, publication revocation, lease release, producer quarantine,
preservation of SQLite state, and a high-severity alert. The bridge never kills
the unexpected process.

Identity is revalidated before every poll cycle and after reconnect. A changed
account is never accepted as a new identity in-place.

## 3. Multi-terminal and duplicate-login handling

- One producer process owns one terminal profile and one login.
- One supervisor may run multiple producers for distinct portable terminals.
- One logical SQLite journal exists per bridge host; rows are isolated by
  `profile_id` and `login`.
- A host-local named mutex/file lock prevents two local writers for one login.
- A Redis lease prevents two hosts from publishing the same login within the
  coordination domain.
- Lease acquisition returns a fencing credential containing a coordination
  epoch and a token that increases monotonically within that epoch.
- Lease acquire/renew/release and fenced publish are atomic server-side
  operations. A publisher must prove lease owner ID and token in the same Redis
  operation that updates a live key or appends a stream entry.
- Failure to acquire yields `STANDBY_DUPLICATE`; the producer does not connect,
  poll, or publish.
- Lease uncertainty or renewal failure stops new MT5 calls and publication
  immediately. Reacquisition creates a new producer epoch and fencing token.
- Redis coordination-state loss or epoch change invalidates every outstanding
  lease. All producers stop, observe the new coordination epoch, and reacquire;
  no claim is made that a Redis-only counter remains monotonic across total
  Redis state loss.
- SQLite checkpoint state survives loss of ownership; ownership state does not
  change it.
- If a shared Redis coordination domain is unavailable, only explicit
  host-local mode is allowed and health must state that cross-host exclusivity is
  not guaranteed.

## 4. Raw acquisition

All MetaTrader calls for a profile execute serially in one session executor.
No call result is shared across profiles or threads.

### Live cycle

The bridge reads, in order:

1. `terminal_info()` and `account_info()` for identity and account snapshot;
2. `positions_get()` for all open positions;
3. `orders_get()` for all active orders.

Each call produces one of:

```text
SUCCESS_NONEMPTY  documented successful result with rows/value
SUCCESS_EMPTY     documented successful empty tuple
FAILED            None, False, exception, timeout, invalid shape, or identity drift
```

`last_error()` is captured immediately after a failed call. A prior/stale
`last_error()` value never converts a successful result into failure or vice
versa. `positions_total()` and `orders_total()` may be recorded as diagnostics,
but cannot override the getter result.

Each successful named tuple is serialized from `_asdict()` with:

- original field names;
- JSON-safe lossless representations defined by the schema;
- canonical UTF-8 JSON for hashing;
- no renamed, derived, timezone-converted, or analytics fields.

The observation also records profile/login/server, terminal/package versions,
fence, producer epoch, local sequence, and bridge
`read_started_at_utc`/`read_finished_at_utc`.

### History cycle

History sources are only:

- `history_deals_get(from_raw, to_raw)`;
- `history_orders_get(from_raw, to_raw)`.

Integer timestamp arguments are used to avoid implicit local `datetime`
conversion. Totals are diagnostic cross-checks, not record sources. Getter
`None`, exceptions, invalid rows, identity drift, or serialization failure abort
the window. Empty tuple is a successful empty collection.

History is kept as deals and orders. The bridge does not reconstruct closed
positions.

## 5. Live-state publication

A live cycle publishes one `live.snapshot` only when account, positions, and
orders all succeed under the same verified identity and fence. It contains
per-collection status and complete raw collections.

If any required read fails:

- do not overwrite the last complete live cache;
- return a `live.error` outcome to the worker loop;
- emit a structured `live_error login=... reason=... live_error_count=...` line to stderr and increment the in-process failure counter;
- mark the cache stale after the configured freshness threshold.

`live.error` is an internal outcome type, not a Redis stream publication. The removed `stream:live` transport is not recreated for error reporting.

The live cache represents the latest complete observation. A missing active
position/order means only “absent from this complete observation.” It never emits
a close/cancel history event.

Live events are not part of the durable history checkpoint. Their IDs include
the producer epoch and persisted monotonic sequence so a retry in the same epoch
is stable and a restarted producer cannot collide with a prior observation.

## 6. Complete historical synchronization

History synchronizes independently for `deal` and `order`, while a window is
committed as one unit containing both resource outcomes.

### Window algorithm

1. Load the SQLite checkpoint. A missing checkpoint starts at the profile’s
   required `history_lower_bound_raw` (default `1735689600`, representing
   `2025-01-01 00:00:00` in MT5 broker raw time); there is no epoch or rolling
   fallback and no timezone or broker-offset conversion. Startup uses
   `max(history_lower_bound_raw, persisted checkpoint)`. A persisted checkpoint
   below the bound is raised only after a verified side-by-side SQLite backup,
   empty pre-bound window proof, unresolved record-outbox checks, and a guarded
   compare-and-swap transaction; any ambiguity fails before Redis/MT5 startup.
2. Select a deterministic bounded half-open window `[start_raw, end_raw)`.
   While the committed prior window is provably empty (zero deals and zero
   orders) the span widens to the policy's coarse `empty_window_raw`
   (default 30 days; ADR-0006) so the 2025 empty prefix is crossed in ~14
   windows instead of ~420; a non-empty or missing prior window keeps the
   fixed `maximum_window_raw` span. Sizing never affects coverage — windows
   stay contiguous half-open ranges either way.
3. Cap the live edge behind a configured safety lag expressed in the same raw
   broker-server boundary domain. The boundary provider is explicit and
   testable; UTC wall-clock values are never silently relabeled as broker time.
4. Query deals and orders. Failure of either fails the whole window.
5. Validate shapes and preserve every raw field.
6. Sort deals by `(time_msc, time, ticket)` and orders by
   `(time_done_msc, time_done, time_setup_msc, time_setup, ticket)`, using raw
   values only. Missing documented fields use a schema-defined sentinel solely
   for ordering; payloads remain unchanged.
7. Compute record IDs, canonical payload digests, ordered resource digests,
   counts, and a window digest.
8. In one SQLite `BEGIN IMMEDIATE` transaction, insert the window, raw records,
   event outbox rows, and next checkpoint; then commit.
9. Only the successful SQLite commit advances acquired history.
10. The outbox publisher later delivers pending rows to Redis at least once.

Windows overlap by a configured amount. Natural identity and payload digest make
exact repeats no-ops. The same identity with a changed raw payload creates a
versioned correction event and never silently overwrites the prior observation.

Recent committed windows are periodically reconciled. Count/digest changes or
late records create new correction/window versions. Historical observations are
append-only except for explicit retention after a verified backup policy.

Empty windows are committed with zero counts and the canonical empty digest so
coverage is provable. Consecutive empty windows coalesce into coarse spans
(ADR-0006) — the coverage proof rests on contiguous `[start, end)` windows,
not on fixed one-day granularity.

## 7. Broker-server time semantics

- MT5 deal/order/position time fields are stored exactly as returned.
- Payload fields name the raw field (`time`, `time_msc`, `time_setup`, etc.) and
  carry integer values; no `Z`, UTC label, offset, or ISO rendering is added.
- Envelope metadata declares
  `event_time_semantic: "mt5-broker-server-raw"`.
- `observed_at_utc`, journal timestamps, lease times, and health times are
  bridge-generated UTC instants and cannot be substituted for event time.
- Query boundaries and checkpoints are raw integers with an explicit configured
  policy/version.
- Any downstream timezone interpretation requires separately configured broker
  timezone metadata and is outside this bridge.
- Ties use stable MT5 identity, never converted time.

The official documentation explicitly describes UTC behavior for bars/ticks but
does not establish an attach-only or universal UTC guarantee for every
deal/order field. This bridge therefore follows the stricter user contract:
preserve deal/order/position time values as opaque broker-server values.

## 8. Restart-safe SQLite journal

### Durability boundary

SQLite survives bridge process crashes and orderly or abrupt Windows restarts
when the database and WAL reside on a durable local filesystem. It does not
survive total VPS/disk loss unless the journal and required WAL state are backed
up externally. Redis cannot reconstruct authoritative acquisition progress.

One journal is used per host. It must not be placed on a network filesystem.
Startup applies:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = <configured bounded milliseconds>;
PRAGMA trusted_schema = OFF;
```

Migrations run under an exclusive migration lock, are ordered and checksummed,
and update `schema_migrations` only in the same transaction as the migration.
Startup rejects a newer/unknown schema version.

### Logical schema

```text
schema_migrations(
  version PK, checksum, applied_at_utc
)

producer_profiles(
  profile_id PK, login, server, terminal_id, config_digest,
  created_at_utc, last_verified_at_utc,
  UNIQUE(login)
)

producer_epochs(
  epoch_id PK, profile_id FK, fence_token, started_at_utc, ended_at_utc,
  start_reason, end_reason
)

login_locks(
  login PK, owner_instance_id, acquired_at_utc
)

history_checkpoints(
  profile_id PK/FK, generation, next_window_start_raw,
  last_window_id, policy_version, updated_at_utc
)

history_windows(
  window_id PK, profile_id FK, generation, window_revision,
  start_raw, end_raw, state CHECK(COMMITTED|SUPERSEDED),
  deal_count, order_count, deal_digest, order_digest, window_digest,
  observed_started_at_utc, observed_finished_at_utc, committed_at_utc,
  UNIQUE(profile_id, generation, start_raw, end_raw, window_revision)
)

history_record_versions(
  record_version_id PK, profile_id FK,
  resource CHECK(deal|order), natural_id, event_id,
  payload_json BLOB, payload_digest, correction_of NULL FK,
  UNIQUE(profile_id, resource, natural_id, payload_digest),
  UNIQUE(event_id)
)

history_window_records(
  window_id FK, resource CHECK(deal|order), ordinal,
  record_version_id FK,
  PRIMARY KEY(window_id, resource, ordinal),
  UNIQUE(window_id, record_version_id)
)

outbox_messages(
  event_id PK, window_id FK, profile_id FK, stream_key,
  envelope_json BLOB, payload_digest,
  state CHECK(PENDING|INFLIGHT|PUBLISHED|QUARANTINED),
  attempt_count, next_attempt_at_utc, claimed_by, claim_expires_at_utc,
  published_at_utc, redis_entry_id, last_error_class, last_error_redacted
)

live_sequences(
  profile_id PK/FK, producer_epoch_id FK, next_sequence
)

failure_events(
  failure_id PK, profile_id FK, occurred_at_utc, class, severity,
  resource, operation, details_redacted
)
```

No table stores MT5 passwords, Redis credentials, secret references resolved to
values, or connection strings.

### Atomic window transaction

The transaction validates that the current checkpoint and generation still
match the planned window, inserts or reuses immutable record versions, inserts
the ordered window membership rows, inserts record/correction outbox rows plus
one `history.window` outbox row, and advances `next_window_start_raw`. Any error
rolls back all changes. Redis is not contacted inside this transaction.

### Journal recovery

- **Missing:** create only at the configured canonical path after validating the
  parent directory and permissions; initialize schema; history restarts from the
  configured lower bound.
- **Locked:** honor bounded busy timeout, enter `JOURNAL_LOCKED`, publish nothing,
  and alert. Never bypass locking or copy the live database.
- **Corrupt:** if open, `quick_check`, or scheduled `integrity_check` fails,
  quarantine the producer and preserve database/WAL/SHM files for forensics. Do
  not auto-delete or recreate.
- **Incompatible:** reject unknown/newer schema or checksum mismatch and require
  operator migration/rollback.
- **Interrupted migration:** transactional migration rolls back; startup
  revalidates checksums before retry.
- **Missing after prior operation:** treat as possible data loss, not a fresh
  install, when an external sentinel/host identity indicates prior use; block
  until operator acknowledges recovery.

Backups use SQLite’s online backup API or a documented filesystem snapshot that
captures database/WAL consistently. Copying only the main file in WAL mode is
not a valid backup.

## 9. Deterministic retries and idempotency

Canonical JSON is UTF-8, sorted by field name, compact, rejects NaN/infinity, and
defines exact encodings for integers, finite floats, strings, booleans, and null.
Schema fixtures freeze this encoding.

```text
natural deal identity  = profile_id + login + server + deal.ticket
natural order identity = profile_id + login + server + order.ticket
payload_digest         = SHA-256(canonical raw payload)
event_id               = SHA-256(namespace + schema_version + resource
                                    + natural_identity + payload_digest)
window_id              = SHA-256(profile_id + generation + bounds
                                    + policy_version + window_revision)
window_event_id        = SHA-256(namespace + schema_version
                                    + "history.window" + window_id
                                    + window_digest)
```

Exact replay yields identical bytes, digests, and IDs. Changed payload for the
same natural identity yields a correction event linked to the previous version.
Initial acquisition uses window revision `1`. Reconciliation reuses that
revision when content is unchanged; changed content creates the next revision,
marks the prior revision `SUPERSEDED`, and does not move the forward checkpoint.

Retry classification, maximum attempts, exponential backoff cap, and
deterministic jitter derived from `(profile_id, operation, window_id, attempt)`
are config-versioned. Transient MT5/Redis failures retry. Identity,
configuration, schema, serialization, and journal failures do not.

Outbox claims use expiring SQLite leases. A crash before Redis publish leaves a
retryable claim; a crash after Redis publish but before marking `PUBLISHED`
re-sends the identical event. Consumers deduplicate by `event_id`.

## 10. New Redis contracts

Namespace: `mt5`, `account` entity segment. No compatibility aliases exist.

```text
mt5:account:{login}:lease            ownership lease hash
mt5:account:{login}:lease-epoch      coordination epoch (set once, immutable — see below)
mt5:account:{login}:fence-counter    monotonic fencing counter (INCRs on every acquire)
mt5:account:{login}:live             latest complete live snapshot
mt5:account:{login}:stream:history   deal/order/window history stream
```

Braces deliberately place all keys for one login in one Redis Cluster hash slot
— verified by CRC16 hash-slot check, not just cited: all five keys above hash
to the same slot regardless of the literal `mt5:account:` prefix preceding the
`{login}` tag, since the Cluster hash-tag algorithm only looks at the
substring between the first `{` and the following `}`.

`lease-epoch` and `fence-counter` are deliberately two separate keys, not the
same fencing value stored twice: `lease-epoch` is a random UUID minted once
per login (only written if the key doesn't already exist) and never changes
for the life of that coordination lineage; `fence-counter` is a plain `INCR`
that increases on every single lease acquisition. Both are compared on every
fenced write. The counter alone would already reject any stale credential
under normal concurrent-acquisition races — `lease-epoch` exists specifically
to guard the case where Redis loses both keys (unpersisted restart, flush)
and the counter restarts from 1: without a companion random value, a
long-lived in-memory `FenceCredential` from before the loss could coincide
with a post-loss counter value again after enough re-acquisitions, and be
wrongly accepted. Collapsing them into one value would remove that guard, so
they stay separate.

There is no per-producer Redis health key. A prior draft of this document
listed `mt5:{producer_id}:health`; grepping the bridge found no such key —
producer health is `HealthStore(config.state_dir)`, a local filesystem store
(`bridge/supervisor.py`), unrelated to Redis. Removed here as a documentation
correction, not a design change.

`stream:live` (a former write-only mirror of every live/error publication,
with zero consumers — confirmed by grep at removal time; the superseded
design doc that independently noted it has since been pruned with the other
completed plan/spec docs) has been removed from the contract entirely,
including the producer's Lua script and `RedisLease.append_live_stream_fenced`.
`live.error` publications are no longer mirrored anywhere in Redis.

`on_live_outcome` (`bridge/session_wiring.py`) turned out to be dead wiring
predating this removal — no production caller ever passed it, so a
`live.error` outcome was computed and silently discarded with zero trace
anywhere (found during post-cutover review, not caused by the `stream:live`
removal). Fixed in `bridge/worker.py`'s poll loop: a `FAILED` live outcome
now emits a structured `live_error login=... reason=... live_error_count=...`
line to stderr and increments an in-process counter, entirely as an
observability side effect — no change to control flow, retry behavior, or
what already raises for a fence-rejected outcome. See
`bridge/tests/unit/test_worker_live_error_observability.py`.

Lease values contain owner ID, coordination epoch, fencing token, producer
epoch, and expiry. Lua or an equivalent atomic primitive performs exact
compare-owner/coordination-epoch/token renewal and fenced publication. The token
counter is monotonic only inside one coordination epoch.

Two more Redis namespaces exist outside the bridge pipeline, as top-level
siblings of `mt5:` — not nested under it, since they're derived/application
state with independent lifecycles, not part of the MT5 protocol contract:

```text
cache:report-view:{accountId}:{timeframe}:{aggregateVersionKey}:{equityVersionKey}
                                    computed dashboard view, 300s TTL
                                    (src/lib/trading/report-view-cache.ts)
                                    View cache invariants (8.61): the
                                    aggregateVersionKey is HISTORY-ONLY (latest
                                    deal time, latest position close time,
                                    report-result recompute stamp) — live-tick
                                    noise (AccountSnapshot.updatedAt ~2s while
                                    trading, reportDate drift) must never enter
                                    it; equity freshness is served by the
                                    incremental equity patch path. View builds
                                    run on ONE worker thread whose protocol
                                    session-caches the parsed source per
                                    version (see view-build-worker.ts; equity
                                    ticks re-key that session in place via a
                                    `patch` message rather than minting a new
                                    source, and only peak-moved timeframes
                                    revalidate — 8.64); values
                                    over the 512KB cap are never persisted —
                                    large accounts fall back to live compute
                                    (a cache miss, never a correctness issue).
social:sparkline:reactions:{accountId}:{date}
                                    emoji reaction counts, 30-day TTL
social:sparkline:active:{sid}:{accountId}:{date}
                                    per-session active vote, 1-hour TTL
                                    (src/lib/social-shared.ts)
```

Common envelope:

```json
{
  "schema": "mt5n.bridge.v1",
  "message_type": "live.snapshot",
  "event_id": "sha256",
  "payload_digest": "sha256",
  "producer": {
    "producer_id": "stable-host-instance",
    "profile_id": "sha256",
    "epoch_id": "uuid",
    "coordination_epoch": "uuid",
    "fencing_token": 42
  },
  "terminal": {
    "terminal_id": "sha256",
    "portable": true,
    "path_digest": "sha256",
    "data_path_digest": "sha256"
  },
  "account": {"login": 123, "server": "exact-raw-server"},
  "observed_at_utc": "RFC3339",
  "event_time_semantic": "mt5-broker-server-raw",
  "payload_state": "complete",
  "payload": {}
}
```

History message types are `history.deal`, `history.order`, and
`history.window`. Record payloads contain the raw field map plus window ID, raw
bounds, resource ordinal, and correction link if applicable. `history.window`
publishes the committed bounds, counts, digests, ordered event IDs, and empty
coverage when applicable. Live types are `live.snapshot` and `live.error`.
Operational types are `health` and `producer.quarantined`.

Redis stream entry IDs are transport metadata only. ACKs, consumer group
offsets, pending entries, key existence, and stream retention never modify
SQLite checkpoints or outbox facts. Retention may delete delivered Redis data
without changing the journal.

### Post-cutover operational status (2026-08-01)

- The legacy `mt5n:v1:*` Redis namespace was removed from production after the coordinated bridge/worker cutover.
- The observed Redis memory reduction was the expected result of deleting the legacy streams, not evidence of eviction, restart, or ongoing stream loss.
- Current `entries-added` and `XLEN` growth has remained in 1:1 lockstep during observation. The original one-time gap is closed as **won't-fix-with-recurrence-trigger**: one-time, never reproduced through the 2026-08-30 outage rebuild and continuous 5-min health probing since; root cause explicitly unproven — reopen only if stream-gap detection fires again.
- Historical Deal/Order ingestion verification is **closed with evidence (2026-08-30, reconfirmed 2026-09-06)**: ingestion proven end-to-end from `stream:history` through worker-v2 into PostgreSQL for all five accounts (Deal=57,491 at 2026-08-30; 60,537 at 2026-09-06; 5/5 live leases; forward-only incremental sync active).
- No architectural claim should rely on `max-deleted-entry-id` distinguishing `XDEL` from `XTRIM`; use command evidence plus before/after `XINFO STREAM` snapshots when investigating retention.

## 11. State machines and failure recovery

### Producer lifecycle

```text
STARTING
  -> JOURNAL_READY
  -> PREFLIGHT
  -> ACQUIRING_OWNERSHIP
  -> CONNECTING
  -> VERIFYING_IDENTITY
  -> OWNED_READY
  -> RUNNING

RUNNING -> DEGRADED -> RUNNING
any pre-publication state -> STANDBY_DUPLICATE
identity/lifecycle/durability violation -> QUARANTINED
shutdown request -> DRAINING -> STOPPED
```

`QUARANTINED` requires operator action; it never reconnects automatically.

### History window

```text
PLANNED -> READING_DEALS -> READING_ORDERS -> VALIDATING
        -> SQLITE_TRANSACTION -> COMMITTED -> OUTBOX_PENDING
        -> PUBLISHING -> PUBLISHED
```

Any state before `COMMITTED` may retry the identical window and cannot advance
the checkpoint. `COMMITTED` is durable acquisition success even if publication
is pending. Publication failure returns to `OUTBOX_PENDING`; permanent payload
failure moves only the affected message to `QUARANTINED` and makes producer
health blocked.

### Failure classes

- `CONFIGURATION`: invalid/ambiguous profile, bounds, or policy; stop.
- `PREFLIGHT_IDENTITY`: process evidence incomplete or mismatched; quarantine.
- `UNEXPECTED_TERMINAL_LAUNCH`: new process detected around initialize;
  disconnect and quarantine.
- `IDENTITY_DRIFT`: PID, process creation time, path, data path, terminal, login,
  or server changed; disconnect and quarantine.
- `OWNERSHIP`: lease held elsewhere gives standby; lease uncertainty stops work.
- `COORDINATION_RESET`: Redis lease epoch changed or disappeared; stop,
  invalidate the fence, and require full reacquisition.
- `MT5_TRANSIENT`: IPC/send/receive/timeout; bounded reconnect after fresh
  preflight, checkpoint unchanged.
- `MT5_AUTH` / `MT5_PERMANENT`: stop or quarantine; no checkpoint movement.
- `MT5_EMPTY`: successful empty tuple; not an error.
- `SERIALIZATION`: preserve evidence, quarantine resource, never drop fields.
- `JOURNAL_LOCKED`: bounded wait then blocked health.
- `JOURNAL_CORRUPT` / `JOURNAL_INCOMPATIBLE`: preserve files and quarantine.
- `REDIS_TRANSIENT`: retain outbox and retry.
- `REDIS_PERMANENT`: retain outbox, block publication, alert.
- `SECURITY`: secret exposure, unsafe path/permissions, or identity tampering;
  quarantine.

## 12. Supervision and process lifecycle

The supervisor starts one bridge producer per declared profile but never starts
or manages MT5. It serializes journal migrations before producers start.

- Startup order: validate config/permissions → open/check/migrate journal →
  acquire local lock → preflight → distributed lease → initialize/verify.
- SIGTERM/SIGINT: stop new MT5 reads, stop lease-backed publication, finish or
  roll back the current SQLite transaction, optionally drain outbox within a
  deadline while the lease is valid, call Python `shutdown()`, release ownership,
  and exit.
- Hung MT5 calls are bounded by process-level supervision; terminating a stuck
  bridge process is allowed, terminating MT5 is not.
- Crash restart resumes from SQLite checkpoint and pending outbox.
- Restart backoff is bounded; duplicate ownership is standby, not a crash loop.
- Reconnect always repeats full fail-closed preflight and identity verification.
- The supervisor's periodic discovery rescan re-logs an unchanged
  same-host duplicate-login warning only when the set of currently-duplicated
  `(login, pid)` identities changes since the previous cycle, not on every
  tick, to avoid unbounded log repetition while a duplicate terminal stays
  running.

## 13. Observability and health

Structured logs include producer/profile/login, lifecycle state, PID fingerprint
digest, terminal identity digest, fence, operation, window/event ID, attempt,
duration, and redacted error classification.

Metrics include:

- process/preflight/connection/identity/ownership state;
- last successful live read and publication age;
- current raw history boundary and committed window age;
- records read, committed, corrected, duplicated, and rejected;
- SQLite transaction latency, WAL size, busy count, quick/integrity check status;
- outbox pending/inflight/quarantined count and oldest age;
- lease renewal latency/failure and stale-fence rejection;
- MT5 error code grouped by classified operation.

Health states are `healthy`, `degraded`, `stale`, `not-owner`, `blocked`,
`misconfigured`, and `quarantined`. Health distinguishes acquired-through from
published-through; it never claims history is published merely because the
checkpoint advanced.

High-severity alerts cover unexpected terminal launch, identity drift, lost
fence, journal corruption/disappearance, incompatible schema, secret exposure,
and permanently blocked outbox.

## 14. Security and secret handling

- No trading calls and no `login()` call are present in the allowed API surface.
- Credentials come only from environment/OS secret providers when required by
  infrastructure clients; resolved values never enter config files, SQLite,
  Redis payloads/keys, logs, health, fixtures, or crash reports.
- Executable, data, runtime, and journal paths are absolute, canonical,
  allowlisted, non-symlink/reparse-point as policy requires, and owner-writable
  only where necessary.
- Process inspection uses APIs directly, never shell interpolation.
- Redis uses TLS/auth and least-privilege ACLs scoped to `mt5`.
- Journal directory ACLs are restricted to the bridge service identity.
- Raw account/server identifiers have explicit retention and access policies.
- Redaction is allowlist-based; unknown config fields are redacted by default.

## 15. Tests and acceptance criteria

### Contract and property tests

- Canonical serialization fixtures round-trip every supported raw type.
- Field order does not affect payload digest.
- Exact replay produces byte-identical envelope, event ID, and digest.
- Changed raw payload produces one linked correction event.
- Missing/extra/unsupported fields follow explicit schema-version behavior.
- No timestamp conversion or UTC labeling occurs for MT5 event fields.

### MT5 adapter tests

- Tuple, empty tuple, `None`, `False`, exception, timeout, and malformed tuple.
- `None`/`False` can never become empty success.
- Empty active snapshots never infer a close.
- All raw account/position/deal/order fields are preserved.
- Integration tests are opt-in, read-only, and make no trading calls.

### Terminal safety tests

- Missing, ambiguous, inaccessible, and inconsistent preflight all prevent
  `initialize()`.
- Unexpected process creation during initialize is detected and quarantined.
- PID reuse/replacement, creation-time change, executable-path change, portable
  mismatch, data-path mismatch, account mismatch, and post-connect identity
  mismatch disconnect and stop publication.
- No code path terminates/restarts MT5 or claims attach-only is guaranteed.

### SQLite durability tests

- Crash injection before and after each statement/commit boundary.
- Complete window, records, outbox, and checkpoint are all-or-nothing.
- Empty window commits coverage with canonical empty digest.
- Restart resumes checkpoint and republishes pending identical outbox events.
- WAL/FULL, foreign keys, busy timeout, migrations, and checks are asserted.
- Missing-new, missing-after-use, locked, corrupt, incompatible, checksum
  mismatch, interrupted migration, and backup/restore paths are tested.
- Secrets cannot be serialized into any journal column.

### Ownership and Redis tests

- Two local producers cannot write one login.
- Two hosts cannot publish one login under the same coordination domain.
- Distinct portable terminals/logins operate independently.
- Lease loss stops reads/publication; stale fence cannot write cache or streams.
- Redis loss cannot advance, rewind, or erase SQLite acquisition progress.
- Redis coordination reset invalidates old epoch/token credentials before any
  producer can resume publication.
- Crash after Redis append but before outbox update replays identical event.
- ACKs, offsets, pending state, and key deletion do not affect checkpoints.

### History and lifecycle tests

- Bounded sync reaches the configured lower bound and trailing edge.
- Boundary ties, overlaps, late visibility, corrections, and empty ranges are
  deterministic.
- One resource failure aborts the entire combined window.
- Graceful stop, forced bridge crash, reconnect, and Windows restart preserve
  journal truth.
- Health correctly distinguishes acquired, pending publication, stale,
  not-owner, blocked, and quarantined.

### Release gate

No implementation phase may proceed until:

1. schema and envelope fixtures are reviewed;
2. the terminal race and durability boundary remain explicit;
3. every invariant has at least one planned test;
4. no existing bridge file is modified;
5. this architecture receives an explicit internal GO.

## Internal design review

Review scope was limited to this specification,
`docs/mql5book-native-python-support.md`, and the official MetaTrader 5 Python
API pages listed below. No existing bridge, worker, application schema, or
historical Redis contract was used as authority.

Findings incorporated during review:

- **HARDEN — terminal lifecycle:** official `initialize()` behavior makes an
  atomic attach-only guarantee impossible. Section 2 now specifies fail-closed
  preflight, post-connect process/account verification, quarantine, and explicit
  race disclosure.
- **HARDEN — overlapping history:** canonical record versions and ordered window
  membership are separate, allowing overlaps without duplicate events while
  retaining provable window counts/digests.
- **HARDEN — empty coverage:** every committed window has a `history.window`
  outbox event, including zero-record windows.
- **HARDEN — Redis reset:** fencing uses coordination epoch plus token and owner;
  the design does not claim a Redis-only counter survives total Redis state loss.

Review verdict:

```text
BLOCK: 0
HARDEN: 4 — incorporated above
NOTE: 1 — broker-server event-time semantics are an explicit product contract;
          bridge-generated UTC observation time remains separate.
gate: GO for contract-fixture implementation planning.
      NO-GO for runtime/deployment until reviewed fixtures and phase gates pass.
```

## Sources

- Repository reference:
  `docs/mql5book-native-python-support.md`
- Official MetaTrader 5 Python API:
  - https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5lasterror_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5positionsget_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5ordersget_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py
  - https://www.mql5.com/en/docs/python_metatrader5/mt5historyordersget_py
