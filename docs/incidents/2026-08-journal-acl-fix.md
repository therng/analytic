# Incident: 2026-08 journal ACL — WAL/SHM sidecar files not re-granted by `/T` recursion

## Impact

`journal_open` failed with a permanent `LOCKED` state on the bridge host —
not a transient/retryable failure, but a permanent one — even though the
journal directory's own ACL looked correct
(`supachai:(OI)(CI)(F)`). This blocks the bridge's SQLite-authoritative
journal (the durable authority for native history progress — see ADR-0001,
ADR-0003) from opening at all, stopping history ingestion cold on the
affected account until manually fixed.

## Detection

Diagnosed on the `forexvps` host: directory-level ACL inspection showed the
correct grant, but the SQLite WAL/SHM sidecar files themselves showed
`AreAccessRulesProtected=True` and `Access.Count=0` — an inheritance-blocked,
zero-ACE DACL that the directory-level `icacls /T` recursion had not
reliably overwritten.

## Root Cause

SQLite deletes and recreates its WAL/SHM sidecar files during normal
operation. A sidecar recreated mid-run can end up with its own
inheritance-blocked, zero-ACE DACL. `icacls /T` on the parent directory is
documented to recurse onto existing files, but in production this did not
reliably re-grant access to sidecars that were deleted/recreated after the
directory-level grant ran — the directory ACL stayed correct while the
sidecar silently lost its grant, and every subsequent `journal_open` attempt
failed `LOCKED` with no transient-retry path, since the ACL fix itself never
re-ran against that specific file.

This was the last of several ACL-hardening attempts in the same area — prior
commits (`1819340`, `c5b9c5e`, `27c81d6`) had already tried directory-level
self-heal on every start and on every `JOURNAL_LOCKED` retry, and `a981445`
had introduced the `/T`-recursion approach specifically to try to cover
existing files — but none of them individually covered a sidecar recreated
*after* the grant ran.

## Resolution

`a3f897a` (2026-08-05) — grant each existing `*.sqlite3*` sidecar file
explicitly by name, in addition to the directory-level grant, rather than
trusting `/T` recursion alone:

```python
# Directory-level grant: covers files created *after* this runs.
# /T is documented to recurse onto existing files too, but in
# practice a WAL/SHM sidecar that SQLite deleted and recreated
# mid-run can end up with its own protected (inheritance-blocked),
# zero-ACE DACL that /T on the directory does not reliably
# overwrite -- observed in production: directory ACL correct,
# sidecar files still had AreAccessRulesProtected=True and
# Access.Count=0 after this call. So grant each existing sidecar
# file explicitly too, below, rather than trusting /T alone.
```

```python
for sidecar in sorted(journal_dir.glob("*.sqlite3*")):
    try:
        subprocess.run(
            ["icacls", str(sidecar), "/inheritance:r", "/grant:r", f"{account}:F"],
            check=True, capture_output=True, timeout=30,
        )
    except Exception as exc:
        print(f"warning: journal ACL self-heal (file grant) failed for {sidecar}: {exc}", file=sys.stderr)
```

One file's grant failure no longer blocks the rest of the sidecars or the
final `/setowner` call — each grant is independent and best-effort per file.

## Prevention

- Regression test added in the same commit:
  `bridge/tests/unit/test_journal_acl_selfheal.py`.
- The fix targets the specific glob pattern (`*.sqlite3*`) so any future
  sidecar SQLite creates (new WAL/SHM generation after a checkpoint) is
  covered on the next self-heal pass, not just the ones that existed when
  the directory grant last ran.
- Deployed as v8.27 to the VPS.

## Evidence

- `a3f897a` (2026-08-05) — "fix(bridge): grant journal ACL sidecar files
  explicitly, not via /T recursion" — files changed:
  `bridge/windows_acl.py` (+35/-6), `bridge/tests/unit/test_journal_acl_selfheal.py`
  (new).
- `a981445` (2026-08-04) — "fix(bridge): recurse ACL fix onto existing
  journal files with /T" — the earlier `/T`-recursion approach this commit
  found insufficient for recreated sidecars.
- `1819340` (2026-08-03) — "fix(bridge): harden journal dir ACL against
  inherited-DACL quarantine loop."
- `c5b9c5e` (2026-08-04) — "fix(bridge): self-heal journal ACL on every
  start, add quarantine clear CLI."
- `27c81d6` (2026-08-04) — "fix(bridge): reapply journal ACL self-heal on
  every JOURNAL_LOCKED retry."
