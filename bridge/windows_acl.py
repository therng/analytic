from __future__ import annotations

import os
import sys
from pathlib import Path


def ensure_windows_journal_acl(state_dir: Path) -> None:
    """journal/connection.py's _validate_windows_acl requires the journal
    dir's DACL to be protected (inheritance broken) and restricted to the
    service account SID, or every account quarantines with journal_failure
    even though the directory is real and readable. install-service.ps1
    applies this once at install time, but any process that recreates a
    journal file at runtime (fresh host, reset-history, deleted state,
    nssm restart after a deletion, or -- the case this exists for -- a
    WAL/SHM sidecar SQLite deletes and recreates on every checkpoint)
    reinherits the parent ACL and silently reintroduces the bug. A service
    process (unlike an interactive session) can create these new files
    owned by BUILTIN\\Administrators with inheritance blocked even when
    running as a plain user in that group, so this must be reapplied on
    every LOCKED retry, not just once at startup. Best-effort;
    _validate_windows_acl is the fail-closed backstop if this can't run
    (e.g. non-admin account)."""
    if os.name != "nt":
        return
    journal_dir = state_dir / "journal"
    journal_dir.mkdir(parents=True, exist_ok=True)
    account = os.environ.get("USERNAME", "")
    if not account:
        return
    import subprocess

    try:
        # /T recurses onto existing *.sqlite3(-wal/-shm) files -- /grant:r
        # on the directory alone only sets the inheritable ACE for files
        # created *after* this runs, and WAL/SHM sidecars are recreated
        # mid-run, not just at process start.
        subprocess.run(
            [
                "icacls",
                str(journal_dir),
                "/inheritance:r",
                "/grant:r",
                f"{account}:(OI)(CI)F",
                "/T",
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        subprocess.run(
            ["icacls", str(journal_dir), "/setowner", account, "/T"],
            check=True,
            capture_output=True,
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001 - best-effort, validator backstops it
        print(f"warning: journal ACL self-heal failed: {exc}", file=sys.stderr)
