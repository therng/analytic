# Bridge Ingestion Review — CI pytest failure root cause

**Status:** fix

**Reviewed scope:** Root-cause investigation only (per task instruction, no code changes made).
CI failure: `bridge/tests/integration/test_published_outbox_replay.py::test_replay_ignores_legacy_published_rows_and_selects_only_native_stream`
Repo: therng/analytic, workflow `.github/workflows/ci.yml`, job `build-and-test`, step `python3 -m pytest -q bridge/tests`.
Commit context: current `main` worktree at the time of investigation (no diff being reviewed; this is a newly-surfaced CI failure now that the earlier `npm test`/Playwright blocker is fixed).

**Reproduced locally** (macOS, default umask 022): same `ValueError: journal path must be restricted to the service identity` at `bridge/journal/connection.py:275`.

## Root cause

`bridge/journal/connection.py:267-275` (`_validate_posix_acl`) requires, for every existing path component (parent dir, and the journal file itself once it exists), that the path is owned by the current euid **and** has no group/other bits set (`mode & (S_IRWXG | S_IRWXO) == 0`).

`Journal.open()` (`connection.py:351-373`) creates the SQLite file via a bare `sqlite3.connect(path, ...)` call. SQLite creates the underlying file using the process's ambient umask (typically `022` on Linux/macOS), producing mode `0o644` — group/other readable. Nothing in `Journal.open()` chmods the newly-created file down to `0o600` afterward.

This is invisible on the *first* open of a path (before the file exists, only the parent directory — which the test creates via `tmp_path`, mode `0700` — is checked). It becomes visible only when a **second** `Journal.open()` call targets the *same, already-existing* file: now `_validate_posix_acl` also checks the file itself, finds mode `0o644`, and raises.

`test_replay_ignores_legacy_published_rows_and_selects_only_native_stream` is the first test in the suite that does exactly this: `_seed_published_journal()` opens+closes the journal once (creating `journal.sqlite3` with default mode), then the test body calls `Journal.open()` again directly on the same path — triggering the bug. Every other existing test (`test_open_rejects_group_writable_journal_parent`, `test_open_rejects_symlinked_journal_path_components`, etc.) only ever opens a path once, so none of them exercise this code path. Confirmed by grep: `bridge/atomic_io.py`, `bridge/ownership.py`, and `bridge/journal/backup.py` all correctly create sensitive files via `os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)`; `connection.py`'s `Journal.open()` is the one place that creates a journal-adjacent file without an explicit restrictive mode.

## Why this passed "locally"/on the Windows service

Production bridge deployment is Windows-only (MetaTrader5 dependency; see CLAUDE.md verification note). On Windows, `_validate_windows_acl` is used instead of `_validate_posix_acl`, and `bridge/scripts/install-service.ps1:73-74` locks down the **journal directory** with `icacls $JournalDir /inheritance:r /grant:r "...:(OI)(CI)F"` — object-inherit + container-inherit flags. Windows ACL inheritance means every *new file* created inside that directory automatically inherits the restrictive DACL, so a freshly-created journal file is secure without any explicit per-file ACL call in `connection.py`. There is no POSIX equivalent relied upon here (no setgid/default-ACL directory setup), so the POSIX branch has no analogous self-healing and was never actually correct — it just was never exercised end-to-end until this CI run, because:
1. Production never runs the POSIX path (Windows-only bridge host).
2. CI never reached `pytest bridge/tests` before (blocked earlier by the missing `npx playwright install` step in `npm test`).
3. No existing test previously reopened an already-created journal file within the same process/path.

## Classification

This is **not** a bug in the ACL check itself (the check correctly enforces "no group/other permission bits"), and **not** a test-fixture problem (pytest's `tmp_path` directory is already `0700`; the file mode is what's wrong, and only production code controls that). It is a **real, previously-latent bug in `Journal.open()`**: it fails to set restrictive file permissions on the SQLite journal file it creates, unlike every other sensitive-file creation path in this codebase (`atomic_io.py`, `ownership.py`, `journal/backup.py`).

Practical impact if this ever ran on a POSIX host in production: a bridge process restart against an existing journal path would fail this same check on `Journal.open()`, because the file it created on first run was never locked down to `0o600`. Currently masked only because production runs on Windows with directory-level ACL inheritance covering it.

## Recommended next step

Fix in `bridge/journal/connection.py`'s `Journal.open()`: create the SQLite file with an explicit restrictive mode before/at the point `sqlite3.connect()` creates it (mirror the `os.open(..., 0o600)` pattern already used in `atomic_io.py` / `ownership.py` / `journal/backup.py` — e.g., pre-create the file via `os.open(path, os.O_CREAT | os.O_EXCL, 0o600)` and close that descriptor before handing the path to `sqlite3.connect`, or `os.chmod(path, 0o600)` immediately after `sqlite3.connect` creates it and before any data is written). This is a `mt5-bridge-engineer` fix, not a test-fixture or ACL-check change — do not loosen `_validate_posix_acl`, and do not skip the test in CI (it is correctly catching a real gap; the earlier three similar tests just never exercised the reopen path).

Also worth a follow-up: audit for any other test that reopens a previously-created journal path (integration tests, `history-checkpoint.integration.test.ts`-adjacent Python fixtures) to confirm this is the only one hitting the gap, once the fix lands.

## Checks performed
- Reproduced the failure locally (macOS, default umask) with the exact same traceback/line.
- Read `_validate_posix_acl`, `_validate_windows_acl`, `_validate_journal_path`, `Journal.open` in full.
- Inspected `bridge/tests/integration/test_published_outbox_replay.py` and `bridge/tests/integration/test_journal_repository.py` to confirm no other test reopens an existing journal path.
- Grepped codebase for existing `os.open(..., 0o600)` restrictive-creation pattern in `atomic_io.py`, `ownership.py`, `journal/backup.py` to confirm the missing pattern in `connection.py`.
- Confirmed via `bridge/scripts/install-service.ps1` that Windows production lockdown is directory-level ACL inheritance, explaining why this was never caught on the real service.

## Missing evidence
- Did not run the failing test directly on an actual GitHub Actions ubuntu-latest runner (relied on local macOS reproduction with matching umask/mode semantics — POSIX semantics are the same mechanism, high confidence this is the identical cause on CI).
- No code changes made per task instruction (root-cause only).

---

# Ingestion Review — bridge/journal/connection.py (working-tree diff)

- status: pass
- reviewed scope: uncommitted working-tree diff to `bridge/journal/connection.py` (+ new test `bridge/tests/integration/test_journal_repository.py::test_open_tightens_new_file_and_wal_sidecar_modes`), base commit `a6c84ba83ddba2dfc6ab21878030f8e74499e5bd` (branch `harness-team-orchestration`)
- reviewer: bridge-ingestion-review skill (read-only)

## Round 1 finding (resolved)

`Journal.open()` originally chmod'd only the main journal file, and did so *before* `_configure_connection()` ran `PRAGMA journal_mode = WAL` — the pragma that creates the `-wal`/`-shm` sidecars. Those sidecars stayed on the permissive umask-derived mode, leaving live, uncommitted journal content readable, echoing the prior recorded bug class (`project_journal_acl_sidecar_fix`: Windows ACL fix previously missed WAL/SHM sidecars).

## Fix verified (`bridge/journal/connection.py:362-378`)

```python
path_existed = path.exists()
connection = sqlite3.connect(path, isolation_level=None)
try:
    if os.name == "posix" and not path_existed:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    _configure_connection(connection, config.busy_timeout_ms)
    if os.name == "posix" and not path_existed:
        for suffix in ("-wal", "-shm"):
            sidecar = path.with_name(path.name + suffix)
            if sidecar.exists():
                os.chmod(sidecar, stat.S_IRUSR | stat.S_IWUSR)
    apply_migrations(connection)
```

- Sidecar chmod now runs after `_configure_connection()` confirms WAL mode is active, i.e. after the sidecars are actually materialized — ordering bug fixed.
- Existence-guarded per suffix, so it tolerates `-shm` not existing yet on some platforms/SQLite builds.
- Same POSIX-only guard and `not path_existed` gate as the main-file chmod, consistent with intent (don't touch pre-existing files whose mode already passed `_validate_posix_acl` on open).
- `_validate_posix_acl` / `_validate_windows_acl` / `_validate_journal_path` remain untouched — no weakening of ACL validation.

## Test coverage verified

`test_open_tightens_new_file_and_wal_sidecar_modes` (`bridge/tests/integration/test_journal_repository.py:138-168`, `skipif(os.name != "posix")`):
- Sets `os.umask(0o022)` before `Journal.open()` so the pre-fix bug would actually reproduce under test.
- Asserts main file mode == 0600.
- Asserts `-wal` exists and mode == 0600.
- Conditionally asserts `-shm` mode == 0600 if present.
- Re-opens the journal a second time and confirms it succeeds — this is the actual regression (`_validate_posix_acl` rejecting a permissive pre-existing file on next open) that motivated the whole change, exercised end-to-end rather than just checking file modes in isolation.

Full suite reported by engineer: 393 passed, 4 skipped (up from 392/4 pre-fix, consistent with the one new test added). Not independently re-run; no reason to doubt the report given the diff is small and additive.

## Outstanding non-blocking observations (informational only, no action required)

- TOCTOU window between `sqlite3.connect()` creating the file and the first `os.chmod()` remains (narrowed vs. pre-fix, not eliminated); acceptable as noted in round 1.
- `path_existed` capture-before-connect race (another actor creating the file in that gap) still only results in over-restriction, not a correctness issue.

## Checks performed

- Re-read updated `Journal.open()` in `bridge/journal/connection.py`.
- Read the new test in full and confirmed it reproduces the pre-fix bug scenario (umask 0o022) and asserts the actual regression condition (second `Journal.open()` success), not just file modes.
- Confirmed ordering: sidecar chmod now runs strictly after `_configure_connection()`.
- Did not independently re-run `bridge/tests`; relied on engineer-reported 393 passed, 4 skipped.
