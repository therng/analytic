from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from bridge.config import JournalConfig
from bridge.journal.connection import Journal
from bridge.journal.repository import CheckpointConflict, JournalRepository


PROFILE_ID = "profile-a"
BOUND = 1_735_689_600


def open_repository(tmp_path: Path) -> tuple[Journal, JournalRepository]:
    journal = Journal.open(
        JournalConfig.model_construct(
            path=str(tmp_path / "journal.sqlite3"), busy_timeout_ms=321
        )
    )
    repository = JournalRepository(journal.connection)
    repository.register_profile(
        profile_id=PROFILE_ID,
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="config-a",
        now_utc="2026-08-01T00:00:00Z",
    )
    return journal, repository


def insert_checkpoint(
    connection: sqlite3.Connection,
    start_raw: int,
    *,
    last_window_id: str | None = None,
) -> None:
    connection.execute(
        "INSERT INTO history_checkpoints("
        "profile_id, generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc"
        ") VALUES (?, 7, ?, ?, 3, '2026-07-31T00:00:00Z')",
        (PROFILE_ID, start_raw, last_window_id),
    )


def insert_window(
    connection: sqlite3.Connection,
    *,
    window_id: str = "window-a",
    start_raw: int,
    end_raw: int,
    deal_count: int = 0,
    order_count: int = 0,
) -> None:
    connection.execute(
        "INSERT INTO history_windows("
        "window_id, profile_id, generation, window_revision, start_raw, end_raw, state, "
        "deal_count, order_count, deal_digest, order_digest, window_digest, "
        "observed_started_at_utc, observed_finished_at_utc, committed_at_utc"
        ") VALUES (?, ?, 7, 1, ?, ?, 'COMMITTED', ?, ?, 'd', 'o', 'w', "
        "'2026-07-31T00:00:00Z', '2026-07-31T00:01:00Z', '2026-07-31T00:02:00Z')",
        (window_id, PROFILE_ID, start_raw, end_raw, deal_count, order_count),
    )


def insert_record_outbox(
    connection: sqlite3.Connection,
    *,
    state: str,
    message_type: str = "history.deal",
) -> None:
    insert_window(connection, start_raw=BOUND - 200, end_raw=BOUND - 100)
    connection.execute(
        "INSERT INTO outbox_messages("
        "event_id, window_id, profile_id, stream_key, envelope_json, payload_digest, state, attempt_count, next_attempt_at_utc"
        ") VALUES ('event-a', 'window-a', ?, 'stream', ?, 'digest', ?, 0, '2026-07-31T00:00:00Z')",
        (PROFILE_ID, json.dumps({"message_type": message_type}).encode(), state),
    )


def checkpoint_row(connection: sqlite3.Connection) -> tuple[object, ...] | None:
    row = connection.execute(
        "SELECT generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc "
        "FROM history_checkpoints WHERE profile_id = ?",
        (PROFILE_ID,),
    ).fetchone()
    return tuple(row) if row is not None else None


def test_recovery_noops_without_checkpoint_or_when_checkpoint_is_at_bound(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    assert repository.recover_history_lower_bound(PROFILE_ID, BOUND, "2026-08-01T01:02:03Z") is False

    insert_checkpoint(journal.connection, BOUND)
    before = checkpoint_row(journal.connection)
    assert repository.recover_history_lower_bound(PROFILE_ID, BOUND, "2026-08-01T01:02:03Z") is False
    assert checkpoint_row(journal.connection) == before
    journal.close()


def test_recovery_resets_only_checkpoint_after_verified_backup(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    insert_checkpoint(journal.connection, BOUND - 300, last_window_id="window-a")
    insert_window(journal.connection, start_raw=BOUND - 300, end_raw=BOUND - 100)
    journal.connection.commit()

    backup = journal.path.with_name(
        f"{journal.path.name}.history-lower-bound.20260801T010203Z.bak"
    )
    assert repository.recover_history_lower_bound(
        PROFILE_ID,
        BOUND,
        "2026-08-01T01:02:03Z",
        journal_path=journal.path,
    ) is True

    assert backup.exists()
    with sqlite3.connect(backup) as backup_connection:
        assert checkpoint_row(backup_connection) == (
            7,
            BOUND - 300,
            "window-a",
            3,
            "2026-07-31T00:00:00Z",
        )
    assert checkpoint_row(journal.connection) == (
        7,
        BOUND,
        None,
        3,
        "2026-08-01T01:02:03Z",
    )
    assert journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0] == 1
    journal.close()


@pytest.mark.parametrize(
    ("start_raw", "end_raw", "deal_count", "order_count", "match"),
    (
        (BOUND - 100, BOUND + 1, 0, 0, "crosses"),
        (BOUND - 100, BOUND, 1, 0, "non-empty"),
        (BOUND - 100, BOUND, 0, 1, "non-empty"),
    ),
)
def test_recovery_rejects_unprovable_or_nonempty_pre_bound_windows(
    tmp_path: Path,
    start_raw: int,
    end_raw: int,
    deal_count: int,
    order_count: int,
    match: str,
) -> None:
    journal, repository = open_repository(tmp_path)
    insert_checkpoint(journal.connection, BOUND - 200)
    insert_window(
        journal.connection,
        start_raw=start_raw,
        end_raw=end_raw,
        deal_count=deal_count,
        order_count=order_count,
    )
    journal.connection.commit()
    before = checkpoint_row(journal.connection)

    with pytest.raises(RuntimeError, match=match):
        repository.recover_history_lower_bound(
            PROFILE_ID,
            BOUND,
            "2026-08-01T01:02:03Z",
            journal_path=journal.path,
        )

    assert checkpoint_row(journal.connection) == before
    journal.close()


@pytest.mark.parametrize("state", ("PENDING", "INFLIGHT", "QUARANTINED"))
def test_recovery_rejects_unresolved_record_outbox(
    tmp_path: Path, state: str
) -> None:
    journal, repository = open_repository(tmp_path)
    insert_checkpoint(journal.connection, BOUND - 200)
    insert_record_outbox(journal.connection, state=state)
    journal.connection.commit()
    before = checkpoint_row(journal.connection)

    with pytest.raises(RuntimeError, match="outbox"):
        repository.recover_history_lower_bound(
            PROFILE_ID,
            BOUND,
            "2026-08-01T01:02:03Z",
            journal_path=journal.path,
        )

    assert checkpoint_row(journal.connection) == before
    journal.close()


def test_recovery_backup_failure_and_cas_conflict_leave_checkpoint_unchanged(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    insert_checkpoint(journal.connection, BOUND - 200)
    before = checkpoint_row(journal.connection)

    with pytest.raises(RuntimeError, match="backup failed"):
        repository.recover_history_lower_bound(
            PROFILE_ID,
            BOUND,
            "2026-08-01T01:02:03Z",
            journal_path=journal.path,
            backup=lambda _source, _destination: (_ for _ in ()).throw(
                RuntimeError("backup failed")
            ),
        )
    assert checkpoint_row(journal.connection) == before

    repository.failure_injector = lambda label: (
        journal.connection.execute(
            "UPDATE history_checkpoints SET updated_at_utc = 'raced' WHERE profile_id = ?",
            (PROFILE_ID,),
        )
        if label == "before_history_lower_bound_begin"
        else None
    )
    with pytest.raises(CheckpointConflict):
        repository.recover_history_lower_bound(
            PROFILE_ID,
            BOUND,
            "2026-08-01T01:02:03Z",
            journal_path=journal.path,
        )
    assert checkpoint_row(journal.connection) == (7, BOUND - 200, None, 3, "raced")
    journal.close()
