from __future__ import annotations

import sqlite3
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


def test_register_profile_returns_requested_id_on_fresh_insert(tmp_path: Path) -> None:
    journal, repository = open_journal(tmp_path)
    returned = repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="digest-1",
        now_utc=utc(),
    )
    assert returned == "profile-a"


def test_register_profile_returns_same_id_on_repeated_registration(tmp_path: Path) -> None:
    """Restart-after-prior-registration: same login, same profile_id,
    called repeatedly (e.g. every worker startup) -- must stay idempotent
    and keep resolving to the one existing row."""
    journal, repository = open_journal(tmp_path)
    returned_ids = [
        repository.register_profile(
            profile_id="profile-a",
            login=10001,
            server="Broker-Demo",
            terminal_id="terminal-a",
            config_digest="digest-1",
            now_utc=utc(),
        )
        for _ in range(3)
    ]
    assert returned_ids == ["profile-a", "profile-a", "profile-a"]
    assert row_count(journal, "producer_profiles") == 1


def test_register_profile_login_conflict_with_different_profile_id_does_not_crash(
    tmp_path: Path,
) -> None:
    """Reproduces the production crash: a login already has a row under an
    old profile_id (e.g. from before an executable_path/server config
    change), and the current run computes a different profile_id for the
    same login. Must not raise sqlite3.IntegrityError."""
    journal, repository = open_journal(tmp_path)
    repository.register_profile(
        profile_id="profile-old",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-old",
        config_digest="digest-old",
        now_utc=utc(),
    )

    returned = repository.register_profile(
        profile_id="profile-new",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-new",
        config_digest="digest-new",
        now_utc=utc(),
    )

    assert returned == "profile-old"  # pre-existing identity wins, not silently swapped


def test_register_profile_login_conflict_preserves_existing_identity_and_durable_state(
    tmp_path: Path,
) -> None:
    journal, repository = open_journal(tmp_path)
    first_seen = utc()
    repository.register_profile(
        profile_id="profile-old",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-old",
        config_digest="digest-old",
        now_utc=first_seen,
    )
    # Durable progress already associated with the old profile_id --
    # must survive the conflicting re-registration untouched.
    journal.connection.execute(
        "INSERT INTO history_checkpoints("
        "profile_id, generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc"
        ") VALUES ('profile-old', 1, 12345, NULL, 1, ?)",
        (first_seen,),
    )
    journal.connection.commit()

    later = utc()
    returned = repository.register_profile(
        profile_id="profile-new",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-new",
        config_digest="digest-new",
        now_utc=later,
    )

    assert returned == "profile-old"
    assert row_count(journal, "producer_profiles") == 1  # no duplicate row
    assert row_count(journal, "history_checkpoints") == 1  # untouched, not orphaned by a PK swap

    row = journal.connection.execute(
        "SELECT profile_id, server, terminal_id, config_digest, created_at_utc, last_verified_at_utc "
        "FROM producer_profiles WHERE login = 7948784"
    ).fetchone()
    profile_id, server, terminal_id, config_digest, created_at_utc, last_verified_at_utc = row
    assert profile_id == "profile-old"  # identity preserved, never swapped in place
    # Safe-to-refresh descriptive fields DO move to the newly observed config.
    assert terminal_id == "terminal-new"
    assert config_digest == "digest-new"
    assert last_verified_at_utc == later
    assert created_at_utc == first_seen  # original registration time untouched

    checkpoint = journal.connection.execute(
        "SELECT next_window_start_raw FROM history_checkpoints WHERE profile_id = 'profile-old'"
    ).fetchone()
    assert checkpoint[0] == 12345  # durable progress intact


def test_register_profile_repeated_login_conflict_is_idempotent(tmp_path: Path) -> None:
    """Restart-after-prior-registration for the drifted-identity case too:
    calling register_profile repeatedly with the SAME new profile_id after
    the first reconciliation must not create additional rows or oscillate."""
    journal, repository = open_journal(tmp_path)
    repository.register_profile(
        profile_id="profile-old",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-old",
        config_digest="digest-old",
        now_utc=utc(),
    )
    for _ in range(3):
        returned = repository.register_profile(
            profile_id="profile-new",
            login=7948784,
            server="ICMarketsSC-MT5-2",
            terminal_id="terminal-new",
            config_digest="digest-new",
            now_utc=utc(),
        )
        assert returned == "profile-old"
    assert row_count(journal, "producer_profiles") == 1


def test_register_profile_near_concurrent_registration_across_connections_does_not_corrupt(
    tmp_path: Path,
) -> None:
    """Two separate connections to the same journal file (the real shape of
    "concurrent" here -- a crashed worker's respawn racing the tail end of
    the previous process, each with its own sqlite3.Connection) registering
    for the same login in quick succession. WAL + busy_timeout serialize
    the writers; this must resolve to exactly one consistent row, never a
    crash or a duplicate."""
    db_path = tmp_path / "journal.sqlite3"
    config = JournalConfig.model_construct(path=str(db_path), busy_timeout_ms=2000)
    journal_a = Journal.open(config)
    repository_a = JournalRepository(journal_a.connection)

    returned_a = repository_a.register_profile(
        profile_id="profile-a",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-a",
        config_digest="digest-a",
        now_utc=utc(),
    )
    journal_a.connection.commit()

    # A second, independent sqlite3 connection to the same file -- the real
    # shape of near-concurrent registration (a respawned worker's own
    # connection racing the tail end of the crashed one), without going
    # through Journal.open()'s ACL check a second time (it validates the
    # file is already restricted-mode, which a bare tmp_path file isn't).
    connection_b = sqlite3.connect(str(db_path), timeout=2.0)
    connection_b.execute("PRAGMA foreign_keys = ON")
    repository_b = JournalRepository(connection_b)
    returned_b = repository_b.register_profile(
        profile_id="profile-b",
        login=7948784,
        server="ICMarketsSC-MT5-2",
        terminal_id="terminal-b",
        config_digest="digest-b",
        now_utc=utc(),
    )
    connection_b.commit()

    assert returned_a == "profile-a"
    assert returned_b == "profile-a"  # second connection reconciles against the first's row

    row = connection_b.execute(
        "SELECT profile_id FROM producer_profiles WHERE login = 7948784"
    ).fetchone()
    assert row[0] == "profile-a"

    journal_a.connection.close()
    connection_b.close()


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
