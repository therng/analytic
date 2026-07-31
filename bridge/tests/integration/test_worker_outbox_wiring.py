from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

from bridge.exit_codes import WorkerExitCode
from bridge.journal.migrations import apply_migrations
from bridge.journal.repository import JournalRepository
from bridge.outbox_dispatcher import OutboxDispatchConfig
from bridge.ownership import LocalLoginLock
from bridge.redis_transport import FenceCredential
from bridge.worker import WorkerRuntimeConfig, run_worker

# ruff: noqa: E501

ACCOUNT_JSON = {
    "executable_path": "C:\\MT5\\terminal64.exe",
    "portable": True,
    "expected_data_path": "C:\\MT5\\data",
    "expected_login": 20001,
    "expected_server": "Broker-Demo",
    "initialize_timeout_ms": 5000,
    "coordination_domain": "default",
    "history_lower_bound_raw": 0,
    "journal_path": "C:\\MT5\\journal.sqlite3",
}


class FakeLease:
    """Satisfies both run_worker's `lease` dependency (acquire/renew/
    release) and, by default, the outbox dispatcher's transport dependency
    (append_stream_fenced) -- exactly like the real RedisLease does in
    production, where `lease` doubles as the default `outbox_transport`."""

    def __init__(self) -> None:
        self.published: list[str] = []
        self.released: list[FenceCredential] = []

    def acquire(self, login: int, owner_id: str, producer_epoch_id: str, ttl_ms: int) -> FenceCredential:
        return FenceCredential(login, owner_id, producer_epoch_id, "coord-1", 1)

    def renew(self, credential: FenceCredential, ttl_ms: int) -> bool:
        return True

    def release(self, credential: FenceCredential) -> None:
        self.released.append(credential)

    def append_stream_fenced(self, credential: FenceCredential, event_id: str, envelope: bytes) -> str:
        self.published.append(event_id)
        return "1-1"


class FakeTerminalSession:
    def connect_verified(self, profile: object) -> SimpleNamespace:
        return SimpleNamespace(profile=profile)

    def revalidate(self, verified: object) -> None:
        pass


def make_fake_journal(tmp_path: Path) -> tuple[sqlite3.Connection, SimpleNamespace]:
    connection = sqlite3.connect(str(tmp_path / "journal.sqlite3"), isolation_level=None)
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA foreign_keys = ON")
    apply_migrations(connection)
    journal = SimpleNamespace(connection=connection, close=connection.close)
    return connection, journal


def test_run_worker_starts_and_cleanly_stops_outbox_dispatcher(tmp_path: Path) -> None:
    """Wiring-level regression test for requirement 7 (§11 integration into
    the worker entrypoint): passing outbox_repository must not crash
    run_worker's startup/shutdown sequence, and the shared lease_lost Event
    must actually be the same object LeaseRenewalThread and
    OutboxDispatchThread both observe."""
    account_dir = tmp_path / "accounts"
    account_dir.mkdir()
    account_path = account_dir / "20001.json"
    account_path.write_text(json.dumps(ACCOUNT_JSON), encoding="utf-8")
    (tmp_path / "locks").mkdir()

    connection, journal = make_fake_journal(tmp_path)
    outbox_repository = JournalRepository(connection)

    runtime_config = WorkerRuntimeConfig(
        owner_id="worker-a",
        lease_ttl_ms=15000,
        lease_renew_interval_ms=5000,
        lease_watchdog_margin_s=2.0,
        revalidate_every_n_polls=1,
        live_poll_s=0.01,
        history_poll_s=0.01,
    )

    outcome = run_worker(
        config_path=account_path,
        runtime_config=runtime_config,
        local_lock=LocalLoginLock(tmp_path / "locks"),
        journal_open=lambda _config: journal,
        lease=FakeLease(),
        terminal_session=FakeTerminalSession(),
        poll_live=lambda: None,
        poll_history=lambda: None,
        now_s=0.0,
        max_history_skew_s=86400,
        producer_epoch_id="epoch-1",
        max_poll_cycles=1,
        parent_pid_check=None,
        outbox_repository=outbox_repository,
        outbox_config=OutboxDispatchConfig(dispatch_interval_s=999.0),
    )

    assert outcome.exit_code is WorkerExitCode.CLEAN_SHUTDOWN
    connection.close()


def test_run_worker_unwinds_cleanup_when_poll_callables_factory_raises(tmp_path: Path) -> None:
    """Regression for the gap that sustained tonight's crash loop: Step 6's
    poll_callables_factory call (register_profile/register_epoch/session
    wiring) previously had no try/except, so any exception there --
    including the sqlite3.IntegrityError this incident hit -- escaped
    run_worker entirely and skipped cleanup.unwind(). The local lock file
    and the Redis lease were never released, so the next respawn attempt
    bounced off its own stranded lease/lock as DUPLICATE_OWNERSHIP instead
    of retrying cleanly."""
    account_dir = tmp_path / "accounts"
    account_dir.mkdir()
    account_path = account_dir / "20001.json"
    account_path.write_text(json.dumps(ACCOUNT_JSON), encoding="utf-8")
    locks_dir = tmp_path / "locks"
    locks_dir.mkdir()

    _connection, journal = make_fake_journal(tmp_path)
    lease = FakeLease()

    def raising_factory(verified: object, credential: object) -> None:
        raise sqlite3.IntegrityError("UNIQUE constraint failed: producer_profiles.login")

    runtime_config = WorkerRuntimeConfig(
        owner_id="worker-a",
        lease_ttl_ms=15000,
        lease_renew_interval_ms=5000,
        lease_watchdog_margin_s=2.0,
        revalidate_every_n_polls=1,
        live_poll_s=0.01,
        history_poll_s=0.01,
    )

    outcome = run_worker(
        config_path=account_path,
        runtime_config=runtime_config,
        local_lock=LocalLoginLock(locks_dir),
        journal_open=lambda _config: journal,
        lease=lease,
        terminal_session=FakeTerminalSession(),
        poll_callables_factory=raising_factory,
        now_s=0.0,
        max_history_skew_s=86400,
        producer_epoch_id="epoch-1",
        max_poll_cycles=1,
        parent_pid_check=None,
    )

    assert outcome.exit_code is WorkerExitCode.UNEXPECTED_FATAL
    assert "producer_profiles.login" in outcome.detail
    # cleanup.unwind() must have run: the local lock file this worker
    # acquired at Step 2 is gone, so the immediate respawn can acquire it
    # again instead of bouncing off a stranded lock as DUPLICATE_OWNERSHIP.
    assert not (locks_dir / "mt5n-login-20001.lock").exists()
    assert len(lease.released) == 1  # the Redis lease was released too, not just the local lock
    _connection.close()


def test_run_worker_without_outbox_repository_is_unaffected(tmp_path: Path) -> None:
    """Backward-compatibility guard: outbox integration must be strictly
    additive -- a caller that never passes outbox_repository must see
    identical behavior to before this change."""
    account_dir = tmp_path / "accounts"
    account_dir.mkdir()
    account_path = account_dir / "20001.json"
    account_path.write_text(json.dumps(ACCOUNT_JSON), encoding="utf-8")
    (tmp_path / "locks").mkdir()

    _connection, journal = make_fake_journal(tmp_path)

    runtime_config = WorkerRuntimeConfig(
        owner_id="worker-a",
        lease_ttl_ms=15000,
        lease_renew_interval_ms=5000,
        lease_watchdog_margin_s=2.0,
        revalidate_every_n_polls=1,
        live_poll_s=0.01,
        history_poll_s=0.01,
    )

    outcome = run_worker(
        config_path=account_path,
        runtime_config=runtime_config,
        local_lock=LocalLoginLock(tmp_path / "locks"),
        journal_open=lambda _config: journal,
        lease=FakeLease(),
        terminal_session=FakeTerminalSession(),
        poll_live=lambda: None,
        poll_history=lambda: None,
        now_s=0.0,
        max_history_skew_s=86400,
        producer_epoch_id="epoch-1",
        max_poll_cycles=1,
        parent_pid_check=None,
    )

    assert outcome.exit_code is WorkerExitCode.CLEAN_SHUTDOWN
    _connection.close()
