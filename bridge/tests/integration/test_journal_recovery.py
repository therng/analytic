from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from bridge.config import JournalConfig
from bridge.journal import Journal
from bridge.journal.backup import (
    JournalCheckState,
    check_journal,
    journal_host_sentinel,
)


def _open_journal(path: Path) -> Journal:
    config = JournalConfig.model_construct(path=str(path), busy_timeout_ms=321)
    return Journal.open(config)


def test_missing_journal_with_matching_prior_use_sentinel_blocks_recreation(
    tmp_path: Path,
) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal_host_sentinel(journal_path).write_text("host-a\n", encoding="utf-8")

    result = check_journal(journal_path, expected_host="host-a")

    assert result.state is JournalCheckState.MISSING_AFTER_USE
    assert not journal_path.exists()


def test_open_refuses_to_recreate_a_journal_with_prior_use_evidence(
    tmp_path: Path,
) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal_host_sentinel(journal_path).write_text("host-a\n", encoding="utf-8")
    config = JournalConfig.model_construct(
        path=str(journal_path), busy_timeout_ms=321, expected_host="host-a"
    )

    with pytest.raises(RuntimeError, match="missing_after_use"):
        Journal.open(config)

    assert not journal_path.exists()


def test_missing_journal_without_prior_use_evidence_is_classified_as_new(
    tmp_path: Path,
) -> None:
    journal_path = tmp_path / "journal.sqlite"

    result = check_journal(journal_path, expected_host="host-a")

    assert result.state is JournalCheckState.MISSING_NEW
    assert not journal_path.exists()


def test_journal_with_wrong_host_sentinel_is_incompatible(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal = _open_journal(journal_path)
    journal.close()
    journal_host_sentinel(journal_path).write_text("host-b\n", encoding="utf-8")

    result = check_journal(journal_path, expected_host="host-a")

    assert result.state is JournalCheckState.INCOMPATIBLE


def test_corrupt_journal_is_preserved_and_quarantined(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal_path.write_bytes(b"not a sqlite database")

    result = check_journal(journal_path, expected_host="host-a")

    assert result.state is JournalCheckState.CORRUPT
    assert journal_path.read_bytes() == b"not a sqlite database"


@pytest.mark.parametrize(
    "statement",
    (
        "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1",
        "INSERT INTO schema_migrations(version, checksum, applied_at_utc) "
        "VALUES (99, 'future', '2026-01-01T00:00:00Z')",
    ),
)
def test_checksum_drift_or_newer_schema_is_incompatible(
    tmp_path: Path, statement: str
) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal = _open_journal(journal_path)
    journal.connection.execute(statement)
    journal.connection.commit()
    journal.close()

    result = check_journal(journal_path, expected_host="host-a")

    assert result.state is JournalCheckState.INCOMPATIBLE


def test_locked_journal_reports_locked_without_modifying_it(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal = _open_journal(journal_path)
    journal.connection.execute("BEGIN EXCLUSIVE")
    try:
        result = check_journal(journal_path, expected_host="host-a")
    finally:
        journal.connection.rollback()
        journal.close()

    assert result.state is JournalCheckState.LOCKED


def test_wal_recovery_is_validated_before_reporting_ready(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite"
    journal = _open_journal(journal_path)
    journal.connection.execute("CREATE TABLE recovery_probe (value INTEGER NOT NULL)")
    journal.connection.execute("INSERT INTO recovery_probe(value) VALUES (42)")
    journal.connection.commit()
    assert journal_path.with_name(f"{journal_path.name}-wal").exists()

    result = check_journal(journal_path, expected_host="host-a")

    assert result.state is JournalCheckState.READY
    try:
        connection = sqlite3.connect(journal_path)
        assert (
            connection.execute("SELECT value FROM recovery_probe").fetchone()
            == (42,)
        )
    finally:
        connection.close()
        journal.close()
