# bridge `__main__.py` entrypoint — design

Status: **third revision, still not implemented** (2026-07-31). Design only.
Most of the ground-truth-supporting modules now exist and are tested
(`bridge/account_config.py`, `bridge/paths.py`, `bridge/atomic_io.py`,
`bridge/exit_codes.py`, `bridge/health.py`, `bridge/quarantine.py`,
`bridge/restart_policy.py`, `bridge/job_object.py`,
`bridge/adapters/mt5_real.py`, `bridge/adapters/process_probe_psutil.py`,
`bridge/worker.py`'s `run_worker()`) — see the ground-truth section below,
which this revision corrects. `bridge/supervisor.py` and `bridge/__main__.py`
remain unbuilt, and this revision found a **blocking gap upstream of both**:
attempting to build the worker's real-dependency wiring surfaced that
`JournalRepository`'s outbox table (`outbox_messages`, already migrated in
`001_initial.sql`) has a `claim_outbox()` reader but **no acknowledgment,
terminal-failure, or requeue writer, and no dispatcher component that drains
it to Redis at all** — a gap the second and prior revisions of this document
did not name, because nothing had yet tried to wire a real worker process
against it. §11 (new) is the complete design for that missing piece: outbox
message lifecycle, retry policy, crash recovery, idempotency guarantees,
ordering rules, cleanup policy, and failure scenarios. **§11 is design only —
no `bridge/outbox_dispatcher.py` code and no new `JournalRepository` methods
land until this section is reviewed and approved.** Once approved, §11
becomes a build prerequisite for `bridge/worker.py`'s real
`poll_history`/`poll_live` wiring, which is itself a prerequisite for
`bridge/__main__.py`.

A second review pass (2026-07-31, same day) found and closed two further
blockers in §11's first draft — a retry counter that could quarantine a
message for reclaim churn unrelated to it (fixed via a new
`delivery_failure_count` column, §11.1/§11.3), and an ordering-gate
predicate that didn't actually enforce the guarantee it claimed to (fixed
by requiring every sibling be `PUBLISHED`, not merely absent from
`{PENDING, INFLIGHT}`, §11.8) — plus the correctness/operational/
documentation findings C1–C3, O1–O4, I1–I2 from that same review. A third,
confirming pass verified the fixes against the repository directly
(including reading `bridge/journal/migrations.py`, which the second pass's
own self-review had not yet checked) and found no further blockers; see the
verdict at the end of §11.

This revision otherwise carries forward, unchanged, the ten blockers the
second revision closed: Job Object orphan prevention, CTRL_BREAK_EVENT
preconditions under Session 0/NSSM, fail-closed lease-loss and
renewal-watchdog semantics, authoritative post-connect identity checks,
canonical Windows path hardening, durable per-account quarantine with an
unquarantine operation, restart-budget persistence across supervisor
restarts, a versioned atomically-written health file, and a layered exit-code
taxonomy that keeps worker-reported codes, supervisor classifications,
Windows-forced termination results, and restart policy as four distinct,
separately testable things instead of one conflated table.

## Problem

`bridge/` (renamed from `mt5_bridge_native`, replacement for the deleted
`bridge_v2`) has fencing-lease Redis transport, a durable SQLite journal, and
live/history sync logic — but zero concrete implementations wired to a real
MT5 terminal. `RealMt5Port`, `RealProcessProbe`, and account config loading
don't exist. There is no CLI entrypoint at all; `python -m bridge` fails with
`ModuleNotFoundError`. The `bridge` nssm service on forexvps is installed and
paused (crash-looping) for exactly this reason.

## Scope

Full build: real MT5 adapter, real process discovery, per-account config
loading, and the supervisor/worker entrypoint — one native bridge process per
trading account, matching the deleted `bridge_v2`'s process model (the
existing `nssm bridge` service and ops tooling already assume "one service,
one child per account").

## Ground truth: what already exists vs. what this design adds

Already built and tested (`bridge/*.py`, no changes needed):

- `bridge/config.py` — `TerminalProfile` (Pydantic, `extra="forbid"`,
  `frozen=True`), `JournalConfig`, `validate_unique_logins`.
- `bridge/process_probe.py` — `ProcessCandidate`, `ProcessFingerprint`,
  `select_process(profile, candidates) -> ProcessFingerprint`. Pure function;
  takes a list of candidates, does not enumerate processes itself.
- `bridge/terminal_session.py` — `TerminalSession(probe, mt5)`,
  `connect_verified(profile) -> VerifiedSession`, `revalidate(verified)`.
- `bridge/mt5_adapter.py` — `StrictMt5Adapter(mt5)`, classifies every call
  into `CallResult`. Exposes `positions()`, `orders()`,
  `history_deals(start_raw, end_raw)`, `history_orders(start_raw, end_raw)`,
  `account()`, `terminal()`, `version()`.
- `bridge/ownership.py` — `LocalLoginLock(directory)`,
  `.acquire(login, owner_id) -> LocalLock`, raising
  `LocalOwnershipUnavailable` or `StaleLocalLockEvidence`.
- `bridge/redis_transport.py` — `RedisLease(client)`: `.acquire(login,
  owner_id, producer_epoch_id, ttl_ms) -> FenceCredential`, `.renew(credential,
  ttl_ms) -> bool`, `.release(credential)`, `.publish_live_fenced(...)`,
  `.append_stream_fenced(...)`, `.append_live_stream_fenced(...)`. All raise
  `LeaseUnavailable` on any fence mismatch — every write already re-checks
  owner/producer_epoch/coordination_epoch/token inside the same atomic Lua
  script as the mutation (`_fenced`), never as a separate prior check.
- `bridge/journal/connection.py` — `Journal.open(config) -> Journal`,
  `.close()`, ACL/reparse-point checks, WAL/FULL/foreign-keys/busy-timeout
  pragmas.
- `bridge/history.py` — `HistorySynchronizer.run_next_window(session,
  checkpoint)`, `.reconcile(session, window_id)`.
- `bridge/live.py` — `LivePublisher.poll_once(session, fence) -> LiveOutcome`.
  Its `sequences: LiveSequenceStore` dependency (`.reserve(profile_id,
  epoch_id) -> int`) is already satisfied by `JournalRepository.reserve()`
  below — no separate sequence-store implementation is needed.
- `bridge/errors.py` — `FailureClass` enum, `RedactedFailure`.
- `bridge/adapters/mt5_real.py` (`RealMt5Port`, `Mt5Module` protocol for
  injection) — built.
- `bridge/adapters/process_probe_psutil.py` (`RealProcessProbe`) — built.
- `bridge/account_config.py`, `bridge/paths.py` (canonical path handling) —
  built: `load_account_file`, `load_accounts_dir`,
  `find_duplicate_identity_groups`, `find_duplicate_journal_groups`,
  `canonicalize`.
- `bridge/exit_codes.py` — built: the full four-layer taxonomy (§10).
- `bridge/health.py`, `bridge/quarantine.py` — built: `HealthStore`,
  `QuarantineStore`, both atomically-written per §7/§9.
- `bridge/restart_policy.py` — built: `decide()`, `compute_backoff_delay_ms`,
  `apply_stable_runtime_reset`, matching §10's Layer-4 table.
- `bridge/job_object.py` — built: `WindowsJobObject` per §1.
- `bridge/journal/repository.py` — `ack_outbox`, `fail_outbox`,
  `requeue_outbox`, `cleanup_published_outbox`, `has_blocking_sibling`,
  `outbox_quarantine_summary` — built, tested (§11, implemented and
  reviewed 2026-07-31; `claim_outbox`'s query carries the §11.8
  ordering-gate predicate and widened SELECT).
- `bridge/journal/migrations/002_outbox_ack.sql` — built, applied
  automatically (directory-globbed, checksummed, no code change needed).
- `bridge/outbox_dispatcher.py` — `OutboxDispatchThread`,
  `OutboxDispatchConfig` — built, tested. Wired into `bridge/worker.py`'s
  `run_worker()` (optional `outbox_repository`/`outbox_transport`/
  `outbox_config` params, off by default, shares the same `lease_lost`
  Event as `LeaseRenewalThread`).
- `bridge/discovery.py` — `discover_accounts()` — built, tested (new,
  2026-07-31, see §12). Enumerates running portable-mode MT5 terminals via
  an injected `ProcessLister` (satisfied by the already-built
  `RealProcessProbe`), attaches to each with an injected `Mt5ConnectPort`
  (satisfied by the already-built `RealMt5Port`), reads the currently
  logged-in `account_info()`/`terminal_info()`, builds a `TerminalProfile`
  on the fly, detaches. Never opens a new terminal window (only ever
  calls `initialize()` with a path taken from an already-running process).
  Deduplicates by discovered login, not by process, so two terminal
  processes logged into the same account still yield one bridge worker.
- `bridge/account_resolution.py` — `resolve_accounts()` — built, tested
  (new, 2026-07-31, see §12). Merges `discover_accounts()` output with
  optional `bridge/accounts/*.json` overrides (override wins verbatim, is
  never field-merged with a discovered profile), writes each
  non-overridden discovered account to a generated JSON file via the
  existing `atomic_write_json` helper, and loads every account (generated
  or overridden) through the existing, unchanged `load_account_file` — one
  validation/canonicalization implementation regardless of account source.
- `bridge/worker.py` — **partially built**. `run_worker()` implements the
  full §8 startup order, the `LeaseRenewalThread`/watchdog (§3/§4), the
  outbox dispatcher integration above, and the poll loop against
  *injected* `poll_live`/`poll_history` callables and an injected
  `terminal_session`. It has no `if __name__ == "__main__"`, no CLI
  argument parsing, and no code anywhere yet constructs the real
  `poll_live`/`poll_history` callables from `LivePublisher`/
  `HistorySynchronizer` — this is now the sole remaining item blocking a
  real (non-test-fake) worker process.

Not built anywhere yet:

- `bridge/supervisor.py`, `bridge/__main__.py` — this design's original
  subject. Unblocked in principle (every dependency it composes —
  `resolve_accounts()`, `job_object.py`, `restart_policy.py`,
  `quarantine.py`, `health.py`, `exit_codes.py` — now exists and is
  tested), but the composition itself (Job Object lifecycle, CTRL_BREAK
  ladder, restart-loop wiring) has not been written.
- A public `JournalRepository` checkpoint accessor (`_checkpoint` is
  private) and a `safe_end(profile) -> int` boundary provider for
  `HistorySynchronizer` — small, needed for `poll_history`'s real wiring.
- **No longer a blocker (2026-07-31, per explicit direction): manually
  authored `bridge/accounts/*.json` files on the VPS.** Auto-discovery
  (§12) is the default account source; a config file is now an optional
  per-account override, never a deployment prerequisite. The bridge can
  reach a fully populated account list from nothing but running,
  logged-in, portable-mode MT5 terminals on the host.

## Architecture

`bridge/__main__.py` is a supervisor. It resolves the account list via
`bridge/account_resolution.py`'s `resolve_accounts()` (§12, revised
2026-07-31: auto-discovery is the default account source, manually authored
`bridge/accounts/*.json` files are an optional per-account override, not a
deployment requirement — no operator ever has to enumerate accounts by
hand). It then validates every resulting profile and checks for duplicate
identity using canonicalized paths *before spawning anything* (§6), loads
persisted restart-budget and quarantine state from disk (§8) before deciding
what to spawn, creates one Windows Job Object per child with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (§1) as the primary orphan-prevention
mechanism, spawns one child process per resolved account
(`python -m bridge.worker <config-path>`, `CREATE_NEW_PROCESS_GROUP` — the
config path is machinery-generated by `resolve_accounts()` when not
overridden, never an operator-supplied per-account CLI argument), tracks
children, restarts a crashed child per the four-layer exit taxonomy in §10,
and attempts `CTRL_BREAK_EVENT` forwarding with documented preconditions and
a deterministic terminate/kill fallback on shutdown (§2). This mirrors
`bridge_v2/run_all_v2.py`'s supervisor loop, hardened for the failure modes
that loop never had to handle (Job Objects, NSSM/Session 0, persisted
quarantine).

Startup order for both supervisor and worker is fixed (unchanged from prior
revision): config validation → local ownership → journal open/migrate →
Redis lease → verified MT5 connection → publisher loops, with exact
reverse-order cleanup on any step's failure.

## 1. Windows Job Object — primary orphan-prevention mechanism

The prior revision's parent-PID self-check is **demoted to defense in
depth**. It stays in the design (a worker whose parent PID changes still
treats that as a shutdown signal — free, cheap, and catches the case where
the Job Object itself somehow fails to attach), but it is no longer the
mechanism this design relies on to prevent an orphaned worker holding an MT5
connection and a Redis lease indefinitely.

**Primary mechanism:** the supervisor creates one Windows Job Object per
child at spawn time, before or immediately after `CreateProcess` (via
`subprocess.Popen` plus `win32job`/`ctypes` `CreateJobObjectW`,
`AssignProcessToJobObject`), configured with
`JOBOBJECT_EXTENDED_LIMIT_INFORMATION.BasicLimitInformation.LimitFlags =
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. This gives an OS-enforced guarantee that
is independent of Python code running correctly on either side: **when the
supervisor process itself terminates for any reason — crash, forced kill,
BSOD-adjacent host failure that still leaves Windows able to run cleanup —
every handle to every Job Object it created closes, and the OS immediately
terminates every process still assigned to each of those jobs.** This is the
actual answer to "prevent orphan": it does not depend on the child noticing
anything, does not depend on a signal being deliverable (§2 below explains
why CTRL_BREAK delivery itself is not guaranteed under this deployment), and
does not depend on Python's `atexit`/`finally` machinery running during a
hard supervisor crash.

Design requirements:

- One Job Object per child, not one shared Job Object for all children —
  a shared job would mean killing one misbehaving child (via
  `TerminateJobObject`, used by the kill fallback in §2) also kills every
  other account's worker, which is exactly the blast-radius mistake
  `ARCHITECTURE.md` §12 already prohibits at the Redis-restart level.
- The job handle is kept open in the supervisor process for the child's
  entire lifetime; it is only closed (triggering kill-on-close, if the child
  is still assigned) as the last step of that child's supervised lifecycle,
  after the terminate/kill fallback ladder in §2 has already been given its
  chance to let the child exit cleanly.
- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` covers the child and any further
  descendants it might spawn (it does not spawn any today, but a future
  worker that shells out for a diagnostic would still be covered) — this is
  a strictly stronger guarantee than the PID self-check, which only ever
  covered the direct child noticing on its own.
- Failure to create a Job Object at spawn time (e.g. running under an
  environment without the privilege, or on a Windows version/sandbox that
  restricts nested jobs) is a `CONFIG_INVALID`-classified supervisor startup
  failure (§10), not a silent fallback to PID-check-only — this design does
  not consider the parent-PID check an acceptable substitute if the primary
  mechanism can't be established, since it does not want an operator to
  believe orphan-prevention is active when the stronger guarantee silently
  failed to attach. If nested-job restrictions on the target Windows Server
  version turn out to require `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`
  handling for a future descendant process, that is out of scope until a
  descendant process actually exists.

## 2. `CTRL_BREAK_EVENT` — exact requirements, limitations, and fallback

The first two drafts understated how unreliable `CTRL_BREAK_EVENT` delivery
is in this specific deployment. This section states the precondition chain
in full and treats the terminate/kill fallback as the expected common path,
not an edge case.

**Requirements for `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pgid)` to
reach a child at all:**

1. The child must have been created with `CREATE_NEW_PROCESS_GROUP` — this
   design already specifies that.
2. The sending process and the target process group must **share a console**,
   or the target group must itself own a console that the signal can be
   routed to. `GenerateConsoleCtrlEvent` is fundamentally a console-subsystem
   API; a process group with no attached console cannot receive it at all,
   regardless of `CREATE_NEW_PROCESS_GROUP`.
3. **NSSM runs the supervisor as a Windows service, in Session 0.** Session 0
   services have no interactive console by default. Unless NSSM (or the
   supervisor itself) explicitly allocates a console — which this deployment
   does not do, and should not do solely for this purpose, since allocating
   a console for a Session-0 service is itself an unusual and fragile
   pattern — `subprocess.Popen(..., creationflags=CREATE_NEW_PROCESS_GROUP)`
   run from a console-less parent produces a child that **also has no
   console**, and `GenerateConsoleCtrlEvent` targeting its process group
   **fails outright** (`GetLastError() == ERROR_INVALID_HANDLE` in the
   typical case, or the call silently reaches no process).

**Conclusion this design commits to, normatively:** under the NSSM/Session 0
deployment on forexvps, `CTRL_BREAK_EVENT` delivery from supervisor to child
**must be treated as best-effort and commonly unavailable**, not as the
primary shutdown path. The supervisor still attempts it first (it is free,
correct when it does work — e.g. if the supervisor is ever run interactively
for local development on a real console, where this path works exactly as
documented), but shutdown logic is not allowed to assume it succeeded. The
deterministic fallback ladder is the actual contract:

```text
1. attempt os.kill(child.pid, signal.CTRL_BREAK_EVENT) targeting the child's
   own process group; do not check for success (no reliable success signal
   exists from this call in a console-less context) — this is the one
   caveat allowed to move
2. after a FIXED BRIDGE_CTRL_BREAK_WAIT_MS (default 2000, deliberately
   short since delivery is unconfirmed and commonly a no-op under NSSM):
   if the child has not exited, call child.terminate() (TerminateProcess) —
   this is now the expected common path under NSSM, not a rare fallback
3. after BRIDGE_SHUTDOWN_GRACE_MS (default 15000, measured from terminate(),
   not from the original stop request) without exit: child.kill() —
   identical Win32 call to terminate() on this platform but semantically
   the last-resort step
4. after BRIDGE_SHUTDOWN_KILL_GRACE_MS (default 5000) without exit: close
   this child's Job Object handle (§1), which unconditionally ends the
   process via JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE regardless of whatever
   state steps 2-3 left it in
```

Step 4 is new in this revision and is the actual backstop — steps 2 and 3
are `TerminateProcess` calls that can themselves fail against a sufficiently
wedged process (e.g. blocked in an uninterruptible kernel call); the Job
Object close in step 4 does not depend on the target process's own
responsiveness at all, since it is enforced by the OS's job-tracking
machinery outside the target process.

Consequence for worker-side cleanup: because step 1 is commonly a no-op
under this deployment, the worker **cannot rely on ever seeing
`CTRL_BREAK_EVENT`** to perform its own graceful lease-release/journal-close.
The worker's own orphan-and-shutdown detection (§1's demoted PID self-check,
plus the lease-loss watchdog in §4) are the mechanisms that actually cause a
worker to exit 0 cleanly in the common case where `CTRL_BREAK_EVENT` never
arrived at all — a worker terminated by step 2/3/4 above skips its own
cleanup entirely and relies on: (a) the Redis lease's own TTL expiring on
its own within `BRIDGE_LEASE_TTL_MS` even if never explicitly released, and
(b) the local lock file being independently reclaimable — `LocalLoginLock`
already treats existing-but-differently-owned evidence as
`LocalOwnershipUnavailable`, not permanently un-acquirable, so a fresh
supervisor/worker restart is not blocked by a lock left behind by a killed
process as long as the lock's owner_id is recognized as the same host
(`owner_id` embeds a supervisor instance ID, §9 — a future worker started by
a *new* supervisor instance can distinguish "old instance's stale lock" from
"different concurrent instance" and clear the former, which is out of scope
to fully specify here since it only matters after a supervisor crash-and-
restart sequence more elaborate than this design's NSSM-managed single-
instance deployment currently needs).

**nssm → supervisor path**, restated precisely: nssm's configured stop
method (`AppStopMethodSkip`/console/WM_CLOSE/`TerminateProcess`, whichever
this specific forexvps install uses — must be checked against the actual
installed service parameters, not assumed) targets only the supervisor
process. Nothing here changes that; this section only replaces the previous
draft's implicit assumption that CTRL_BREAK forwarding from supervisor to
children reliably works with an explicit statement that it commonly doesn't
under Session 0, and that the fallback ladder plus Job Objects are the real
contract.

## 3. Lease-loss semantics

Normative statement, unchanged in spirit from the second draft but stated as
an explicit invariant rather than left implicit in the renewal-thread
description: **a lost, expired, or mismatched lease causes the account
runtime to stop all MT5 work and enter shutdown immediately — not "stop
publishing, keep polling MT5."** Concretely:

- "Lost" = `RedisLease.renew` returns/raises indicating rejection
  (`LeaseUnavailable`) because owner/producer_epoch/coordination_epoch/token
  no longer match the live Redis lease key.
- "Expired" = the lease's TTL passed without a confirmed successful renewal
  landing before expiry — detected by the watchdog in §4, not only by an
  explicit Redis error.
- "Mismatched" = any fenced write call (`publish_live_fenced`,
  `append_stream_fenced`, `append_live_stream_fenced`) itself returns
  `LeaseUnavailable`, proving the credential the worker was holding is
  already stale even if the renewal thread hadn't yet noticed.

On any of these three, the worker:

1. Sets a single shared `lease_lost` state (a `threading.Event`, checked by
   both the poll loop and the renewal thread so either side can set or
   observe it — first one to detect the loss wins, no double-handling
   needed).
2. Does **not** start or continue any in-flight `TerminalSession.revalidate`,
   `LivePublisher.poll_once`, or `HistorySynchronizer.run_next_window` call
   once `lease_lost` is observed — the poll loop checks this flag as its
   first action each cycle, before touching MT5 at all, not only before a
   Redis write. (History windows already commit to SQLite independent of
   lease state, per the second draft's §5 — that remains true up to the
   point the lease is lost; once lost, no *new* history window is started
   either, since starting one means calling into MT5 for account credentials
   this producer epoch no longer has fenced authority to be reading under.)
3. Exits with the dedicated lease-loss code (§10) — no retry inside the same
   process. A new process, if the supervisor restarts it, goes through full
   startup (§ startup order) and acquires a fresh lease with a fresh
   producer epoch from scratch.

**All Redis mutation paths are fenced with the same lease generation/token**
— this is already true of every method on `RedisLease` (`renew`, `release`,
`publish_live_fenced`, `append_stream_fenced`, `append_live_stream_fenced`
all take a `FenceCredential` and re-verify owner/producer_epoch/
coordination_epoch/token inside the same atomic Lua script as the mutation).
This design adds no new Redis mutation path; the invariant is restated here
because it is the actual safety property lease-loss semantics rest on: it is
structurally impossible for a worker to publish under a credential Redis has
already invalidated, independent of how promptly the worker's own code
notices the loss.

## 4. Renewal-thread failure behavior — bounded fail-closed

The second draft's renewal thread set a flag on `LeaseUnavailable` but did
not say what happens if the thread itself never gets that far — Redis
timeout, an uncaught exception killing the thread silently, the thread
stalling past the TTL without either succeeding or failing cleanly, a race
against the worker's own shutdown, or a Redis response the code can't
classify as clearly owned-or-not. This section makes the failure mode
**self-detecting on the main thread**, so it does not depend on the renewal
thread reliably reporting its own death.

**Watchdog design:** the renewal thread, on every attempt (success or
failure), writes `last_renewal_attempt_at = time.monotonic()` to a shared
value; on success only, it also writes
`last_renewal_success_at = time.monotonic()`. The main poll loop, at the top
of every cycle (the same point it checks `lease_lost`), also checks:

```text
if time.monotonic() - last_renewal_success_at > (ttl_ms / 1000) - BRIDGE_LEASE_WATCHDOG_MARGIN_S:
    treat as lease lost (§3), regardless of lease_lost.is_set()
```

`BRIDGE_LEASE_WATCHDOG_MARGIN_S` (default 2) is the bound this design commits
to: **the runtime fails closed within, at most, `ttl_ms - margin` of the last
confirmed successful renewal — never later — regardless of which specific
failure mode caused the renewal thread to stop making progress.** This
covers every case named in the request without needing a separate code path
per case:

- **Redis timeout on a single renew call** — the thread's next scheduled
  attempt (`BRIDGE_LEASE_RENEW_INTERVAL_MS` later) either succeeds and
  resets the watchdog, or times out again; either way
  `last_renewal_success_at` stops advancing and the watchdog bound applies.
- **Thread death (uncaught exception, interpreter-level crash of just that
  thread)** — `last_renewal_success_at` simply stops advancing forever; the
  watchdog catches it on the same bound as a live thread that's merely
  failing repeatedly. The main loop does not need to detect "is the thread
  still alive" as a separate signal — a dead thread and a thread stuck
  failing look identical from the watchdog's point of view, which is the
  point: one detection mechanism covers both.
- **Delayed renewal (thread alive, scheduling slips)** — same bound; a
  slip that pushes the next success past `ttl - margin` fails closed exactly
  as if the thread had died.
- **Shutdown races** — the renewal thread must check `lease_lost` (and a
  separate `stopping` flag set by the worker's own clean-shutdown path)
  before attempting a renew, so a renewal thread does not race a graceful
  `RedisLease.release()` call by attempting a renew on a credential the main
  thread is simultaneously releasing; if it loses that race anyway
  (`release()` already completed), the resulting `LeaseUnavailable` from a
  stray renew is treated as a no-op, not an error, since the worker is
  already in its own shutdown path at that point and exit code is already
  determined by the shutdown reason, not by this late renewal failure.
- **Unknown lease ownership** (a `renew` call that returns an ambiguous or
  unclassifiable Redis response rather than a clean `RENEWED`/`REJECTED`) —
  `RedisLease.renew`'s existing contract already raises `RedisTransportError`
  for exactly this (invalid script result shape), distinct from
  `LeaseUnavailable`. The renewal thread treats `RedisTransportError` the
  same as a failed-but-not-yet-fatal attempt (does not immediately set
  `lease_lost` — a single malformed response could be transient), but it
  also does not update `last_renewal_success_at`, so if the ambiguity
  persists across the watchdog margin, the bound still fires. This is
  deliberate: the design does not need to correctly classify *why* ownership
  is unknown, only guarantee that unresolved uncertainty converges to
  fail-closed within the same fixed bound as every other failure mode.

## 5. Post-connect authoritative identity validation

Restated as an explicit, standalone normative requirement rather than a step
folded into the connection sequence narrative (as in the second draft's §1),
because it is the specific check the request is asking to see pinned on its
own:

**After `initialize()` succeeds, before the session is considered usable for
any poll, the worker must read `terminal_info()` and `account_info()`
through `StrictMt5Adapter` and treat every one of the following as
independently sufficient to fail:**

```text
terminal_info().path        != profile.executable_path's parent directory
terminal_info().data_path   != profile.expected_data_path
terminal_info().connected   is not True
account_info().login        != profile.expected_login
account_info().server       != profile.expected_server   (exact string, case-sensitive)
```

Any mismatch: call `shutdown()` on the Python MT5 connection only (never on
the terminal process — unchanged non-responsibility from `ARCHITECTURE.md`
§1), then exit with the dedicated identity-violation code (§10) —
`IDENTITY_VIOLATION`, distinct from `PREFLIGHT_IDENTITY` (a mismatch caught
*before* `initialize()` even ran, via `select_process`/`ProcessProbeError`)
and distinct from a later `revalidate()`-detected drift (also
`IDENTITY_VIOLATION`, since both are the same class of problem — "the thing
we're connected to is not the thing the profile describes" — just caught at
different points in the lifecycle). This is exactly what
`TerminalSession.connect_verified`'s existing, already-built
`_verify_api_identity` does — this section exists to make explicit that the
worker must never skip it, never treat a partial identity match as
acceptable, and must map its failure to the identity-violation exit code,
not to a generic fatal code.

## 6. Windows path handling — canonicalization and duplicate detection

The second draft's §7/§10 duplicate-path checks compared raw strings via
`PureWindowsPath(...).casefold()` (matching the existing `_windows_key`
helper in `process_probe.py`). That catches case differences and separator
differences but **not** two paths that are the same file via a junction,
symlink, substituted drive letter, or short (8.3) vs. long filename form —
all real ways two account JSON files could point at "the same" executable or
journal path without string-comparing equal. This section adds a dedicated
`bridge/paths.py` canonicalization step used everywhere §7/§10's duplicate
checks run.

`canonical_path(raw: str) -> CanonicalPath`:

1. Parse as `PureWindowsPath`; reject if not absolute (existing check,
   unchanged).
2. **Filename validation**: reject any path containing a reserved Windows
   device name component (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`),
   trailing dot/space on any component, or any of the characters Windows
   forbids in filenames (`< > : " | ? *` outside the drive-letter colon) —
   these are almost always a copy-paste or templating error in an account
   JSON, not a real path, and should fail loudly at load time rather than
   fail confusingly later at `os.path` call time.
3. **Existence check**: `Path(raw).exists()` — for `executable_path`, must
   exist and be a file; for `expected_data_path`, must exist and be a
   directory; for `JournalConfig.path`'s parent directory, must exist (the
   journal file itself may not exist yet — `Journal.open` creates it, per
   `ARCHITECTURE.md` §8's "Missing" recovery case). A missing required path
   is a `CONFIG_INVALID` loader failure, not a runtime surprise at
   `initialize()` time.
4. **Junction/symlink resolution**: call
   `GetFinalPathNameByHandleW(FILE_FLAG_BACKUP_SEMANTICS)` (via `ctypes`,
   same FFI pattern already used in `bridge/journal/connection.py`'s
   `_NativeWindowsSecurity` for ACL checks — reuse that pattern rather than
   introducing a second Win32-FFI style) on the resolved path to obtain the
   OS's canonical `\\?\`-prefixed final path, which resolves junctions,
   symlinks, and substituted drives to their real target. This is "where
   possible" per the request's own phrasing: `GetFinalPathNameByHandleW`
   requires being able to open a handle to the path, which can fail under
   restrictive ACLs even when the path is otherwise valid — in that case the
   loader falls back to the non-resolved, casefolded `PureWindowsPath` form
   and records `path_resolution: "unresolved-acl-restricted"` in the loaded
   profile's diagnostics (not a hard failure, since `ARCHITECTURE.md` §14
   already expects some paths to be ACL-restricted to the service identity
   by design — the loader itself may not always have read access to resolve
   every path it's validating the *shape* of).
5. **Case-insensitive comparison**: the canonical form is compared via
   `.casefold()` — unchanged from the existing `_windows_key` behavior, now
   applied to the *resolved* path from step 4 rather than the raw configured
   string.

**Duplicate detection using canonical paths**: the pre-spawn checks in the
prior revision's §7/§10 (duplicate `(login, server, domain)` triple,
duplicate journal path across two account files) are restated to operate on
`canonical_path(...)` output, not on raw JSON string values — two account
files whose `executable_path` differ only by a junction indirection, a
mapped drive letter, or an 8.3-vs-long filename now correctly collide as
"the same path" instead of silently passing the duplicate check.

## 7. Durable per-account quarantine and unquarantine

The second draft left quarantine as in-memory supervisor state — a
supervisor restart silently cleared it, which both drops the safety property
quarantine exists for and, worse, gives an operator no real way to
distinguish "I fixed the problem" from "the supervisor happened to restart."
This revision makes quarantine **durable, file-backed, and independently
clearable**, with restarting the whole supervisor explicitly **not** the
intended recovery path.

`bridge/quarantine.py` (new):

- One file per account: `<BRIDGE_STATE_DIR>/quarantine/<profile_id>.json`
  (`BRIDGE_STATE_DIR`, default `bridge/state`, new env var — kept separate
  from `bridge/accounts/` so quarantine state is never mistaken for account
  config by the directory-scan step, and separate from the SQLite journal
  directory so quarantine survives independently of journal recovery
  scenarios in `ARCHITECTURE.md` §8).
- Written atomically: build the JSON in memory, write to
  `<path>.tmp-<random suffix>`, `fsync`, then `os.replace(tmp, final)` — an
  atomic rename on the same filesystem, so a crash mid-write never leaves a
  torn quarantine file (same pattern required for the health file in §9;
  `bridge/paths.py` exposes one shared `atomic_write_json` helper used by
  both, rather than two independent implementations).
- Schema:
  ```text
  {
    "schema_version": 1,
    "profile_id": "sha256...",
    "login": 123,
    "quarantined_at_utc": "RFC3339",
    "quarantine_reason": one of the FailureClass values, or "config_invalid" / "journal_failure",
    "triggering_exit_code": int,
    "restart_count_at_quarantine": int,
    "cleared_at_utc": "RFC3339" | null,
    "cleared_by": string | null       // operator identifier, free text, redacted-safe
  }
  ```
- **Supervisor startup** loads every file in the quarantine directory before
  deciding what to spawn (part of the startup sequence, before step 1's
  config validation completes — a quarantined account is never even fully
  validated against the live process/Redis, since quarantine's whole point
  is "don't touch this account's runtime until an operator says so").
- A quarantine file with `cleared_at_utc` set is treated as **not currently
  quarantined** — the supervisor may spawn that account normally on next
  startup or on the next scan cycle, without deleting the historical record;
  `restart_count`/backoff state for that account (§8) still starts fresh
  from the clear point, not from wherever it was before quarantine.
- **Unquarantine operation**: a new CLI command,
  `python -m bridge unquarantine <login-or-profile-id> --operator <name>`.
  This is a design-level commitment, not an implementation detail deferred
  to "later" — the request is explicit that restarting the whole supervisor
  must not be the intended recovery, so the CLI command is part of this
  design's contract even though the CLI itself (`bridge/cli.py`) is
  unbuilt. The command: loads the matching quarantine file, sets
  `cleared_at_utc`/`cleared_by` via the same atomic-write helper, and exits
  — it does not itself talk to the running supervisor process (no IPC
  between the CLI and a live supervisor is part of this design; the
  supervisor picks up the change on its next quarantine-directory scan,
  cadence `BRIDGE_QUARANTINE_RESCAN_MS`, default 30000, so a cleared
  quarantine takes effect within that bound without requiring a supervisor
  restart).
- Quarantine set by the supervisor at runtime (not via the CLI) always goes
  through the same atomic-write path, keyed by the account's `profile_id` —
  never mutated in place, never appended-to as a log; each quarantine event
  overwrites the file with the current state, and history of *why* is
  covered by the structured logs (`ARCHITECTURE.md` §13), not by this file.

## 8. Restart-budget and quarantine persistence across supervisor restart

Directly answering the request's question: **yes, both restart budgets and
quarantine state persist across a supervisor/NSSM restart, by design, and
this is the specific property that prevents "restart the service" from being
a de facto quarantine bypass.**

- Quarantine persistence is covered by §7 — file-backed, loaded at
  supervisor startup, independent of process lifetime.
- **Restart-budget persistence**: the per-account counters this design's
  restart policy depends on (`restart_count`, `restart_count_window_start`,
  the stable-runtime-reset tracking) are written to the **same account
  health file** described in §9, not to a separate file — there is exactly
  one durable per-account state file, and it carries both the operational
  health snapshot and the restart-accounting fields together, since they
  update on the same events (a child exiting) and reading them separately
  would risk the two going out of sync. The supervisor loads each account's
  last-known `restart_count`/`restart_count_window_start` from that file at
  startup and resumes counting from there — a supervisor restart does not
  reset an account that was three restarts into its backoff window back to
  zero. This is the mechanism that makes stable-runtime reset (second
  draft's §3, unchanged: `BRIDGE_RESTART_STABLE_MS` of continuous uptime
  resets the counter) the *only* sanctioned way a restart counter goes back
  to zero — a supervisor bounce is explicitly not an equivalent path.
- Consequence stated normatively: an operator who wants to "just restart the
  service" to clear a problem account will find that account still
  quarantined (§7) or still deep in backoff (this section) immediately after
  the restart, exactly as before — by design. The only two sanctioned ways
  to change an account's restart/quarantine state are (a) the account itself
  running stably past `BRIDGE_RESTART_STABLE_MS`, or (b) the explicit
  `unquarantine` CLI operation in §7. This is the concrete fix for "restart
  bypasses quarantine trivially," which the prior design left open.

## 9. Health file — versioned schema, atomic write

`bridge/health.py`, backed by one file per account plus one supervisor-level
file, all under `BRIDGE_STATE_DIR` (§7), all written through the same
`atomic_write_json` helper (build in memory → temp file → `fsync` →
`os.replace`) — no partial-write ever observable by a reader, including the
HTTP health endpoint (`BRIDGE_HEALTH_PORT`, unchanged from the second draft)
reading the file to serve a request concurrently with the supervisor writing
it.

**`<BRIDGE_STATE_DIR>/health/supervisor.json`**:

```text
{
  "schema_version": 1,
  "supervisor_instance_id": "uuid, generated fresh at every supervisor process start",
  "started_at_utc": "RFC3339",
  "updated_at_utc": "RFC3339",
  "accounts": ["<profile_id>", ...]     // pointer list; per-account detail lives in its own file
}
```

**`<BRIDGE_STATE_DIR>/health/<profile_id>.json`**:

```text
{
  "schema_version": 1,
  "profile_id": "sha256...",
  "login": 123,
  "supervisor_instance_id": "uuid — which supervisor process last wrote this file",
  "state": "starting" | "running" | "standby_duplicate" | "quarantined" | "stopped",
  "state_generation": int,          // increments on every state transition; a fencing
                                     // token for readers to detect a stale cached copy,
                                     // NOT the same value as the Redis lease's
                                     // fencing_token (that one is Redis-scoped and
                                     // per-producer-epoch; this one is local-file-scoped
                                     // and increments across every transition this
                                     // account has ever had, including pre-lease ones
                                     // like config validation failures)
  "last_transition_reason": one of the FailureClass values, or "clean_shutdown" / "operator_unquarantine" / "startup",
  "last_transition_at_utc": "RFC3339",
  "restart_count": int,
  "restart_count_window_start_utc": "RFC3339",
  "last_successful_live_poll_utc": "RFC3339 | null",
  "last_successful_history_window_utc": "RFC3339 | null",
  "current_lease_fence": {"coordination_epoch": str, "fencing_token": int} | null,
  "quarantine": {                    // null when not quarantined; mirrors quarantine.py's
                                       // file but denormalized here so a single health
                                       // read gives the full operational picture
    "quarantined_at_utc": "RFC3339",
    "quarantine_reason": string,
    "cleared_at_utc": "RFC3339 | null"
  } | null,
  "outbox_quarantined_count": int,             // NEW — §11.8 (O2). COUNT(*) of this
                                                 // account's outbox_messages WHERE
                                                 // state='QUARANTINED'; 0 when healthy.
  "oldest_outbox_quarantined_at_utc": "RFC3339 | null"  // NEW — §11.8 (O2). MIN(quarantined_at_utc)
                                                 // over the same set; null iff the count above is 0.
                                                 // Both fields are rebuildable at any time from
                                                 // outbox_messages directly — like every other
                                                 // field in this record, this is a cached snapshot,
                                                 // not the fields' source of truth.
}
```

`state_generation` is the field that directly answers "account state
generation/fencing token" from the request — it is a monotonically
increasing local counter, incremented by whichever process (supervisor or
worker) performs the write, read-modify-write guarded by the same file lock
implied by atomic replace (a writer always reads the current file, computes
`generation + 1`, and writes; two racing writers converge to whichever
`os.replace` lands last, which is acceptable here since this field is a
diagnostic/ordering aid for external readers, not a correctness-load-bearing
fencing token the way the Redis `fencing_token` is — that distinction is
called out explicitly in the schema comment above so a future reader doesn't
conflate the two).

## 10. Layered exit-code and classification taxonomy

The second draft's single exit-code table conflated four genuinely different
things. This revision separates them into four explicit layers so every
outcome is deterministic and independently testable:

**Layer 1 — worker self-reported exit codes** (what the worker process
itself calls `sys.exit(N)` with, only reachable when the worker's own Python
code is still running to choose it):

```text
0   CLEAN_SHUTDOWN         graceful stop (rare CTRL_BREAK success, or PID-orphan
                           self-check, or lease-loss-triggered self-stop after
                           finishing an already-in-flight non-Redis step)
10  CONFIG_INVALID         profile/journal config or §6/§7 loader invariant failed
11  DUPLICATE_OWNERSHIP    local lock or Redis lease held by another owner (standby)
12  IDENTITY_VIOLATION     TerminalIdentityViolation at connect or revalidate (§5)
13  LEASE_LOST             lease lost/expired/mismatched (§3/§4) — distinct name
                           from the second draft's "LEASE_FAILURE" to make clear
                           this is the fail-closed path succeeding, not a bug
14  MT5_IPC_FAILURE        StrictMt5Adapter surfaced FAILED past retry budget
15  JOURNAL_FAILURE        Journal.open failed, or JOURNAL_LOCKED/CORRUPT/INCOMPATIBLE
20  UNEXPECTED_FATAL       uncaught exception outside the above — always a bug to fix
```

**Layer 2 — Windows-forced termination results** (what the supervisor
observes when *it* ended the child via §2's fallback ladder, rather than the
child choosing its own exit — the worker's own code never runs a `sys.exit`
in these cases, so there is no Layer-1 code to read at all):

```text
FORCED_TERMINATE   supervisor's terminate() (step 2/3 of §2's ladder) ended the child;
                   Windows reports an OS-level exit code that is not one of the
                   Layer-1 values (typically 1, or STATUS_CONTROL_C_EXIT-shaped) —
                   the supervisor does not attempt to reinterpret that raw OS code
                   as a Layer-1 value, it records FORCED_TERMINATE as the
                   classification and the raw OS code as a diagnostic field only
FORCED_JOB_KILL    the child never exited even after terminate()/kill(); the
                   supervisor's Job Object close (§1 step 4) ended it — no exit
                   code is observable at all in this case (the process is gone,
                   not exited-with-a-code, from the OS's point of view for a
                   job-object kill reached via handle close rather than
                   TerminateProcess with an explicit code) — recorded as
                   FORCED_JOB_KILL with no OS exit code field populated
```

**Layer 3 — supervisor classification** (the value actually written to
`last_transition_reason` in the health file, §9, and to `quarantine_reason`,
§7): every Layer-1 code maps to exactly one classification of the same name
(`CLEAN_SHUTDOWN` → `clean_shutdown`, etc.); both Layer-2 outcomes map to a
single additional classification, `forced_termination` — the supervisor does
not attempt to guess which Layer-1 reason a forcibly-terminated child
"would have" reported, since it structurally cannot know (the child never
got to choose). `forced_termination` is restart-policy-mapped identically to
`UNEXPECTED_FATAL` (Layer 4 below) — an unresponsive child is treated with
the same suspicion as an unhandled crash, exponential backoff, alert on
first occurrence, no automatic quarantine below the same restart-count
ceiling `UNEXPECTED_FATAL` uses.

**Layer 4 — restart-policy mapping** (keyed by Layer-3 classification, the
actual decision table):

| Layer-3 classification | Policy |
|---|---|
| `clean_shutdown` | do not restart; remove from active set |
| `config_invalid` | quarantine on first occurrence (§7); no restart |
| `duplicate_ownership` | restart with fixed `BRIDGE_DUPLICATE_RETRY_MS` delay (default 60000) — not backoff, expected steady state |
| `identity_violation` | exponential backoff; quarantine after `BRIDGE_IDENTITY_VIOLATION_MAX_RESTARTS` (default 3) within `BRIDGE_RESTART_WINDOW_MS` (default 600000) |
| `lease_lost` | exponential backoff — this is the fail-closed path working correctly, so it is not alerted at first occurrence the way `unexpected_fatal` is, but repeated rapid lease loss for one account still counts toward the same restart-count ceiling as any other backoff-eligible class, since persistent lease loss is itself worth surfacing eventually |
| `mt5_ipc_failure` | exponential backoff |
| `journal_failure` | quarantine on first occurrence (§7); no restart |
| `unexpected_fatal` | exponential backoff; alert at first occurrence |
| `forced_termination` | exponential backoff; alert at first occurrence (same as `unexpected_fatal`) |

Exponential backoff math (base delay, doubling, cap, jitter,
`BRIDGE_RESTART_STABLE_MS` reset) is unchanged from the second draft and not
repeated here — this section replaces only the table structure and the
Layer-1/2/3 separation, not the arithmetic.

## 11. Outbox dispatch and acknowledgment (new)

### 11.0 Why this exists

`HistorySynchronizer.commit_window` (already built, `bridge/history.py`)
writes one row per deal/order record plus one `history.window` summary row
into `outbox_messages` (schema already migrated,
`bridge/journal/migrations/001_initial.sql`) inside the same SQLite
transaction as the durable history data. That part is correct and needs no
change. What doesn't exist anywhere is the component that reads those rows
back out and actually publishes them to the Redis stream
(`mt5n:v1:stream:history:{login}`, via `RedisLease.append_stream_fenced`,
already built) — `JournalRepository.claim_outbox()` marks a batch
`INFLIGHT` but there is no code path that ever marks one `PUBLISHED`,
`QUARANTINED`, or requeues it. A worker built without this dispatcher would
look healthy (MT5 polls succeed, SQLite commits succeed) while silently
publishing zero history events to Redis — worse than a crash, since nothing
signals the failure.

### 11.1 Existing schema, plus one migration this revision requires

```sql
-- 001_initial.sql (already migrated, unchanged):
CREATE TABLE outbox_messages (
  event_id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL REFERENCES history_windows(window_id),
  profile_id TEXT NOT NULL REFERENCES producer_profiles(profile_id),
  stream_key TEXT NOT NULL,
  envelope_json BLOB NOT NULL,
  payload_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PENDING','INFLIGHT','PUBLISHED','QUARANTINED')),
  attempt_count INTEGER NOT NULL,
  next_attempt_at_utc TEXT NOT NULL,
  claimed_by TEXT,
  claim_expires_at_utc TEXT,
  published_at_utc TEXT,
  redis_entry_id TEXT,
  last_error_class TEXT,
  last_error_redacted TEXT
);
CREATE INDEX outbox_claimable_idx
  ON outbox_messages(state, next_attempt_at_utc, claim_expires_at_utc);
```

The first review pass of this document claimed the existing columns were
sufficient. They are not, for one reason (§11.3's retry-counting fix) that
review found: **`attempt_count` is incremented unconditionally by every
`claim_outbox` call**, including reclaims caused by a dispatcher crash or a
lost lease, neither of which is evidence the *message* is bad. A quarantine
threshold read from `attempt_count` alone therefore punishes messages for
operational churn that has nothing to do with them. Fixing this requires a
counter that only increments on an actual failed delivery attempt —
`attempt_count` cannot be redefined in place without breaking
`claim_outbox`'s existing, already-tested reclaim semantics, so this
revision adds a new column instead of repurposing the old one. A second new
column (`quarantined_at_utc`) and two new indexes are needed for the
ordering gate (§11.8) and cleanup (§11.9). **This revision therefore
requires one migration**, correcting the first draft's "no migration"
claim:

```sql
-- 002_outbox_ack.sql (new, this revision):
ALTER TABLE outbox_messages
  ADD COLUMN delivery_failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox_messages
  ADD COLUMN quarantined_at_utc TEXT;

CREATE INDEX outbox_window_siblings_idx
  ON outbox_messages(window_id, state);
CREATE INDEX outbox_published_cleanup_idx
  ON outbox_messages(state, published_at_utc);
```

**Verified against `bridge/journal/migrations.py` (review pass 2), not
assumed:** `_default_migrations()` discovers migration files by globbing
`bridge/journal/migrations/[0-9][0-9][0-9]_*.sql` and SHA256-checksums each
file's contents into a `schema_migrations(version, checksum, applied_at_utc)`
table, applied inside `BEGIN EXCLUSIVE` by `apply_migrations`. Adding
`002_outbox_ack.sql` requires **no code change** — the loader is
directory-driven, not a hardcoded list — and `verify_migrations` will reject
any journal whose applied checksums don't match this file's exact contents,
so the SQL above must be finalized before implementation and not edited
afterward without a fresh `003_*.sql` (the same rule every future migration
to this table already follows, unchanged by this design).

`attempt_count` is left as-is and keeps its existing meaning exactly:
"how many times `claim_outbox` has flipped this row to `INFLIGHT`,"
useful for diagnosing claim/reclaim churn but **never again used as the
quarantine threshold** (§11.3). `delivery_failure_count` is the new,
narrower counter: it increments only inside `fail_outbox`, only when a real
publish attempt to Redis was made and failed — never by `claim_outbox`,
never by a lease-loss reclaim. `quarantined_at_utc` is stamped only by
`fail_outbox`'s quarantine path and cleared (`NULL`) by `requeue_outbox`,
mirroring `bridge/quarantine.py`'s `QuarantineRecord.quarantined_at_utc`
field at the account level — same naming, same purpose, message-scoped
instead of account-scoped.

`claim_outbox(claimed_by, *, limit, now_utc, lease_seconds)` already exists
and already implements the crash-recovery half of the lifecycle correctly
(see §11.6): it selects rows that are `PENDING` and due, **or** `INFLIGHT`
with an expired `claim_expires_at_utc`, and atomically flips them to
`INFLIGHT` with a fresh `claimed_by`/`claim_expires_at_utc`/incremented
`attempt_count`, inside a single `BEGIN IMMEDIATE` transaction. Its *query*
still changes in this revision: §11.8 adds a sibling-state predicate for the
ordering gate, and its SELECT widens to fetch `window_id`/`envelope_json`
alongside `event_id` (§11.8, C2). So the diff against the current
`bridge/journal/repository.py` is: three new methods (§11.3), one modified
query in an existing method (`claim_outbox`), and one migration — not three
new methods against an untouched schema and an untouched query.

### 11.2 State lifecycle

```text
              commit_window() / commit_reconciliation()
                          │  (already built)
                          ▼
                      ┌─────────┐
           ┌─────────▶│ PENDING │◀────────────────────────┐
           │          └────┬────┘                          │
           │               │ claim_outbox()                │ fail_outbox(),
           │               │ (already built,                │ retryable=true,
           │               │  query modified §11.8)          │ delivery_failure_count
           │               ▼                                │ < max (new)
           │          ┌──────────┐  claim_expires_at_utc     │
           │  ┌───────│ INFLIGHT │──passes, unacked ─────────┘
           │  │       └───┬──┬───┘  (reclaimed by next
           │  │           │  │       claim_outbox() call —
           │  │           │  │       same mechanism, no new
           │  │           │  │       code needed; does NOT
           │  │           │  │       touch delivery_failure_count)
           │  │  ack_outbox()  fail_outbox(), retryable=false
           │  │  (new)         OR delivery_failure_count >= max (new)
           │  │           │              │
           │  │           ▼              ▼
           │  │      ┌───────────┐  ┌─────────────┐
           │  │      │ PUBLISHED │  │ QUARANTINED │
           │  │      └───────────┘  └──────┬──────┘
           │  │        (terminal,            │ requeue_outbox()
           │  │         eligible for          │ (new, operator-driven,
           │  │         cleanup §11.9)        │  clears quarantined_at_utc)
           │  └───────────────────────────────┘
           │
           └── (same fail_outbox() arrow as above — both the
               delivery_failure_count-exhausted path and the
               non-retryable-on-first-occurrence path leave INFLIGHT
               for QUARANTINED; there is no third arrow, only two
               conditions on one transition)
```

Four states, matching the existing `CHECK` constraint exactly — no new state
is added:

- **PENDING** — durable, not yet claimed, or requeued after a transient
  delivery failure or an operator's `requeue_outbox`. `next_attempt_at_utc`
  gates when it becomes claimable again.
- **INFLIGHT** — claimed by one dispatcher instance (`claimed_by` = the same
  `owner_id`/`producer_epoch_id`-derived string the worker already uses
  elsewhere), with a lease (`claim_expires_at_utc`) exactly analogous to the
  Redis fencing lease's TTL — this is the mechanism, not a new one, that
  makes crash recovery automatic (§11.6). A row can re-enter `INFLIGHT` from
  `INFLIGHT` itself (self-loop in the diagram) purely through the
  lease-expiry reclaim path, with no state-column change and no
  `delivery_failure_count` change — only `attempt_count`,
  `claimed_by`, and `claim_expires_at_utc` move.
- **PUBLISHED** — terminal-success. `published_at_utc` and `redis_entry_id`
  set. Never transitions again except cleanup deletion (§11.9).
- **QUARANTINED** — terminal-failure: `delivery_failure_count` reached
  `BRIDGE_OUTBOX_MAX_ATTEMPTS`, or a single non-retryable error class was
  observed (§11.4). `last_error_class`/`last_error_redacted`/
  `quarantined_at_utc` set. Only leaves this state via the explicit
  `requeue_outbox` operator operation (§11.3), mirroring
  `bridge/quarantine.py`'s account-level unquarantine philosophy: **a
  supervisor or worker restart must never silently clear a quarantined
  message** — restart-bypass-of-quarantine is exactly the failure mode §8
  already forbids at the account level, and message-level quarantine
  inherits the same rule.

### 11.3 New `JournalRepository` methods (design only — not implemented)

`OutboxStateConflict` (exception), `OutboxFailOutcome` (enum:
`REQUEUED`/`QUARANTINED`), and `OutboxBackoffConfig` (dataclass — same
shape as `bridge/restart_policy.py`'s `BackoffConfig`, §11.4) live in
`bridge/journal/repository.py` itself, alongside the existing `Checkpoint`/
`HistoryWindow`/`OutboxMessage` dataclasses that module already defines —
no new module, consistent with how every other repository-adjacent type is
already organized in that file.

```text
ack_outbox(event_id: str, *, redis_entry_id: str, now_utc: str) -> None
    UPDATE outbox_messages SET state='PUBLISHED', published_at_utc=?,
    redis_entry_id=? WHERE event_id=? AND state='INFLIGHT'
    Raises OutboxStateConflict if 0 rows matched (already PUBLISHED by a
    racing dispatch, or reclaimed out from under this caller after its
    claim lease silently expired mid-call — see §11.5) — the caller must
    not treat a conflict here as an error worth retrying or crashing over;
    it means someone else already resolved this message. Does not touch
    delivery_failure_count — a successful ack has nothing to record there.

fail_outbox(event_id: str, *, error_class: str, error_redacted: str,
            retryable: bool, now_utc: str, backoff_config: OutboxBackoffConfig
            ) -> OutboxFailOutcome
    Single statement, same WHERE state='INFLIGHT' AND event_id=? guard as
    ack_outbox. UNLIKE the first draft of this section, this method OWNS
    incrementing the counter its threshold check reads:
      UPDATE outbox_messages SET
        delivery_failure_count = delivery_failure_count + 1,
        last_error_class = ?, last_error_redacted = ?,
        state = CASE WHEN ? /* retryable */
                       AND delivery_failure_count + 1 < ? /* max_attempts */
                     THEN 'PENDING' ELSE 'QUARANTINED' END,
        next_attempt_at_utc = CASE WHEN state='PENDING' THEN ? ELSE next_attempt_at_utc END,
        quarantined_at_utc = CASE WHEN state='QUARANTINED' THEN ? ELSE NULL END
      WHERE event_id = ? AND state = 'INFLIGHT'
    (illustrative SQL — the CASE-on-its-own-post-update-value shape above
    is not valid SQLite syntax as literally written; the real
    implementation reads the pre-update delivery_failure_count in the same
    statement's WHERE-guarded read or via RETURNING, computes the outcome
    in Python, then issues one UPDATE with concrete values — the point
    this pseudocode makes is which COLUMN is authoritative, not the exact
    SQL dialect, which is an implementation detail, not a design decision.)

    This is the fix for review finding B1: `claim_outbox` increments
    `attempt_count` on EVERY claim — including reclaims from a dispatcher
    crash (§11.6 scenario 2) or a lost lease (§11.5), neither of which is
    evidence the message itself is bad. `delivery_failure_count` is
    incremented ONLY here, ONLY when a real publish attempt to Redis was
    actually made and actually failed. `attempt_count` is left for
    diagnostics (claim/reclaim churn) and is never read by the threshold
    check below.
    Rule, in terms of the count AFTER this call's own increment:
      if retryable and delivery_failure_count < backoff_config.max_attempts:
          state='PENDING', next_attempt_at_utc = now + backoff(delivery_failure_count)
      else (not retryable, OR delivery_failure_count >= max_attempts):
          state='QUARANTINED', quarantined_at_utc = now
    Concrete arithmetic, unambiguous: with BRIDGE_OUTBOX_MAX_ATTEMPTS=8, a
    message whose delivery_failure_count was 7 entering this call becomes 8
    on this call's own increment; 8 is not `< 8`, so this — the 8th actual
    delivery failure — is what quarantines it, never the 9th (there is no
    9th, since it's no longer claimable once QUARANTINED). This threshold
    is now defined purely in terms of genuine delivery failures — a message
    reclaimed ten times by crashing dispatchers, never once actually
    attempted against Redis, has delivery_failure_count=0 throughout and is
    nowhere near quarantine, exactly as it should be.

requeue_outbox(event_id: str, *, operator: str, now_utc: str) -> None
    UPDATE outbox_messages SET state='PENDING', next_attempt_at_utc=?,
    quarantined_at_utc=NULL WHERE event_id=? AND state='QUARANTINED'
    Raises LookupError if the row isn't currently QUARANTINED — same
    "clearing something that was never quarantined is a loud no-op" rule
    bridge/quarantine.py already uses. delivery_failure_count,
    attempt_count, and last_error_class/last_error_redacted are left
    untouched — they remain the audit trail of why it was quarantined; a
    subsequent fail_outbox call overwrites them on the next real failure,
    not this one. quarantined_at_utc is cleared to NULL specifically
    because §11.9's cleanup and §11.8's ordering gate must both be able to
    tell "currently quarantined" from "was quarantined once, long ago,
    then requeued and later succeeded" without re-deriving it from state
    alone (state='PENDING' already implies "not quarantined," but a NULL
    quarantined_at_utc makes that explicit and queryable without a join).
```

`ack_outbox` and `requeue_outbox` follow the pattern already used
everywhere else in `journal/repository.py`: one guarded `UPDATE ... WHERE
state = <expected>` statement, no read before the write at all.
`fail_outbox` is the one exception — computing its `PENDING`-vs-`QUARANTINED`
outcome needs to read `delivery_failure_count` before deciding what to
write, so it is a read-then-write, not a single blind `UPDATE`. This is
still race-free, but for a different reason than the other two: it must run
inside the same `BEGIN IMMEDIATE` transaction `claim_outbox`'s call site
already establishes for this connection (the same requirement C1 imposes on
§11.8's sibling check) — SQLite's single-writer lock, not a
`WHERE`-clause guard, is what prevents a second writer's read or write from
interleaving between `fail_outbox`'s read and its own `UPDATE`. All three
methods still guard their `UPDATE` with `WHERE event_id = ? AND state =
'INFLIGHT'`, so a losing writer's `UPDATE` affects 0 rows rather than
corrupting state — that guard is universal across all three; only the
"no read at all" property is specific to `ack_outbox`/`requeue_outbox`.

### 11.4 Retry policy

Reuses `bridge/restart_policy.py`'s exact backoff shape
(`compute_backoff_delay_ms`) rather than inventing a second algorithm — same
base/double/cap/jitter arithmetic, new env-var family so message-level
tuning is independent of account-restart tuning:

```text
BRIDGE_OUTBOX_RETRY_BASE_MS       default 1000
BRIDGE_OUTBOX_RETRY_MAX_MS        default 60000    (capped lower than restart
                                                     backoff's 300000 — a
                                                     stuck message should not
                                                     wait 5 minutes between
                                                     retries while the worker
                                                     is otherwise healthy)
BRIDGE_OUTBOX_MAX_ATTEMPTS        default 8         (quarantine threshold)
BRIDGE_OUTBOX_CLAIM_LEASE_S       default 30         (claim_outbox's
                                                       lease_seconds — must be
                                                       comfortably longer than
                                                       one dispatch attempt's
                                                       worst-case Redis RTT,
                                                       comfortably shorter
                                                       than BRIDGE_OUTBOX_
                                                       RETRY_MAX_MS so a truly
                                                       dead dispatcher's claim
                                                       expires before the next
                                                       scheduled retry would
                                                       have fired anyway)
BRIDGE_OUTBOX_DISPATCH_BATCH_SIZE default 50
BRIDGE_OUTBOX_DISPATCH_INTERVAL_MS default 2000      (poll cadence when no
                                                       LISTEN/NOTIFY-equivalent
                                                       exists in SQLite; a
                                                       plain claim-and-sleep
                                                       loop, same shape as the
                                                       existing live/history
                                                       poll loops)
```

Error-class routing (`retryable` in `fail_outbox`'s signature, §11.3):

| Exception during dispatch attempt | `retryable` | Rationale |
|---|---|---|
| `RedisTransportError` (transient IO/timeout/unclassifiable response) | `true` | Same class the renewal thread already treats as transient (§4) — a single bad round-trip is not evidence the message itself is bad. |
| `LeaseUnavailable` | **n/a — not a per-message failure at all** | See §11.5: this is a whole-worker signal, never routed through `fail_outbox`. |
| Any other exception (envelope serialization, unexpected type, Redis rejecting the payload shape) | `false` | The envelope was already built and canonical-JSON-validated once at `commit_window` time (`bridge/history.py`'s `_build_pending`/`_records`); a dispatch-time failure of this shape means the payload itself is malformed in a way retrying will never fix — same "this will never fix itself" philosophy `exit_codes.py`'s `CONFIG_INVALID`/`JOURNAL_FAILURE` already use for immediate quarantine over backoff. |

### 11.5 Interaction with lease loss — outbox dispatch is not a fourth independent failure domain

The worker already has one fail-closed lease-loss mechanism (§3/§4): a lost,
expired, or mismatched lease stops all MT5 work and exits the process. The
outbox dispatcher must plug into that exact mechanism, not invent a second
one:

- `RedisLease.append_stream_fenced` raising `LeaseUnavailable` means the
  credential the dispatcher is holding is already stale — structurally the
  same signal the poll loop's `lease_lost`/watchdog check already handles.
  On `LeaseUnavailable`, the dispatcher thread sets the same shared
  `lease_lost` `threading.Event` the `LeaseRenewalThread` sets (§4's "first
  one to detect the loss wins" pattern extends naturally to a third
  thread), and **does not call `fail_outbox`** — the in-flight message is
  left exactly as `claim_outbox` left it. It becomes reclaimable once its
  `claim_expires_at_utc` passes, by whichever worker/epoch acquires the
  lease next. Treating a fence rejection as "this message failed" would be
  wrong: the message didn't fail, the credential did. Because
  `fail_outbox` is the only method that touches `delivery_failure_count`
  (§11.3, the fix for review finding B1), and lease loss never calls it,
  this is now a **true** statement, not merely an intended one: a fresh
  producer epoch really is guaranteed a clean `delivery_failure_count`
  reading for any message it reclaims after a lease-loss cycle, because
  nothing on that path was ever able to increment it. `attempt_count`
  (the pre-existing, unrelated claim counter) does still increase on
  reclaim, exactly as it always did — that column was never the quarantine
  signal to begin with, once §11.3's fix is applied, so its continued
  growth here is expected and harmless.
- The dispatch thread, like the renewal thread, checks `lease_lost` (and a
  `stopping` flag on clean shutdown) as the first action of every loop
  iteration, before claiming a new batch — no new claim is issued once loss
  is observed.
- Consequence: outbox backlog growth during a Redis outage is expected,
  bounded-recoverable behavior, not a worker-fatal condition by itself —
  `ARCHITECTURE.md`'s existing invariant ("Redis transport and coordination
  mirror, not authoritative source... durable state must be reconstructable
  from PostgreSQL/SQLite after Redis loss") already covers this: MT5 polling
  and SQLite commits continue independent of Redis reachability, and the
  backlog drains once Redis returns, gated only by the *existing* Redis
  lease renewal succeeding (if Redis itself is down, lease renewal is
  already failing too, and the worker already exits `LEASE_LOST` via the
  existing watchdog — the outbox dispatcher does not need its own
  Redis-down detection, it inherits the worker's).
- **Caveat (O3, review pass 2):** "reclaimable by whichever worker/epoch
  acquires the lease next" describes what `claim_outbox` guarantees at the
  SQLite layer — it does not by itself guarantee a *new worker process for
  that account can start at all*. `bridge/ownership.py`'s
  `LocalLoginLock.acquire()` unconditionally raises
  `LocalOwnershipUnavailable` if a lock file already exists, with no way
  to distinguish "prior holder is provably dead" from "still alive" — a
  pre-existing gap this document's own §9/§2 discussion already names as
  future work, not something §11 introduces or fixes. Outbox reclaim is
  therefore automatic **conditional on** a live worker for that account
  existing to run `claim_outbox` at all; if the local lock is stuck (a hard
  Job Object kill left the lock file behind), the outbox backlog for that
  account is durable and safe but will not drain until the local-lock gap
  is separately resolved. This is not a new risk §11 creates, only one it
  inherits and should not be read as having silently closed.

### 11.6 Crash recovery

Every scenario below is a *durable* recovery — no in-memory state anywhere
is load-bearing for correctness, only for liveness/throughput:

1. **Crash after `commit_window` commits, before any claim.** Rows sit
   `PENDING`. Next dispatcher instance (same process restarted, or a new
   worker after supervisor restart) claims them normally. No special case.
2. **Crash after `claim_outbox` marks `INFLIGHT`, before the Redis call.**
   Row stays `INFLIGHT` until `claim_expires_at_utc` passes
   (`BRIDGE_OUTBOX_CLAIM_LEASE_S`), then `claim_outbox`'s existing query
   picks it up again automatically — the exact mechanism already built,
   unchanged by this design.
3. **Crash after `append_stream_fenced` succeeds (Redis has the entry),
   before `ack_outbox` commits.** The row is reclaimed per (2) and
   re-dispatched, calling `append_stream_fenced` again with the same
   `event_id` → a **duplicate Redis stream entry** with a different
   Redis-assigned entry ID but the same `event_id` field. This is accepted,
   not prevented — see §11.7 (idempotency is consumer-side). This is the
   single most important tradeoff in this design and it is deliberate:
   preventing it would require a distributed transaction across SQLite and
   Redis, which this system does not have and does not need if consumers
   dedupe by `event_id` (they already can — every envelope's `event_id` is
   the record's content-addressed identity, unchanged by this design).
4. **Crash mid-`ack_outbox`/`fail_outbox`/`requeue_outbox` statement.**
   Each is a single SQLite `UPDATE`, atomic by the engine — a crash mid
   statement leaves the pre-statement state (SQLite's own WAL durability,
   already configured `synchronous=FULL` in `_configure_connection`), never
   a torn write. No new atomicity work needed here.
5. **Lease lost mid-batch (some messages in a claimed batch already
   published, then `append_stream_fenced` starts rejecting for the rest).**
   Already-`ack_outbox`'d messages in the batch stay `PUBLISHED` (correct,
   final). The remaining un-acked messages of that same batch are left
   `INFLIGHT` per §11.5, not partially quarantined — a lease loss is never
   evidence any specific message is bad.
6. **Ordering-gate false positive (§11.8's dispatcher-side pre-publish
   re-check finds a `history.window` message's siblings not actually all
   `PUBLISHED`, despite the claim-time gate query having selected it).**
   Treated as an internal invariant violation: log at `UNEXPECTED_FATAL`
   severity (matching `exit_codes.py`'s naming for "always a bug to fix"),
   skip publishing that message this cycle (leave it `INFLIGHT` to be
   reclaimed), do not crash the dispatch thread over one message — this is
   a belt-and-suspenders check catching a bug in the gate query itself, not
   an expected runtime condition.
7. **Poison message that will never succeed** (malformed envelope from a
   pre-existing bug, Redis permanently rejecting the payload shape).
   Reaches `QUARANTINED` via the non-retryable path (§11.4's error-class
   table) on first occurrence, or via `BRIDGE_OUTBOX_MAX_ATTEMPTS`
   exhaustion for a message that's merely persistently unlucky rather than
   structurally broken. Either way, quarantine is terminal until an
   operator investigates and calls `requeue_outbox` — it does not silently
   retry forever, and it does not silently drop the message (the row and
   its `envelope_json` remain in SQLite, durable, until explicit cleanup
   deletes only `PUBLISHED` rows — §11.7 never deletes `QUARANTINED` rows).

### 11.7 Idempotency guarantees

- **Write-side idempotency (already built, unchanged):**
  `_insert_or_reuse_outbox` (§ ground truth) already makes inserting the
  same `event_id` twice a no-op reuse rather than a duplicate row —
  necessary because overlap windows (`HistoryPolicy.overlap_raw`) legitimately
  re-observe the same MT5 records across adjacent windows, and both windows'
  `commit_window` calls reference the same content-addressed `event_id`.
- **Delivery-side idempotency (this design's actual guarantee): at-least-once
  delivery to Redis, exactly-once *effect* only if the consumer dedupes by
  `event_id`.** This design does not attempt exactly-once delivery — per
  §11.6 scenario 3, that would require a cross-system distributed
  transaction this architecture deliberately does not have. Every consumer
  of `mt5n:v1:stream:history:{login}` must treat `event_id` (already present
  in every envelope, unchanged) as the dedup key, not Redis stream entry ID.
  This is not a new requirement invented for this design — it is the same
  content-addressed-identity pattern `bridge/canonical.py`'s
  `record_event_id` already establishes everywhere else in this codebase;
  §11 does not weaken it, it just makes explicit that outbox retries are the
  concrete mechanism that produces the duplicates consumers must already be
  prepared to dedupe.
- A duplicate delivery of an *already-`PUBLISHED`* message cannot happen
  through the normal dispatch path (`ack_outbox`'s `WHERE state='INFLIGHT'`
  guard means a `PUBLISHED` row is never claimed again by `claim_outbox`,
  whose own query only selects `PENDING`/expired-`INFLIGHT` rows). The only
  duplicate-producing window is scenario 3 in §11.6, bounded to the single
  retry immediately following an unacked-but-actually-successful publish.
- **O4 (review pass 2): who actually consumes this today.** Confirmed by
  inspection, not assumed: `mt5n:v1:stream:history:*` has **zero consumers**
  anywhere in this codebase right now. `src/worker-v2/index.ts:25-26`
  consumes a differently-namespaced, pre-existing pair of streams
  (`mt5:v2:history:deals`, `mt5:v2:history:orders`) written by the deleted
  `bridge_v2`, unrelated to this design's `mt5n:v1:` streams. This doesn't
  weaken the at-least-once contract above — it's the right contract
  regardless of who reads the stream — but it does mean the contract is
  currently unverified against a real reader, and §11 alone does not make
  history data visible anywhere downstream. When a consumer for this new
  stream is eventually built, `src/worker-v2/deal-consumer.ts`'s existing
  pattern (Prisma `upsert` on a natural key — `deal-consumer.test.ts:162`,
  "creates a new Deal via upsert with the natural key") is the precedent to
  follow: idempotent-by-natural-key writes at the consumer's persistence
  layer are a stronger and simpler dedup mechanism than tracking `event_id`
  as a separate seen-set, and this codebase already has one working example
  of it for the legacy stream shape.

### 11.8 Ordering rules

Two, and only two, ordering guarantees are made — the design deliberately
does **not** promise a total order across all outbox traffic, because doing
so would require a single serialized dispatcher across every account, which
contradicts the per-account isolation this whole system is built on:

1. **Within one `window_id`: every `history.deal`/`history.order` message
   must reach `PUBLISHED` before that window's single `history.window`
   summary message is even attempted.** Enforced two ways, not one:
   - **The exact predicate, corrected (fix for review finding B2).** The
     first draft's gate checked "no sibling in `{PENDING, INFLIGHT}`" —
     which a `QUARANTINED` sibling satisfies, since `QUARANTINED` is
     neither of those. A permanently-quarantined record would then have let
     its window's summary message through anyway, silently breaking the
     one guarantee this section exists to provide. **The correct predicate,
     used identically by both the claim-time gate and the pre-publish
     re-check below, is an existence check for anything NOT `PUBLISHED`,
     not an absence check for two specific bad states:**
     ```sql
     SELECT 1 FROM outbox_messages
     WHERE window_id = ?  AND event_id != ?  AND state != 'PUBLISHED'
     LIMIT 1
     ```
     A `history.window` candidate is claimable/publishable **only if this
     query returns no row.** `PENDING`, `INFLIGHT`, and `QUARANTINED`
     siblings all correctly block the gate under this formulation —
     including `QUARANTINED`, which is the entire point: a window whose
     record is stuck in quarantine must never falsely appear complete, and
     now stays blocked (§O2 below) until an operator resolves it, rather
     than silently passing.
   - **Claim-time gate (primary), with the transaction-scoping and
     query-shape this review's C1/C2 findings required be explicit:**
     `claim_outbox`'s existing `SELECT` (currently `event_id` only) widens
     to `SELECT event_id, window_id, envelope_json FROM outbox_messages
     WHERE ...` so each candidate's `message_type` (via the existing
     `_message_type` helper, which needs `envelope_json`) and `window_id`
     are available without a second per-candidate fetch. For each
     candidate whose `message_type` is `history.window`, the sibling query
     above runs **before** that candidate's `UPDATE ... SET state =
     'INFLIGHT'** — and, this is the C1 fix, **on the same connection,
     inside the same already-open `BEGIN IMMEDIATE` transaction
     `claim_outbox` already holds for the whole method call — never a
     separate connection or a separate transaction.** SQLite's
     `BEGIN IMMEDIATE` takes the write lock for the transaction's entire
     duration; running the sibling check on a second connection (or after
     committing/re-opening) would let another writer's `ack_outbox` or
     `fail_outbox` land between the check and the claim, reopening exactly
     the race this gate exists to close. A `history.window` candidate whose
     siblings aren't all `PUBLISHED` is skipped this round rather than
     claimed. This changes `claim_outbox`'s return size (it may return
     fewer than `limit` rows when window messages are skipped) — callers
     must not treat a short batch as "queue is empty."
   - **New indexes (§11.1) — the first draft's "no migration" claim was
     wrong twice over, once for the sibling lookup and once for cleanup
     (O1).** The sibling query above needs
     `outbox_window_siblings_idx ON outbox_messages(window_id, state)`
     (§11.1); the existing `outbox_claimable_idx` (`state,
     next_attempt_at_utc, claim_expires_at_utc`) doesn't serve it.
   - **Pre-publish re-check (defense in depth, §11.6 scenario 6):** the
     dispatcher, immediately before calling `append_stream_fenced` for a
     `history.window` message, re-runs the exact same sibling query above
     (same predicate, same "no row returned" success condition — not a
     different, looser check). A row returned here means the gate query has
     a bug, not that this is an expected runtime path.
   - **Why this predicate stays correct even after §11.9's cleanup deletes
     old `PUBLISHED` rows (fix for review finding C3).** Cleanup only ever
     deletes rows already in state `PUBLISHED` (§11.9) — it never touches a
     `PENDING`, `INFLIGHT`, or `QUARANTINED` row. The gate predicate above
     is an existence check for "any sibling NOT `PUBLISHED`" — a sibling
     that cleanup already removed was, by definition, `PUBLISHED` at
     deletion time, so its absence is indistinguishable from (and exactly
     as good as) it still being present and `PUBLISHED`. The alternative
     formulation this review's C3 finding warned about — counting
     `PUBLISHED` siblings and comparing that count to
     `history_windows.deal_count + order_count` — would break under
     cleanup, because a deleted row can't be counted; this design
     deliberately does **not** use that formulation. The existence-check
     shape above is the one that composes correctly with cleanup by
     construction, and `_validate_outbox_coverage` (already built,
     `bridge/journal/repository.py`) guarantees at `commit_window` time
     that every record for a window has exactly one outbox row, so there is
     no "row that should exist but never did" case for this check to miss.
   - Consumers may therefore rely on: "if I've seen a `history.window`
     message for window X, every deal/order record window X claims to
     contain has already landed in the same stream, at an earlier stream
     position." This is the one ordering property this design actually
     needs to hold, because it's what makes `history.window` usable as a
     completion marker.
   - **Operational signal (O2, promoted from §11.11's original "optional
     follow-up" to a required part of this design).** Because a
     `QUARANTINED` sibling now correctly blocks its window's summary
     message forever until `requeue_outbox`, an operator needs a way to
     learn "window X is stuck" without diffing `outbox_messages` by hand.
     `bridge/health.py`'s per-account `AccountHealth` record (§9) gains two
     fields, populated by the dispatcher whenever it observes a quarantine
     transition (cheap — it already just wrote one via `fail_outbox`, no
     extra query needed):
     ```text
     outbox_quarantined_count: int             # COUNT(*) WHERE state='QUARANTINED'
     oldest_outbox_quarantined_at_utc: str | null   # MIN(quarantined_at_utc) WHERE state='QUARANTINED'
     ```
     Both are derivable from `outbox_messages` at any time (not just at
     write time) using `quarantined_at_utc` (§11.1), so a supervisor-level
     periodic reconciliation pass can also refresh them independent of the
     dispatcher's own writes — the same "health file is a snapshot,
     rebuildable from durable state" property §9 already establishes for
     the rest of `AccountHealth`.
2. **Nothing else is ordered.** Relative order between `deal` and `order`
   messages within a window, between messages from different windows of the
   same profile, or between different profiles entirely, is explicitly
   **not** guaranteed by dispatch order — `claim_outbox`'s batch selection
   is global, ordered only by `(next_attempt_at_utc, event_id)`, with no
   window- or profile-affinity partitioning. This is intentional simplicity,
   not an oversight: every record's own payload already carries its
   authoritative ordering fields (`time`/`time_msc` for deals,
   `time_done`/`time_setup` for orders, per `bridge/history.py`'s existing
   `_deal_key`/`_order_key`), and `HistorySynchronizer`'s own
   `_call_lock`-serialized, checkpoint-gated window progression (already
   built) already guarantees windows for one profile are *committed* to
   SQLite in increasing `start_raw` order — consumers needing
   chronological order reconstruct it from record content or window
   `start_raw`/`end_raw`, never from Redis stream position across windows.

### 11.9 Cleanup policy

```text
BRIDGE_OUTBOX_RETENTION_DAYS   default 7   (mirrors WORKER_V2_EQUITY_RETENTION_DAYS's
                                             existing precedent for a bounded
                                             retained window, same rationale:
                                             once PUBLISHED, the row's only
                                             remaining value is short-term
                                             operational debugging)
```

- Only rows in state `PUBLISHED` with `published_at_utc` older than the
  retention window are eligible for deletion:
  `DELETE FROM outbox_messages WHERE state = 'PUBLISHED' AND
  published_at_utc < ?`, served by `outbox_published_cleanup_idx (state,
  published_at_utc)` (§11.1 — **fix for review finding O1**, which noted
  the first draft proposed this query with no supporting index; at scale,
  an unindexed scan of every `PUBLISHED` row for `published_at_utc`
  filtering would hold SQLite's single-writer lock for the scan's duration,
  blocking `claim_outbox`/`ack_outbox`/`fail_outbox` meanwhile). `QUARANTINED`
  rows are **never** auto-deleted by this policy — they require explicit
  operator attention (`requeue_outbox`, or a separate,
  out-of-scope-for-this-design "acknowledge and discard" operator action if
  a message is determined to be genuinely unrecoverable and not worth
  requeuing). `PENDING`/`INFLIGHT` rows are never deletion-eligible by
  definition (they're active work).
- **Deleting a `PUBLISHED` sibling never invalidates a still-pending
  window's completeness check** — this is §11.8's C3 fix, restated here
  because it's this section's behavior that could otherwise appear to
  conflict with §11.8's guarantee: the ordering gate's predicate is "does
  any sibling row exist in a state other than `PUBLISHED`," not a count of
  `PUBLISHED` rows against an expected total. A `PUBLISHED` row cleanup
  deletes was, by definition, already `PUBLISHED` — removing it cannot
  cause the existence check to find something it shouldn't. See §11.8 for
  the full argument; this bullet exists so a reader of this section alone
  doesn't need to cross-reference to confirm cleanup is safe.
- Cleanup never touches `history_windows`, `history_record_versions`, or
  `history_window_records` — those are the durable source-of-truth tables
  per `ARCHITECTURE.md`'s existing data model, entirely independent of
  whether their corresponding outbox publication succeeded, failed, or was
  cleaned up. Deleting a `PUBLISHED` outbox row only removes the
  publication-obligation bookkeeping; it never removes history data.
- Cleanup cadence and mechanism (a periodic `DELETE`, run from the
  supervisor or a dedicated low-frequency thread, using the index above) is
  left to implementation — no new correctness property depends on cleanup
  timing, only storage growth and lock contention, which is why this
  section is short relative to §11.4–§11.8.
- **Operator reconstruction after siblings age out (review pass 2):** a
  record can stay quarantined for well over `BRIDGE_OUTBOX_RETENTION_DAYS`
  while its already-`PUBLISHED` siblings get cleaned up out from under it.
  When the operator eventually calls `requeue_outbox` and the record
  finally publishes, its window's `history.window` summary message
  publishes after siblings whose rows no longer exist in SQLite — the
  Redis stream ordering guarantee (§11.8) still holds regardless (it was
  established by publish order at the time, not by row survival), but the
  *local audit trail* for "what was in this window and when did each part
  land" is gone once cleanup runs. §11.8's `outbox_quarantined_count`/
  `oldest_outbox_quarantined_at_utc` health fields (O2) tell an operator
  *that* something is stuck and *since when*, which is what's needed to act
  before cleanup erases the sibling rows — they do not reconstruct
  after-the-fact what already got deleted. An operator who needs the full
  per-record history after cleanup already ran must go to
  `history_windows`/`history_record_versions` (never deleted by this
  policy) or the Redis stream itself, not `outbox_messages`. This is an
  accepted limit of a 7-day operational-debugging retention window, not a
  gap this design needs to close — but it is why O2's fields exist to
  surface the problem *while* the evidence still exists, not merely as a
  historical record.

### 11.10 Review verdict (2026-07-31, third pass)

**§11 is ready for implementation.** Two review passes ran against this
section: the first found blockers B1 (retry counter punished messages for
reclaim churn, not delivery failure) and B2 (ordering gate's predicate let
a `QUARANTINED` sibling through, silently breaking the completion-marker
guarantee), plus correctness findings C1–C3, operational findings O1–O4,
and documentation findings I1–I2. All are addressed above, each at its own
subsection, not deferred. A second pass re-verified the fixes against the
actual repository — including reading `bridge/journal/migrations.py`
directly (§11.1) to confirm the new migration this revision requires needs
no code change to apply — and found three residual issues, all
non-blocking, all now folded in: `fail_outbox`'s read-then-write nature
needed to be stated explicitly rather than left implied by the (no-longer-
universally-true) "single blind UPDATE" claim (§11.3); one Testing-section
assertion (C1's original phrasing) tested an unobservable race rather than
the structural same-connection property that actually matters, and has been
reworded (§11's Testing bullets); and the interaction between long-lived
quarantine and cleanup's retention window needed one clarifying paragraph
about what the O2 health fields do and don't reconstruct (§11.9).

**Conditions that must be preserved during implementation** (carried
forward from the first review pass, plus what this pass added):

- The claim-time gate and pre-publish re-check both use the exact predicate
  "does any sibling row exist in a state other than `PUBLISHED`" — never a
  narrower "not `PENDING`/`INFLIGHT`" check (that was B2).
- `delivery_failure_count` is incremented **only** inside `fail_outbox`,
  **only** after a genuine Redis publish attempt failed. `claim_outbox`'s
  pre-existing `attempt_count` increment must never be read by any
  quarantine-threshold decision (that was B1).
- The sibling check (§11.8) and `fail_outbox`'s read-then-write (§11.3)
  both execute on the same connection, inside the same already-open
  `BEGIN IMMEDIATE` transaction the calling method holds — never a second
  connection, never a separate transaction (C1, extended in this pass to
  cover `fail_outbox` too).
- `QUARANTINED` rows are never auto-deleted by cleanup, and cleanup of
  `PUBLISHED` rows never invalidates the ordering gate for a still-pending
  window (C3) — because the gate is an existence check for "not
  `PUBLISHED`," not a count comparison against an expected total.
- Cleanup never touches `history_windows`, `history_record_versions`, or
  `history_window_records`.
- Consumers of `mt5n:v1:stream:history:*` dedupe by `event_id`, never Redis
  stream entry ID — this is at-least-once delivery, not exactly-once (O4).
- `bridge/health.py`'s `AccountHealth` schema (§9) carries
  `outbox_quarantined_count`/`oldest_outbox_quarantined_at_utc` (O2) —
  these are required, not optional, given a corrected B2 makes a
  stuck-on-quarantine window an expected operational state operators need
  visibility into.
- `002_outbox_ack.sql`'s SQL must be finalized before implementation and
  never edited afterward once applied anywhere — `verify_migrations`
  checksums file contents; a post-hoc edit requires a new `003_*.sql`, not
  a change to this file.

Nothing in §11 is blocked on work outside this section, with one named
exception unchanged from the first pass: `bridge/accounts/*.json` still
doesn't exist on the VPS, and `HistorySynchronizer`'s `safe_end` boundary
provider plus a public `JournalRepository` checkpoint accessor (ground-truth
section, "Not built anywhere yet") are still separately required before
`bridge/worker.py`'s `poll_history` wiring can be completed — §11 unblocks
the outbox specifically, it does not by itself make the worker
end-to-end runnable.

### 11.11 What this section deliberately leaves out

- The dispatcher's exact threading model inside `run_worker` (a third
  background thread alongside `LeaseRenewalThread`, per §11.5's "plugs into
  the same `lease_lost` Event" requirement) is implementation detail for
  the eventual `bridge/outbox_dispatcher.py`, not a design decision — the
  behavioral contract above is what the code review needs to check against.
- ~~A per-account outbox-backlog-depth field on `bridge/health.py`'s
  `AccountHealth` schema would be a follow-up, not required for §11~~ —
  **superseded, review pass 2 (O2):** the specific case of a window
  permanently stuck behind a quarantined sibling is no longer optional; it
  is now specified in §11.8 as two required `AccountHealth` fields
  (`outbox_quarantined_count`, `oldest_outbox_quarantined_at_utc`), because
  the corrected B2 gate means that scenario is now a real, expected
  consequence of correct behavior, not a hypothetical. A broader
  "total backlog depth regardless of state" metric (queue is merely large
  but healthy vs. queue has a stuck item) remains genuinely optional and is
  not added here.
- **Implementation cost is concentrated in §11.8's ordering gate**, not
  spread evenly across §11: the two-phase claim, the new
  `outbox_window_siblings_idx` migration, and the pre-publish re-check are
  all in service of one property (§11.8's completion-marker guarantee). A
  reviewer weighing scope should weigh that gate specifically, not treat
  §11's cost as uniform across its subsections.
- An "acknowledge and permanently discard" operator action distinct from
  `requeue_outbox`, for a `QUARANTINED` message an operator determines is
  genuinely unrecoverable and not worth ever retrying — out of scope until
  an actual operator workflow surfaces the need, consistent with this
  design's general bias toward not building operator tooling ahead of a
  demonstrated need (mirrors §7's `unquarantine`-only, no
  `permanently-ignore`, precedent at the account level).

## 12. Account discovery (auto-discovery, new 2026-07-31)

### 12.0 Why this exists

The original design assumed `bridge/accounts/*.json` was authored by an
operator before the bridge ever ran — every architecture description above
("the supervisor scans `bridge/accounts/*.json`") was written against that
assumption. That assumption was withdrawn by explicit direction: the bridge
must reach a fully populated account list from nothing but running,
logged-in, portable-mode MT5 terminals on the host, with no per-account
config authoring, no per-account CLI arguments, and no new terminal UI
windows opened in the process. Per-account config files still exist, but
strictly as an optional override, never as the default mechanism and never
as a deployment blocker.

### 12.1 What discovery can and cannot know in advance

Every other part of this design (§5's post-connect identity check, §6's
duplicate detection, `TerminalSession.connect_verified`) assumes a
`TerminalProfile` is known *before* connecting, and verifies the live
terminal matches it *after*. Auto-discovery inverts this for exactly one
step: it doesn't know `expected_login`/`expected_server`/
`expected_data_path` in advance — that's the whole point, discovery is what
*produces* them. Discovery therefore does its own lightweight
attach-read-detach cycle, entirely separate from and prior to
`TerminalSession`'s known-profile verified-connect/revalidate loop, which
remains completely unchanged and still governs every poll cycle once a
worker is running against a profile (whether that profile came from
discovery or an override file — from that point on there is no difference).

### 12.2 `bridge/discovery.py` — `discover_accounts()`

```text
discover_accounts(*, process_lister, mt5_factory,
                   initialize_timeout_ms=10_000, coordination_domain="default",
                   history_lower_bound_raw=0
                   ) -> (tuple[DiscoveredAccount, ...], tuple[str, ...])
```

1. `process_lister.build_candidates()` — satisfied by the already-built
   `RealProcessProbe`, unchanged — enumerates every `terminal64.exe`
   process the same way the known-profile path already does.
2. Each candidate is filtered: incomplete process evidence, or not running
   in portable mode (`_portable_mode(candidate.command_line)`, the same
   helper `process_probe.py` already exports) — skipped with a warning,
   never a hard failure, matching `load_accounts_dir`'s existing
   per-item-isolated-failure philosophy. Two candidates sharing the exact
   same `executable_path` are only ever connected to once.
3. For each surviving candidate, `mt5_factory()` produces one connection
   (satisfied by the already-built `RealMt5Port`), `initialize()` is called
   with **that candidate's own `executable_path`, taken directly from the
   enumerated running process** — never a path discovery invents — which
   is the entire mechanism that prevents a new terminal window from
   opening: `MetaTrader5.initialize()` attaches to an already-running
   process at an exact path instead of launching a new one, the same
   guarantee `select_process`/`TerminalSession.connect_verified` already
   rely on for the known-profile path, applied here one step earlier.
4. `StrictMt5Adapter(mt5).terminal()`/`.account()` read the live identity.
   Any failure, a disconnected terminal, or a missing/invalid field
   (`data_path`, `login`, `server`) skips that candidate with a warning.
   **The connection is always torn down (`mt5.shutdown()`, in a `finally`)
   regardless of outcome** — discovery never leaves an attach dangling,
   since the worker that will eventually own this account connects
   independently, as its own OS process, once discovery has already
   detached.
5. A `TerminalProfile` is constructed from the discovered values exactly
   as `account_config.py` would build one from a JSON file — same type,
   same Pydantic validation. If two different processes both resolve to
   the same `expected_login`, the second is discarded with a warning: one
   account, one bridge worker, regardless of how many terminal instances
   happen to be logged into it.

### 12.3 `bridge/account_resolution.py` — `resolve_accounts()`

The supervisor-facing entry point that turns discovery output into the
same `AccountConfig` list `load_accounts_dir` used to produce directly:

1. Run `discover_accounts()`.
2. For each discovered login, check whether `bridge/accounts/<login>.json`
   exists. If it does, that file wins **verbatim** — loaded through the
   ordinary `load_account_file` path, discovery's own profile for that
   login is discarded entirely, never field-merged with the override. A
   partial override silently inheriting stale discovered fields would be a
   worse failure mode than requiring a complete override file, matching
   `account_config.py`'s existing "unknown keys rejected, nothing
   partially defaulted" posture.
3. If no override exists, the discovered profile is serialized to the
   *same JSON shape* an override file would use and written to
   `<generated_dir>/<login>.json` via the existing `atomic_write_json`
   helper, then loaded back through the same unchanged `load_account_file`
   — discovery never constructs an `AccountConfig` itself. One validation/
   canonicalization implementation serves both account sources, so a bug
   fixed in the loader is fixed for both, and there is no second code path
   to keep in sync.
4. An override file for a login discovery did **not** find this cycle
   (a terminal that isn't running right now, or an account intentionally
   managed outside auto-discovery) still loads — an override is a standing
   declaration of intent, not conditioned on discovery having found a live
   process for it this run.
5. The generated journal path for a discovered (non-overridden) account is
   `<state_dir_windows>\journal\<login>.sqlite3`, `state_dir_windows`
   defaulting to `C:\analytic\bridge\state` (matching this repo's
   documented VPS install path, `C:\analytic`) — configurable, since the
   real value must match wherever the deployed `BRIDGE_STATE_DIR` actually
   points.

### 12.4 Requirement-by-requirement mapping

| Requirement | Mechanism |
|---|---|
| Discover portable MT5 terminals automatically | `discover_accounts()`'s `_portable_mode` filter over `RealProcessProbe` candidates |
| Detect executable path and data path | `candidate.executable_path` (from process enumeration) + `terminal_info().data_path` (from the discovery-connect) |
| Read the currently logged-in login/server | `account_info().login`/`.server` from the same discovery-connect |
| One bridge process per unique account | Dedup by `expected_login` inside `discover_accounts()`, before any profile reaches `resolve_accounts()` or the supervisor |
| Prevent duplicate bridge processes | Unchanged, already built: `bridge/ownership.py`'s `LocalLoginLock`, keyed by login — this was never a config-file concern, it's a worker-startup concern, orthogonal to how the profile was sourced |
| No per-account CLI arguments | `python -m bridge` (once `__main__.py` exists) takes zero account-specific arguments; the per-account config-path argument to `python -m bridge.worker` is supervisor-internal and machinery-generated, never operator-supplied |
| No additional terminal UI windows | §12.2 step 3 — `initialize()` only ever called with a path taken from an already-running process |

### 12.5 What this does not change

- `TerminalSession.connect_verified`/`.revalidate`, the post-connect
  identity checks in §5, and the poll loop are entirely unchanged — once a
  `TerminalProfile` exists (discovered or overridden), everything
  downstream of it is identical to the original design.
- §6's canonical-path duplicate detection still runs over whatever
  `resolve_accounts()` produces, unchanged — discovery does not bypass it.
- Discovery is a point-in-time snapshot, run once at supervisor startup
  (and, per §7's existing quarantine-rescan-cadence precedent, could be
  re-run on a similar interval to pick up a terminal that started later —
  left to `bridge/supervisor.py`'s implementation, not a new correctness
  property this section needs to specify further).

## `RealMt5Port` — injectable MT5 module

Unchanged from the second draft:

```python
class Mt5Module(Protocol):
    def initialize(self, path: str, timeout: int, portable: bool) -> bool: ...
    def shutdown(self) -> None: ...
    def version(self) -> tuple | None: ...
    def terminal_info(self) -> object | None: ...
    def account_info(self) -> object | None: ...
    def positions_get(self) -> tuple | None: ...
    def orders_get(self) -> tuple | None: ...
    def history_deals_get(self, start: int, end: int) -> tuple | None: ...
    def history_orders_get(self, start: int, end: int) -> tuple | None: ...
    def last_error(self) -> tuple: ...


class RealMt5Port:
    def __init__(self, mt5_module: Mt5Module | None = None) -> None:
        if mt5_module is None:
            import MetaTrader5 as mt5_module  # Windows-only import, deferred
        self._mt5 = mt5_module

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        return self._mt5.initialize(path, timeout=timeout, portable=portable)

    # ...one-line passthrough per method, matching Mt5Module exactly...
```

## `BRIDGE_*` environment variables (additions in this revision marked NEW)

```text
BRIDGE_LIVE_POLL_MS                     default 1000
BRIDGE_HISTORY_POLL_MS                  default 30000
BRIDGE_EQUITY_SAMPLE_MS                 default 60000
BRIDGE_LEASE_TTL_MS                     default 15000
BRIDGE_LEASE_RENEW_INTERVAL_MS          default TTL/3
BRIDGE_LEASE_WATCHDOG_MARGIN_S          default 2        NEW — §4
BRIDGE_REVALIDATE_EVERY_N_POLLS         default 1
BRIDGE_RESTART_BACKOFF_BASE_MS          default 1000
BRIDGE_RESTART_BACKOFF_MAX_MS           default 300000
BRIDGE_RESTART_STABLE_MS                default 300000
BRIDGE_IDENTITY_VIOLATION_MAX_RESTARTS  default 3
BRIDGE_RESTART_WINDOW_MS                default 600000
BRIDGE_DUPLICATE_RETRY_MS               default 60000
BRIDGE_CTRL_BREAK_WAIT_MS               default 2000     NEW — §2
BRIDGE_SHUTDOWN_GRACE_MS                default 15000
BRIDGE_SHUTDOWN_KILL_GRACE_MS           default 5000
BRIDGE_QUARANTINE_RESCAN_MS             default 30000    NEW — §7
BRIDGE_ACCOUNTS_DIR                     default "bridge/accounts"
BRIDGE_STATE_DIR                        default "bridge/state"   NEW — §7/§9
BRIDGE_HISTORY_LOWER_BOUND_MAX_SKEW_S   default 86400
BRIDGE_HEALTH_PORT                      default 9300
BRIDGE_OUTBOX_RETRY_BASE_MS             default 1000     NEW — §11.4
BRIDGE_OUTBOX_RETRY_MAX_MS              default 60000    NEW — §11.4
BRIDGE_OUTBOX_MAX_ATTEMPTS              default 8        NEW — §11.4
BRIDGE_OUTBOX_CLAIM_LEASE_S             default 30       NEW — §11.4
BRIDGE_OUTBOX_DISPATCH_BATCH_SIZE       default 50       NEW — §11.4
BRIDGE_OUTBOX_DISPATCH_INTERVAL_MS      default 2000     NEW — §11.4
BRIDGE_OUTBOX_RETENTION_DAYS            default 7        NEW — §11.9
```

## Testing

Unit-testable anywhere (fakes/in-memory, no real MT5 or Windows API) unless
marked Windows-only:

- Everything already listed in the prior revision (account-config loader
  invariants, `RealMt5Port` passthrough, restart-storm/backoff/jitter,
  permanent-failure quarantine-on-first-occurrence, shutdown-during-backoff,
  stable-runtime reset, duplicate-config detection, partial-startup reverse
  cleanup, PID-orphan self-check as defense-in-depth) — restated as still
  required, not superseded.
- **Job Object cleanup** (Windows-only): spawn a fake child under a real Job
  Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; kill the supervisor
  process (or close the job handle directly in-test to simulate it); assert
  the child process no longer exists shortly after, without the child having
  received or acted on any signal.
- **Forced supervisor death** (Windows-only, exercises §1 end-to-end): start
  a real supervisor with two real fake-worker children; hard-kill the
  supervisor process itself (`TerminateProcess`, not a graceful stop); assert
  both children are gone within a bounded interval and neither is left
  holding its local lock file in an unrecoverable state (a fresh supervisor
  start afterward must be able to reacquire).
- **Lease loss during a blocked MT5 call**: fake MT5 session whose
  `history_deals_get` blocks (a controllable `threading.Event`-gated fake) —
  trigger lease loss (via the renewal thread) while that call is still
  blocked; assert that once the call unblocks and returns, the worker does
  not attempt any Redis write with the now-stale credential (assert the fake
  transport's fenced methods are never called after `lease_lost` was set,
  not merely that they'd fail if called), and that history-window commit-to-
  SQLite behavior for that in-flight call matches §3's stated invariant
  (already-blocked read either completes and commits to SQLite with no
  Redis publish attempted, or is abandoned — either is acceptable, but a
  Redis publish attempt is not).
- **Renewal-thread failure**: three fake-thread scenarios exercising each
  path in §4 — (a) fake `RedisLease.renew` always raises
  `RedisTransportError` (unclassifiable), (b) fake renewal thread is killed
  mid-test (simulating thread death) with no further calls ever happening,
  (c) fake renewal thread's calls succeed but are artificially delayed past
  the watchdog margin. Assert all three converge to the worker treating the
  lease as lost within `ttl_ms - BRIDGE_LEASE_WATCHDOG_MARGIN_S` of the last
  real success, using the same watchdog check, not three different code
  paths.
- **Canonical-path duplicates**: two account JSON fixtures whose
  `executable_path` values differ only through a simulated junction
  (mockable at the `canonical_path` resolution layer without needing a real
  Windows junction in the unit-test tier) — assert the pre-spawn duplicate
  check catches it; a Windows-only counterpart test creates a real junction
  and asserts the same against `RealProcessProbe`'s actual environment.
- **Post-connect identity mismatch**: fake `StrictMt5Adapter` whose
  `terminal()`/`account()` results mismatch the profile in each of the five
  ways listed in §5 (path, data_path, connected-false, login, server) —
  assert each independently produces `IDENTITY_VIOLATION` (Layer 1) and that
  `shutdown()` is called exactly once per case, never `terminate`/`kill`
  on any process.
- **Quarantine persistence**: quarantine an account, simulate a supervisor
  restart (fresh in-test supervisor instance loading the same
  `BRIDGE_STATE_DIR`), assert the account is still quarantined and not
  spawned; then run the `unquarantine` CLI path in-test, assert the account
  is spawned on the next scan without requiring the supervisor to restart.
- **Outbox lifecycle** (§11, unit-testable anywhere via a real in-memory
  SQLite `JournalRepository`, no fakes needed since the repository itself is
  already the real implementation): `ack_outbox` on a `PENDING` (not
  `INFLIGHT`) row raises `OutboxStateConflict`; `fail_outbox` with
  `retryable=True` and `delivery_failure_count` below the max (after this
  call's own increment) requeues to `PENDING` with `next_attempt_at_utc` in
  the future; the same call when the post-increment value reaches
  `BRIDGE_OUTBOX_MAX_ATTEMPTS` quarantines instead and sets
  `quarantined_at_utc`; `fail_outbox` with `retryable=False` quarantines on
  the very first call regardless of `delivery_failure_count`;
  `requeue_outbox` on a non-`QUARANTINED` row raises `LookupError` and on a
  `QUARANTINED` row clears `quarantined_at_utc` to `NULL` without touching
  `delivery_failure_count`/`attempt_count`; two concurrent `ack_outbox`
  calls for the same `event_id` (simulating a reclaimed-and-redispatched
  duplicate racing the original) — assert exactly one succeeds and the
  other sees the zero-rows-matched conflict, never a double-`PUBLISHED`
  write.
- **Retry-counter isolation** (§11.3, the regression test for review
  finding B1): claim a row `BRIDGE_OUTBOX_MAX_ATTEMPTS + 2` times via
  repeated crash-simulated reclaim (advance a fake clock past
  `BRIDGE_OUTBOX_CLAIM_LEASE_S` each time, never calling `fail_outbox`) —
  assert `attempt_count` climbs past the max while `delivery_failure_count`
  stays 0 and the row is still claimable, never `QUARANTINED`. Then call
  `fail_outbox(retryable=True)` on it exactly `BRIDGE_OUTBOX_MAX_ATTEMPTS`
  times — assert quarantine happens on that Nth call regardless of how high
  `attempt_count` had already climbed from the unrelated reclaim churn.
- **Ordering gate** (§11.8, the regression test for review finding B2): a
  window with three sibling record messages, one deliberately driven to
  `QUARANTINED` (not merely left `PENDING`/`INFLIGHT`) — assert
  `claim_outbox` never returns the `history.window` message while that
  sibling stays `QUARANTINED`, confirming the gate's predicate is "all
  siblings `PUBLISHED`," not "no sibling `PENDING`/`INFLIGHT`" (the first
  draft's bug, which a `QUARANTINED`-sibling test case would not have
  caught since it only exercised `PENDING`/`INFLIGHT` blocking); assert it
  does return the window message once the quarantined sibling is
  `requeue_outbox`'d and subsequently `PUBLISHED`; assert the dispatcher's
  pre-publish re-check (§11.6 scenario 6) refuses to call
  `append_stream_fenced` for a `history.window` message if a
  fake/injected state mutation makes a sibling non-`PUBLISHED` between
  claim and publish, without crashing the dispatch loop. **C1 is a
  structural property, not a timing race — test it as one:** under
  `BEGIN IMMEDIATE`, a second connection attempting to write during the
  first's transaction simply blocks on `busy_timeout` and cannot produce an
  observable interleaving, so asserting "a second connection cannot mutate
  the row mid-check" would either time out or trivially pass regardless of
  where the sibling check actually runs. Assert the real requirement
  instead: patch/spy the connection object `claim_outbox` opens its
  `BEGIN IMMEDIATE` on, and assert the sibling-check query executes against
  that same connection object, never a second one obtained via
  `sqlite3.connect` or a fresh `Journal.open` inside the method — a
  same-connection assertion is what actually verifies C1's requirement.
- **Cleanup does not break the ordering gate** (§11.8/§11.9, the regression
  test for review finding C3): commit a window, publish and clean up (past
  `BRIDGE_OUTBOX_RETENTION_DAYS`) two of its three sibling records while the
  third and the `history.window` message are still artificially held
  `PENDING` — assert the gate's sibling query still correctly reports "no
  blocking sibling" for the two cleaned-up (deleted) rows, i.e. cleanup of
  already-`PUBLISHED` rows never causes the existence check to behave
  differently than if those rows still physically existed.
- **Crash-recovery reclaim** (§11.6 scenarios 1–3): claim a row, do not ack
  it, advance a fake clock past `BRIDGE_OUTBOX_CLAIM_LEASE_S`, assert a
  second `claim_outbox` call reclaims the same `event_id` with
  `attempt_count` incremented again and `delivery_failure_count`
  unchanged — this exercises the *existing*, already-built `claim_outbox`
  reclaim query, asserting this design's retry/backoff layer composes with
  it correctly rather than fighting it.
- **Lease-loss non-punishment** (§11.5): fake transport whose
  `append_stream_fenced` raises `LeaseUnavailable` — assert the dispatch
  thread sets the shared `lease_lost` event, assert `fail_outbox` is never
  called for the in-flight message (its `delivery_failure_count` and state
  must be unchanged from what `claim_outbox` left it at; `attempt_count`
  changing is expected and irrelevant), distinct from a
  `RedisTransportError` on the same call, which must reach `fail_outbox`
  and must increment `delivery_failure_count`.
- **Atomic health-file replacement**: concurrently write a health file
  (writer thread looping `atomic_write_json`) while a reader thread reads it
  in a tight loop; assert every read is either the fully-prior or
  fully-new JSON — never a truncated/partial parse — across many iterations
  (this is the standard atomic-rename property test shape, applied to this
  specific helper).

Only verifiable on forexvps (Windows, real MT5, real psutil, real NSSM):
unchanged from the prior revision (`RealMt5Port`/`RealProcessProbe` against
real terminal/processes, full worker loop end-to-end, real nssm stop
delivery) — plus this revision's addition: **confirming the actual installed
NSSM stop-method configuration and observing directly whether
`CTRL_BREAK_EVENT` delivery succeeds or is a no-op** under the real Session-0
service context, since §2 commits to treating it as commonly unavailable but
that claim is itself only verifiable against the real deployment.

## Out of scope (unchanged)

- Config hot-reload for `bridge/accounts/*.json` (adding a *new* account
  while the supervisor runs still requires a restart — this is distinct from
  quarantine rescanning, §7, which does not require a restart).
- IPC between the `unquarantine` CLI and a live supervisor process beyond
  the shared quarantine-directory file + rescan cadence in §7.
- Cross-host supervisor coordination beyond what `RedisLease`'s coordination
  epoch already provides — this design's Job Object/quarantine/health work
  is entirely host-local.
