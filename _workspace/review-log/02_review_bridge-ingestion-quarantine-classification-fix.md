# Bridge Ingestion Review: TerminalNotReadyError / TerminalIdentityViolation quarantine split

**Status: pass**

**Reviewed scope:** Uncommitted local diff (working tree, not yet committed) on top of
`17837cc9f1e9a4d8e7710c79bfd6b80c76e10aea` (main, 2026-08-08), limited to:
- `bridge/terminal_session.py`
- `bridge/exit_codes.py`
- `bridge/worker.py`
- `bridge/supervisor.py`
- `bridge/tests/unit/test_terminal_session.py`
- `bridge/tests/unit/test_exit_codes.py`
- `bridge/tests/integration/test_supervisor.py`

Explicitly excluded per task instruction (separate, already-reviewed fix):
`src/worker-v2/*`. Also not part of this diff and not reviewed here:
`_workspace/02_review_ingestion.md`, `docs/harness/analytic/team-spec.md`,
`docs/decisions/0006-history-quarantine-decoupled-deal-commit.md`.

Note on file naming: this is not the canonical `_workspace/02_review_ingestion.md` path
(occupied by unrelated in-progress ADR-0006 review content per task instruction). Fallback
per `scripts/check-harness-review.sh` convention: commit message should include
`ingestion review: pass`.

## Incident recap

All 5 accounts (7998410, 7950622, 7954220, 7948784, 7953093) were quarantined under
`identity_violation` during a brief broker outage, because `mt5.initialize()` returning
`False` ("initialize failed") was classified as `TerminalIdentityViolation` — a permanent,
quarantine-ceiling-bearing classification — when the actual cause was a transient
terminal/broker unavailability, not a genuine identity mismatch. Quarantines have already
been manually cleared (not repeated here).

## Fix shape

`bridge/terminal_session.py` splits the previously single `TerminalIdentityViolation`
exception into two:

- `TerminalIdentityViolation` (unchanged semantics, unchanged docstring intent) — kept for:
  process identity changed before/after initialize, terminal path mismatch, terminal data
  path mismatch, account login/server mismatch, post-connect identity shape invalid.
- `TerminalNotReadyError` (new) — used for: `initialize()` returning `False`
  ("initialize failed"), post-connect API read failure (`CallState.FAILED` on
  version/terminal/account), and `terminal_value.get("connected") is not True`
  ("terminal is not connected").

`bridge/exit_codes.py` adds `WorkerExitCode.TERMINAL_NOT_READY = 17` (no collision — 17 was
unused, 16 was the prior max before the `18/19` gap up to `UNEXPECTED_FATAL = 20`) and
`Classification.TERMINAL_NOT_READY = "terminal_not_ready"`, mapped to
`RestartPolicy(PolicyKind.BACKOFF_RESTART, alert_on_first_occurrence=False)` — same shape as
`MT5_IPC_FAILURE`/`JOURNAL_LOCKED`.

`bridge/worker.py` adds a `TerminalNotReadyError` catch clause ahead of the existing
`TerminalIdentityViolation` clause at all three raise sites (`connect_verified`, poll-loop
`revalidate`, poll-loop `poll_history`/`poll` path), returning
`WorkerOutcome(WorkerExitCode.TERMINAL_NOT_READY, str(error))`.

`bridge/supervisor.py` removes the previous string-match special case
(`classification is IDENTITY_VIOLATION and detail == "terminal is not connected"` →
`terminal_disconnected`) that used to suppress quarantine for that one specific detail
string. That special case is now unnecessary because "terminal is not connected" no longer
produces `IDENTITY_VIOLATION` at all — it produces `TERMINAL_NOT_READY`, which never reaches
`decision.should_quarantine` in the first place (verified in `restart_policy.py`, below).
Rescan-on-classification (`self._rescan_requested = True`) is correctly widened to also fire
on `TERMINAL_NOT_READY`, preserving the original rescan behavior for a disconnected terminal.

## Primary question: could a genuine identity mismatch now be misclassified as transient?

**No.** Traced every raise site in `bridge/terminal_session.py`:

| Condition | Exception | Changed? |
|---|---|---|
| process identity changed before initialize | `TerminalIdentityViolation` | no |
| `initialize()` returned `False` | `TerminalNotReadyError` | **yes** (was `TerminalIdentityViolation`) |
| process identity changed after initialize | `TerminalIdentityViolation` | no |
| version/terminal/account API read `CallState.FAILED` | `TerminalNotReadyError` | **yes** (was `TerminalIdentityViolation`) |
| post-connect identity shape invalid (not a dict) | `TerminalIdentityViolation` | no |
| terminal path mismatch | `TerminalIdentityViolation` | no |
| terminal data path mismatch | `TerminalIdentityViolation` | no |
| `terminal_value.get("connected") is not True` | `TerminalNotReadyError` | **yes** (was `TerminalIdentityViolation`) |
| account login/server mismatch | `TerminalIdentityViolation` | no |

All three re-classified conditions are provably not identity checks — they fire before or
independently of any actual login/server/path comparison (a failed API call, or a "not yet
connected" flag, carries no identity information either way). Every condition that compares
an actual identity value (path, data_path, login, server, process fingerprint) is untouched
and still raises `TerminalIdentityViolation`. No regression path found where a wrong-login/
wrong-server/wrong-terminal-instance config would now retry forever instead of quarantining.

## Confirm transient failures no longer count toward the ceiling, narrowly scoped

`bridge/restart_policy.py::decide()` (unchanged by this diff, read to confirm gating logic):

```python
should_quarantine = (
    classification is Classification.IDENTITY_VIOLATION
    and next_restart_count > config.identity_violation_max_restarts
)
```

`should_quarantine` is `True` only for `Classification.IDENTITY_VIOLATION`. Since
`TERMINAL_NOT_READY` is a distinct classification, it can never reach this condition —
confirmed structurally, not just by test observation. The scope is narrow: only the three
re-mapped raise sites in `terminal_session.py` change classification; no other exit code
(`MT5_IPC_FAILURE`, `JOURNAL_FAILURE`, `JOURNAL_LOCKED`, `CONFIG_INVALID`,
`DUPLICATE_OWNERSHIP`, `LEASE_LOST`, `UNEXPECTED_FATAL`) is touched by this diff, so nothing
that should count toward quarantine is swallowed.

## Exit code contract

`WorkerExitCode.TERMINAL_NOT_READY = 17` — no collision with `IDENTITY_VIOLATION = 12`,
`MT5_IPC_FAILURE = 14`, `JOURNAL_FAILURE = 15`, `JOURNAL_LOCKED = 16`, or
`UNEXPECTED_FATAL = 20`. `classify_raw_exit_code()` handles unknown raw codes as
`UNEXPECTED_FATAL` via `ValueError` catch — unaffected by the new value. Classification
dict (`_EXIT_CODE_TO_CLASSIFICATION`) and `RESTART_POLICY` dict both got the new entry;
neither dict has a stale/missing-key risk (`test_exit_codes.py`'s existing exhaustiveness
tests — parametrized coverage of every `Classification` against `PolicyKind` — cover the
addition without needing a new test, and one row was added anyway for
`TERMINAL_NOT_READY`/`BACKOFF_RESTART`).

## Supervisor restart/backoff logic

- `decide()`'s `BACKOFF_RESTART` branch uses the same `compute_backoff_delay_ms` exponential
  backoff (base 1000ms doubling per restart, capped at `max_delay_ms` = 300,000ms / 5 min,
  plus jitter) for `TERMINAL_NOT_READY` as for `MT5_IPC_FAILURE`/`JOURNAL_LOCKED` — no
  special-cased tight loop, no bypass of the cap.
- `restart_count`/`window_start_s` are per-login, not per-classification, persisted via
  `bridge/health.py`. A `TERMINAL_NOT_READY` exit still increments the shared counter, so
  backoff delay still grows across repeated transient failures (doesn't degrade into a tight
  retry loop) even though it never quarantines — matches the pre-existing behavior for
  `MT5_IPC_FAILURE`.
- `supervisor.py`'s `if decision.should_quarantine:` / the pending-respawn gate
  (`if decision.should_quarantine or decision.kind is PolicyKind.NO_RESTART_REMOVE:`) both
  correctly reduce to a no-op for `TERMINAL_NOT_READY` (never quarantines, so it always
  proceeds to `_pending[child.login] = _PendingRespawn(...)` — i.e., it keeps retrying, which
  is the intended fix).
- The removed `terminal_disconnected` string-match special case is provably redundant now:
  it existed only to carve out one specific `detail` string under the old single-exception
  model; the new model achieves the same effect structurally via classification, and does so
  for *all three* re-mapped conditions (not just the one that had a manual carve-out before —
  "initialize failed" and "post-connect identity read failed" were previously NOT excluded
  from quarantine, which is exactly the incident's root cause).

## Test coverage: does it assert both sides distinctly?

- `test_terminal_session.py`: `test_failed_initialize_never_reads_or_publishes_identity`
  updated to assert `TerminalNotReadyError` (was `TerminalIdentityViolation`) for
  "initialize failed"; new `test_terminal_not_connected_is_transient_not_identity_violation`
  asserts `TerminalNotReadyError` for "terminal is not connected". Both are transient-side
  assertions. Genuine-identity-side assertions (login/server mismatch, path mismatch, process
  fingerprint change) are pre-existing tests in this file, unmodified by the diff — confirmed
  they still assert `TerminalIdentityViolation` (not touched, so behavior is provably
  unchanged for those cases; not a coverage gap since nothing needed updating).
- `test_exit_codes.py`: adds one parametrized row confirming
  `TERMINAL_NOT_READY → BACKOFF_RESTART`. Thin but consistent with the file's existing
  exhaustive-parametrization style.
- `test_supervisor.py` (integration, most important layer):
  - `test_worker_exit_log_has_account_terminal_pid_and_reason` updated to force-exit
    `TERMINAL_NOT_READY` and assert `classification=terminal_not_ready` in the exit log
    (was `identity_violation`) — proves the classification threading end-to-end.
  - `test_disconnected_terminal_backoff_does_not_end_in_quarantine` updated similarly,
    force-exits `TERMINAL_NOT_READY` across 4 supervisor ticks and asserts no quarantine —
    this is the direct regression test for the incident's specific trigger string
    ("terminal is not connected").
  - New `test_terminal_not_ready_backoff_never_quarantines_even_without_last_exit_detail`
    is the strongest test in the diff: explicitly does NOT write
    `state/last_exit/<login>.json`, so `_last_exit_detail` returns `None`, forcing the
    assertion to depend on classification alone (not on `detail` string matching) —
    directly proves the fix isn't just replacing one string match with another but is
    structurally sound. Runs 5 consecutive `TERMINAL_NOT_READY` exits with
    `identity_violation_max_restarts=1` (i.e., a config where IDENTITY_VIOLATION would have
    quarantined on the 2nd exit) and asserts still not quarantined after all 5 — good stress
    coverage.
  - Identity-violation-still-quarantines coverage: no *new* end-to-end integration test was
    added confirming N `IDENTITY_VIOLATION` exits still reach quarantine (the existing
    `test_worker_crash_follows_restart_then_quarantine_policy` integration test uses
    `CONFIG_INVALID`, not `IDENTITY_VIOLATION`, for its quarantine-reaching case). However,
    `bridge/tests/unit/test_restart_policy.py` (pre-existing, unmodified by this diff, not
    in the reviewed file list but read to confirm) directly unit-tests
    `decide(Classification.IDENTITY_VIOLATION, ...)` quarantine-ceiling behavior at lines
    127–170, and that file's assertions are unaffected by this diff since `decide()`'s
    `IDENTITY_VIOLATION`-only quarantine condition was not touched. Structurally, since
    `should_quarantine`'s condition is a direct `classification is
    Classification.IDENTITY_VIOLATION` check unchanged by the diff, and every genuine-identity
    raise site still raises `TerminalIdentityViolation`, there's no plausible path for this to
    have regressed. Non-blocking note below.

## Rollout risk

- Quarantine records are already manually cleared (per task instruction, not repeated here).
- `restart_count`/`restart_count_window_start_utc` in `bridge/health.py` are keyed per-login,
  not per-classification, and persist across a supervisor restart. A residual restart_count
  from before this deploy (e.g., partial progress toward the old ceiling under the old
  classification) cannot cause a false quarantine post-deploy: `should_quarantine` still
  requires `classification is Classification.IDENTITY_VIOLATION` at evaluation time, and any
  post-deploy transient failure now classifies as `TERMINAL_NOT_READY`, which never satisfies
  that check regardless of the carried-over count. Additionally `restart_window_s` (600s
  default) ages out any stale count within 10 minutes even for a still-IDENTITY_VIOLATION
  account.
- No schema/state-file format change — `WorkerOutcome`/exit-log JSON shape is unchanged aside
  from the new `classification` string value, which is purely additive (no consumer keys off
  an enumerated/closed set of classification strings that would reject an unrecognized one,
  per the code read).
- No FTP/HTML/manual-import path reintroduced; no SQLite journal ownership boundary touched
  by this diff — confirmed the diff has zero references to `BridgeHistoryCheckpoint`,
  `BridgeHistoryChunk`, `BridgeHistoryRecord`, or journal read/write paths.
- No secrets, credentials, or `.env*` files present in the diff (visually confirmed across all
  7 files).

## Checks performed

- `git diff -- bridge/terminal_session.py bridge/exit_codes.py bridge/worker.py bridge/supervisor.py bridge/tests/unit/test_terminal_session.py bridge/tests/unit/test_exit_codes.py bridge/tests/integration/test_supervisor.py` — read in full.
- Read full `bridge/terminal_session.py` (post-diff) to enumerate every raise site and confirm the identity-vs-transient split is exhaustive and correctly scoped.
- Read full `bridge/exit_codes.py` (post-diff) to check for exit-code/classification collisions and confirm `RESTART_POLICY` dict completeness.
- Read full `bridge/restart_policy.py` (unmodified by diff) to confirm `should_quarantine` gates strictly on `Classification.IDENTITY_VIOLATION`, unaffected by the new classification.
- Read `bridge/tests/integration/test_supervisor.py` around the pre-existing `IDENTITY_VIOLATION`-still-quarantines test path (line ~413-438) and confirmed it and `test_restart_policy.py`'s unit coverage for the quarantine-ceiling condition are unmodified by this diff.
- Installed `bridge/requirements-dev.txt` into a throwaway venv (per CLAUDE.md note that these deps aren't in the MetaTrader5/Windows-only `requirements.txt` chain) and ran `python3 -m pytest -q bridge/tests`.
- Result: **396 passed, 4 skipped, 0 failed** (1 pre-existing `PytestUnknownMarkWarning` for `@pytest.mark.integration`, unrelated to this diff).
- Grepped the diff for `BridgeHistoryCheckpoint`/`BridgeHistoryChunk`/`BridgeHistoryRecord`/journal read-write paths — none found.
- Visually scanned all 7 files for hardcoded `REDIS_PASSWORD`/`DATABASE_URL`/`DUCKDNS_TOKEN` or `.env*` additions — none found.

## Required action

None. No fixes required for this diff.

## Findings

**Blocking:** none.

**Non-blocking notes:**
1. No new end-to-end integration test in `test_supervisor.py` directly exercises "N
   consecutive genuine `IDENTITY_VIOLATION` exits still reach quarantine" post-split (the
   existing quarantine-reaching integration test in this file uses `CONFIG_INVALID`, not
   `IDENTITY_VIOLATION`). Coverage for that side currently rests on the unmodified unit test
   `test_restart_policy.py::test_*` at lines 127–170 plus the structural argument (unchanged
   `should_quarantine` condition, unchanged identity-comparison raise sites). This is not a
   regression — behavior is unchanged and provably so — but a future PR could strengthen the
   integration layer by adding an explicit `IDENTITY_VIOLATION`-reaches-quarantine end-to-end
   test to fully close the loop symmetric with the new `TERMINAL_NOT_READY`-never-quarantines
   tests. Suggest, don't block.
