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
