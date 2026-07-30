from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import pytest

from mt5_bridge_native.journal.migrations import Migration, apply_migrations

# ruff: noqa: E501


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    return connection


def test_migrations_install_full_schema_with_checked_checksum(tmp_path: Path) -> None:
    connection = connect(tmp_path / "journal.sqlite3")

    apply_migrations(connection)

    migration = connection.execute(
        "SELECT version, checksum FROM schema_migrations"
    ).fetchone()
    assert migration is not None
    assert migration["version"] == 1
    assert (
        migration["checksum"]
        == hashlib.sha256(
            (
                # parents[2]: tests/unit/test_journal_migrations.py -> mt5_bridge_native
                Path(__file__).parents[2]
                / "journal"
                / "migrations"
                / "001_initial.sql"
            ).read_bytes()
        ).hexdigest()
    )
    tables = {
        row["name"]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    assert {
        "producer_profiles",
        "producer_epochs",
        "login_locks",
        "history_checkpoints",
        "history_windows",
        "history_record_versions",
        "history_window_records",
        "outbox_messages",
        "live_sequences",
        "failure_events",
    } <= tables


def test_migrations_refuse_checksum_drift_and_unknown_versions(tmp_path: Path) -> None:
    path = tmp_path / "journal.sqlite3"
    connection = connect(path)
    apply_migrations(connection)
    connection.execute("UPDATE schema_migrations SET checksum = 'tampered'")
    connection.commit()

    with pytest.raises(ValueError, match="checksum"):
        apply_migrations(connection)

    connection.execute("UPDATE schema_migrations SET checksum = ?", ("a" * 64,))
    connection.execute(
        "INSERT INTO schema_migrations(version, checksum, applied_at_utc) VALUES (2, ?, '2026-01-01T00:00:00Z')",
        ("b" * 64,),
    )
    connection.commit()

    with pytest.raises(ValueError, match="unknown or newer"):
        apply_migrations(connection)


def test_interrupted_migration_rolls_back_schema_and_migration_marker(
    tmp_path: Path,
) -> None:
    connection = connect(tmp_path / "journal.sqlite3")
    broken = Migration(
        version=1,
        filename="001_broken.sql",
        sql="CREATE TABLE should_not_exist (id INTEGER); INVALID SQL;",
    )

    with pytest.raises(sqlite3.OperationalError):
        apply_migrations(connection, migrations=(broken,))

    assert (
        connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'"
        ).fetchone()
        is None
    )
    assert (
        connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        ).fetchone()
        is None
    )


def test_migration_lock_refuses_a_concurrent_writer(tmp_path: Path) -> None:
    path = tmp_path / "journal.sqlite3"
    first = connect(path)
    second = connect(path)
    second.execute("PRAGMA busy_timeout = 1")
    first.execute("BEGIN IMMEDIATE")

    with pytest.raises(sqlite3.OperationalError, match="locked"):
        apply_migrations(second)

    first.rollback()


def test_migration_sql_accepts_semicolons_inside_valid_string_literals(
    tmp_path: Path,
) -> None:
    connection = connect(tmp_path / "journal.sqlite3")
    migration = Migration(
        version=1,
        filename="001_quoted.sql",
        sql="CREATE TABLE quoted (value TEXT); INSERT INTO quoted VALUES ('one;two');",
    )

    apply_migrations(connection, migrations=(migration,))

    assert connection.execute("SELECT value FROM quoted").fetchone()[0] == "one;two"


def test_migration_installs_every_declared_foreign_key_and_unique_key(
    tmp_path: Path,
) -> None:
    connection = connect(tmp_path / "journal.sqlite3")
    apply_migrations(connection)

    expected_foreign_keys = {
        "producer_epochs": {"producer_profiles"},
        "history_checkpoints": {"producer_profiles"},
        "history_windows": {"producer_profiles"},
        "history_record_versions": {"producer_profiles", "history_record_versions"},
        "history_window_records": {"history_windows", "history_record_versions"},
        "outbox_messages": {"history_windows", "producer_profiles"},
        "live_sequences": {"producer_profiles", "producer_epochs"},
        "failure_events": {"producer_profiles"},
    }
    for table, expected in expected_foreign_keys.items():
        actual = {
            row[2] for row in connection.execute(f"PRAGMA foreign_key_list({table})")
        }
        assert actual == expected

    expected_unique_columns = {
        "producer_profiles": {("login",)},
        "history_windows": {
            ("profile_id", "generation", "start_raw", "end_raw", "window_revision"),
        },
        "history_record_versions": {
            ("event_id",),
            ("profile_id", "resource", "natural_id", "payload_digest"),
        },
        "history_window_records": {("window_id", "record_version_id")},
    }
    for table, expected in expected_unique_columns.items():
        unique_indexes = {
            tuple(
                row[2] for row in connection.execute(f"PRAGMA index_info({index[1]})")
            )
            for index in connection.execute(f"PRAGMA index_list({table})")
            if index[2]
        }
        assert expected <= unique_indexes
