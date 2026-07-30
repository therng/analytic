from __future__ import annotations

import shutil
import sqlite3
import threading
from queue import Queue
from pathlib import Path

import pytest

from bridge.config import JournalConfig
from bridge.journal import Journal
from bridge.journal.backup import (
    BackupManifest,
    JournalBackupError,
    JournalCheckState,
    backup_journal,
    check_journal,
)


def _open_journal(path: Path) -> Journal:
    config = JournalConfig.model_construct(path=str(path), busy_timeout_ms=321)
    return Journal.open(config)


def test_backup_rejects_a_main_file_copy_from_a_live_wal_journal(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.sqlite"
    copied_main_file = tmp_path / "copied-main.sqlite"
    journal = _open_journal(source)
    journal.connection.execute("CREATE TABLE wal_probe (value INTEGER NOT NULL)")
    journal.connection.execute("INSERT INTO wal_probe(value) VALUES (7)")
    journal.connection.commit()
    assert source.with_name(f"{source.name}-wal").exists()
    shutil.copy2(source, copied_main_file)
    journal.close()

    result = check_journal(copied_main_file, expected_host="host-a")

    assert result.state is not JournalCheckState.READY


def test_online_backup_remains_consistent_while_source_changes(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite"
    destination = tmp_path / "backup.sqlite"
    journal = _open_journal(source)
    journal.connection.execute("CREATE TABLE backup_probe (value INTEGER NOT NULL)")
    journal.connection.executemany(
        "INSERT INTO backup_probe(value) VALUES (?)",
        ((value,) for value in range(20_000)),
    )
    journal.connection.commit()

    writer_ready = threading.Event()
    allow_writer_commit = threading.Event()
    writer_done = threading.Event()

    def mutate_source() -> None:
        connection = sqlite3.connect(source, timeout=5)
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT INTO backup_probe(value) VALUES (20_000)")
            writer_ready.set()
            assert allow_writer_commit.wait(timeout=5)
            connection.commit()
        finally:
            connection.close()
            writer_done.set()

    writer = threading.Thread(target=mutate_source)
    writer.start()
    assert writer_ready.wait(timeout=5)
    try:
        manifest = backup_journal(source, destination)
    finally:
        allow_writer_commit.set()
        writer.join(timeout=5)
        journal.close()

    assert writer_done.is_set()
    assert manifest.page_count > 0
    assert (
        check_journal(destination, expected_host="host-a").state
        is JournalCheckState.READY
    )
    connection = sqlite3.connect(destination)
    try:
        count = connection.execute("SELECT COUNT(*) FROM backup_probe").fetchone()
    finally:
        connection.close()
    assert count == (20_000,)


def test_online_backup_refuses_to_overwrite_existing_destination(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.sqlite"
    destination = tmp_path / "backup.sqlite"
    journal = _open_journal(source)
    journal.close()
    destination.write_bytes(b"do not overwrite")

    with pytest.raises(JournalBackupError, match="destination already exists"):
        backup_journal(source, destination)

    assert destination.read_bytes() == b"do not overwrite"


def test_concurrent_backups_create_the_destination_exclusively(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite"
    destination = tmp_path / "backup.sqlite"
    journal = _open_journal(source)
    journal.close()
    start = threading.Event()
    results: Queue[BackupManifest | JournalBackupError] = Queue()

    def create_backup() -> None:
        assert start.wait(timeout=5)
        try:
            results.put(backup_journal(source, destination))
        except JournalBackupError as error:
            results.put(error)

    first = threading.Thread(target=create_backup)
    second = threading.Thread(target=create_backup)
    first.start()
    second.start()
    start.set()
    first.join(timeout=5)
    second.join(timeout=5)
    outcomes = (results.get(timeout=1), results.get(timeout=1))

    assert sum(isinstance(outcome, BackupManifest) for outcome in outcomes) == 1
    failures = [
        outcome for outcome in outcomes if isinstance(outcome, JournalBackupError)
    ]
    assert len(failures) == 1
    assert str(failures[0]) == "destination already exists"
