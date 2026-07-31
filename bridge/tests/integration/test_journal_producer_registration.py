from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from bridge.config import JournalConfig
from bridge.journal.connection import Journal
from bridge.journal.repository import JournalRepository

# ruff: noqa: E501


def utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def open_journal(tmp_path: Path) -> tuple[Journal, JournalRepository]:
    config = JournalConfig.model_construct(
        path=str(tmp_path / "journal.sqlite3"), busy_timeout_ms=321
    )
    journal = Journal.open(config)
    return journal, JournalRepository(journal.connection)


def row_count(journal: Journal, table: str) -> int:
    return journal.connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_fresh_database_registers_profile_and_epoch_before_reserve(tmp_path: Path) -> None:
    journal, repository = open_journal(tmp_path)

    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="digest-1",
        now_utc=utc(),
    )
    repository.register_epoch(
        epoch_id="epoch-1",
        profile_id="profile-a",
        fence_token=1,
        started_at_utc=utc(),
        start_reason="lease_acquired",
    )

    assert row_count(journal, "producer_profiles") == 1
    assert row_count(journal, "producer_epochs") == 1

    sequence = repository.reserve("profile-a", "epoch-1")
    assert sequence == 1


def test_repeated_startup_registration_is_idempotent(tmp_path: Path) -> None:
    journal, repository = open_journal(tmp_path)

    for _ in range(3):
        repository.register_profile(
            profile_id="profile-a",
            login=10001,
            server="Broker-Demo",
            terminal_id="terminal-a",
            config_digest="digest-1",
            now_utc=utc(),
        )
        repository.register_epoch(
            epoch_id="epoch-1",
            profile_id="profile-a",
            fence_token=1,
            started_at_utc=utc(),
            start_reason="lease_acquired",
        )

    assert row_count(journal, "producer_profiles") == 1
    assert row_count(journal, "producer_epochs") == 1

    sequence = repository.reserve("profile-a", "epoch-1")
    assert sequence == 1


def test_reserve_succeeds_and_advances_after_registration(tmp_path: Path) -> None:
    journal, repository = open_journal(tmp_path)
    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="digest-1",
        now_utc=utc(),
    )
    repository.register_epoch(
        epoch_id="epoch-1",
        profile_id="profile-a",
        fence_token=1,
        started_at_utc=utc(),
        start_reason="lease_acquired",
    )

    first = repository.reserve("profile-a", "epoch-1")
    second = repository.reserve("profile-a", "epoch-1")
    third = repository.reserve("profile-a", "epoch-1")

    assert (first, second, third) == (1, 2, 3)


def test_existing_profile_is_not_duplicated_or_corrupted_by_reregistration(
    tmp_path: Path,
) -> None:
    journal, repository = open_journal(tmp_path)
    first_seen = utc()
    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="digest-original",
        now_utc=first_seen,
    )

    later = utc()
    # A later worker restart re-registers under the same profile_id with a
    # different config_digest/terminal_id snapshot -- only last_verified_at_utc
    # is allowed to move; the original identity row must not be overwritten.
    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a-restarted",
        config_digest="digest-changed",
        now_utc=later,
    )

    assert row_count(journal, "producer_profiles") == 1
    row = journal.connection.execute(
        "SELECT terminal_id, config_digest, created_at_utc, last_verified_at_utc "
        "FROM producer_profiles WHERE profile_id = 'profile-a'"
    ).fetchone()
    terminal_id, config_digest, created_at_utc, last_verified_at_utc = row
    assert terminal_id == "terminal-a"
    assert config_digest == "digest-original"
    assert created_at_utc == first_seen
    assert last_verified_at_utc == later


def test_existing_epoch_is_not_duplicated_or_corrupted_by_reregistration(
    tmp_path: Path,
) -> None:
    journal, repository = open_journal(tmp_path)
    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="digest-1",
        now_utc=utc(),
    )
    first_started = utc()
    repository.register_epoch(
        epoch_id="epoch-1",
        profile_id="profile-a",
        fence_token=1,
        started_at_utc=first_started,
        start_reason="lease_acquired",
    )

    # A retried registration for the same epoch_id (e.g. a startup retry
    # before the poll loop began) must be a no-op, not a second row or a
    # silently mutated fence_token/started_at_utc.
    repository.register_epoch(
        epoch_id="epoch-1",
        profile_id="profile-a",
        fence_token=99,
        started_at_utc=utc(),
        start_reason="lease_acquired",
    )

    assert row_count(journal, "producer_epochs") == 1
    row = journal.connection.execute(
        "SELECT fence_token, started_at_utc FROM producer_epochs WHERE epoch_id = 'epoch-1'"
    ).fetchone()
    fence_token, started_at_utc = row
    assert fence_token == 1
    assert started_at_utc == first_started
