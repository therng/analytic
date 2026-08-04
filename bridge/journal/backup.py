from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path

from bridge.journal.migrations import verify_migrations


class JournalCheckState(StrEnum):
    READY = "ready"
    MISSING_NEW = "missing_new"
    MISSING_AFTER_USE = "missing_after_use"
    LOCKED = "locked"
    CORRUPT = "corrupt"
    INCOMPATIBLE = "incompatible"


@dataclass(frozen=True)
class JournalCheckResult:
    state: JournalCheckState
    schema_version: int | None = None


@dataclass(frozen=True)
class BackupManifest:
    source_path: Path
    destination_path: Path
    completed_at_utc: str
    page_count: int
    schema_version: int


class JournalBackupError(RuntimeError):
    pass


class JournalRecoveryError(RuntimeError):
    def __init__(self, message: str, *, state: JournalCheckState) -> None:
        super().__init__(message)
        self.state = state


def journal_host_sentinel(path: str | Path) -> Path:
    journal_path = Path(path)
    return journal_path.with_name(f"{journal_path.name}.host")


def _migration_version(connection: sqlite3.Connection) -> int:
    return verify_migrations(connection)


def _matches_expected_host(path: Path, expected_host: str | None) -> bool:
    sentinel = journal_host_sentinel(path)
    if not sentinel.exists():
        return True
    if sentinel.is_symlink() or not sentinel.is_file():
        return False
    try:
        host = sentinel.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return bool(host) if expected_host is None else host == expected_host


def _missing_result(path: Path, expected_host: str | None) -> JournalCheckResult:
    sentinel = journal_host_sentinel(path)
    if not sentinel.exists():
        return JournalCheckResult(JournalCheckState.MISSING_NEW)
    if not _matches_expected_host(path, expected_host):
        return JournalCheckResult(JournalCheckState.INCOMPATIBLE)
    return JournalCheckResult(JournalCheckState.MISSING_AFTER_USE)


def _is_ok(result: tuple[object, ...] | None) -> bool:
    return result is not None and len(result) == 1 and result[0] == "ok"


def _is_lock_contention_message(message: str) -> bool:
    lowered = message.casefold()
    return any(
        marker in lowered
        for marker in ("locked", "busy", "unable to open database file")
    )


def _page_count(path: Path) -> int:
    connection = sqlite3.connect(path)
    try:
        row = connection.execute("PRAGMA page_count").fetchone()
        if row is None:
            raise JournalBackupError("backup destination page count is unavailable")
        return int(row[0])
    finally:
        connection.close()


def _reserve_backup_destination(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise JournalBackupError("destination already exists") from error
    except OSError as error:
        raise JournalBackupError("destination cannot be reserved") from error
    os.close(descriptor)


def check_journal(
    path: str | Path,
    expected_host: str | None,
    *,
    require_exclusive: bool = True,
) -> JournalCheckResult:
    """Classify journal recovery state without creating, deleting, or migrating it."""
    journal_path = Path(path)
    if not journal_path.is_absolute():
        raise ValueError("journal path must be absolute")
    if expected_host is not None and not expected_host.strip():
        raise ValueError("expected_host must be non-empty when supplied")
    if not journal_path.exists():
        return _missing_result(journal_path, expected_host)
    if journal_path.is_symlink() or not journal_path.is_file():
        return JournalCheckResult(JournalCheckState.CORRUPT)
    if not _matches_expected_host(journal_path, expected_host):
        return JournalCheckResult(JournalCheckState.INCOMPATIBLE)

    connection: sqlite3.Connection | None = None
    try:
        mode = "rw" if require_exclusive else "ro"
        connection = sqlite3.connect(
            f"{journal_path.as_uri()}?mode={mode}",
            uri=True,
            isolation_level=None,
            timeout=0,
        )
        connection.execute("PRAGMA busy_timeout = 0")
        if require_exclusive:
            connection.execute("BEGIN IMMEDIATE")
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        integrity_check = connection.execute("PRAGMA integrity_check").fetchone()
        if not _is_ok(quick_check) or not _is_ok(integrity_check):
            return JournalCheckResult(JournalCheckState.CORRUPT)
        return JournalCheckResult(
            JournalCheckState.READY,
            schema_version=_migration_version(connection),
        )
    except sqlite3.OperationalError as error:
        if _is_lock_contention_message(str(error)):
            return JournalCheckResult(JournalCheckState.LOCKED)
        return JournalCheckResult(JournalCheckState.CORRUPT)
    except PermissionError:
        # Windows sharing violation (e.g. AV scan, another handle mid-close):
        # the file is exclusively held, not corrupt.
        return JournalCheckResult(JournalCheckState.LOCKED)
    except (sqlite3.DatabaseError, OSError):
        return JournalCheckResult(JournalCheckState.CORRUPT)
    except ValueError:
        return JournalCheckResult(JournalCheckState.INCOMPATIBLE)
    finally:
        if connection is not None:
            if connection.in_transaction:
                connection.rollback()
            connection.close()


def backup_journal(source: str | Path, destination: str | Path) -> BackupManifest:
    """Create a verified SQLite online backup without overwriting evidence."""
    source_path = Path(source)
    destination_path = Path(destination)
    if not source_path.is_absolute() or not destination_path.is_absolute():
        raise ValueError("journal backup paths must be absolute")
    if not destination_path.parent.is_dir():
        raise JournalBackupError("destination parent is unavailable")
    _reserve_backup_destination(destination_path)
    source_check = check_journal(
        source_path, expected_host=None, require_exclusive=False
    )
    if source_check.state is not JournalCheckState.READY:
        raise JournalBackupError(f"source journal is not ready: {source_check.state}")

    source_connection: sqlite3.Connection | None = None
    destination_connection: sqlite3.Connection | None = None
    try:
        source_connection = sqlite3.connect(
            f"{source_path.as_uri()}?mode=ro", uri=True, timeout=0
        )
        destination_connection = sqlite3.connect(destination_path)
        source_connection.backup(destination_connection, pages=64, sleep=0.001)
        destination_connection.commit()
    except (sqlite3.DatabaseError, OSError) as error:
        raise JournalBackupError("online journal backup failed") from error
    finally:
        if destination_connection is not None:
            destination_connection.close()
        if source_connection is not None:
            source_connection.close()

    destination_check = check_journal(destination_path, expected_host=None)
    if destination_check.state is not JournalCheckState.READY:
        raise JournalBackupError("backup destination validation failed")
    return BackupManifest(
        source_path=source_path,
        destination_path=destination_path,
        completed_at_utc=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        page_count=_page_count(destination_path),
        schema_version=destination_check.schema_version or 0,
    )
