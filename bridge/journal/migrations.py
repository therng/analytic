from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

# ruff: noqa: E501


@dataclass(frozen=True)
class Migration:
    version: int
    filename: str
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def _default_migrations() -> tuple[Migration, ...]:
    directory = Path(__file__).with_name("migrations")
    files = sorted(directory.glob("[0-9][0-9][0-9]_*.sql"))
    return tuple(
        Migration(int(path.name[:3]), path.name, path.read_text(encoding="utf-8"))
        for path in files
    )


def _now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _execute_script(connection: sqlite3.Connection, script: str) -> None:
    """Execute complete SQLite statements without `executescript` implicit commits."""
    statement = ""
    for character in script:
        statement += character
        if sqlite3.complete_statement(statement):
            connection.execute(statement)
            statement = ""
    if statement.strip():
        raise ValueError("migration ends with an incomplete SQL statement")


def verify_migrations(
    connection: sqlite3.Connection,
    migrations: Sequence[Migration] | None = None,
) -> int:
    """Verify a complete, known migration set without changing the journal."""
    selected = tuple(migrations) if migrations is not None else _default_migrations()
    expected = {migration.version: migration for migration in selected}
    if len(expected) != len(selected):
        raise ValueError("migration versions must be unique")
    existing_table = connection.execute(
        "SELECT 1 FROM sqlite_master "
        "WHERE type = 'table' AND name = 'schema_migrations'"
    ).fetchone()
    if existing_table is None:
        raise ValueError("journal schema migration table is missing")
    applied = {
        int(row[0]): str(row[1])
        for row in connection.execute("SELECT version, checksum FROM schema_migrations")
    }
    unknown = set(applied) - set(expected)
    if unknown:
        raise ValueError("unknown or newer schema migration")
    for version, checksum in applied.items():
        if checksum != expected[version].checksum:
            raise ValueError(f"migration checksum mismatch for version {version}")
    if set(applied) != set(expected):
        raise ValueError("journal schema migration is incomplete")
    return max(applied, default=0)


def apply_migrations(
    connection: sqlite3.Connection,
    migrations: Sequence[Migration] | None = None,
) -> None:
    """Apply ordered, checksummed migrations under SQLite's exclusive lock."""
    selected = tuple(migrations) if migrations is not None else _default_migrations()
    expected = {migration.version: migration for migration in selected}
    if len(expected) != len(selected):
        raise ValueError("migration versions must be unique")

    connection.execute("BEGIN EXCLUSIVE")
    try:
        existing_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        ).fetchone()
        if existing_table is not None:
            applied = {
                int(row[0]): str(row[1])
                for row in connection.execute(
                    "SELECT version, checksum FROM schema_migrations"
                )
            }
            unknown = set(applied) - set(expected)
            if unknown:
                raise ValueError("unknown or newer schema migration")
            for version, checksum in applied.items():
                if checksum != expected[version].checksum:
                    raise ValueError(
                        f"migration checksum mismatch for version {version}"
                    )
        else:
            applied = {}
            connection.execute(
                "CREATE TABLE schema_migrations ("
                "version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at_utc TEXT NOT NULL)"
            )

        for migration in selected:
            if migration.version in applied:
                continue
            _execute_script(connection, migration.sql)
            connection.execute(
                "INSERT INTO schema_migrations(version, checksum, applied_at_utc) VALUES (?, ?, ?)",
                (migration.version, migration.checksum, _now_utc()),
            )
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
