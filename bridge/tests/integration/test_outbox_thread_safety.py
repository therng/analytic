from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

import pytest

from bridge.config import JournalConfig
from bridge.exit_codes import WorkerExitCode
from bridge.journal.connection import Journal
from bridge.journal.repository import JournalRepository
from bridge.ownership import LocalLoginLock
from bridge.outbox_dispatcher import OutboxDispatchConfig, OutboxDispatchThread
from bridge.redis_transport import FenceCredential
from bridge.worker import WorkerRuntimeConfig, run_worker

# ruff: noqa: E501

ACCOUNT_JSON = {
    "executable_path": "C:\\MT5\\terminal64.exe",
    "portable": True,
    "expected_data_path": "C:\\MT5\\data",
    "expected_login": 30001,
    "expected_server": "Broker-Demo",
    "initialize_timeout_ms": 5000,
    "coordination_domain": "default",
    "history_lower_bound_raw": 0,
    "journal_path": "C:\\MT5\\journal.sqlite3",
}


class FakeLease:
    def acquire(self, login: int, owner_id: str, producer_epoch_id: str, ttl_ms: int) -> FenceCredential:
        return FenceCredential(login, owner_id, producer_epoch_id, "coord-1", 1)

    def renew(self, credential: FenceCredential, ttl_ms: int) -> bool:
        return True

    def release(self, credential: FenceCredential) -> None:
        pass

    def append_stream_fenced(self, credential: FenceCredential, event_id: str, envelope: bytes) -> str:
        return "1-1"


class FakeTerminalSession:
    def connect_verified(self, profile: object):
        from types import SimpleNamespace

        return SimpleNamespace(profile=profile)

    def revalidate(self, verified: object) -> None:
        pass


def open_journal(tmp_path: Path) -> Journal:
    config = JournalConfig.model_construct(
        path=str(tmp_path / "journal.sqlite3"), busy_timeout_ms=321
    )
    return Journal.open(config)


def test_secondary_connection_is_a_distinct_object(tmp_path: Path) -> None:
    journal = open_journal(tmp_path)
    secondary = journal.open_secondary_connection()
    try:
        assert secondary is not journal.connection
    finally:
        secondary.close()
        journal.close()


def test_secondary_connection_usable_from_a_different_thread(tmp_path: Path) -> None:
    """Regression test for the bug this fix addresses: sqlite3.Connection
    objects raise sqlite3.ProgrammingError when used from any thread other
    than the one that created them. A connection returned by
    open_secondary_connection() must be created and used entirely within
    the calling (worker) thread, not shared with the primary connection's
    thread."""
    journal = open_journal(tmp_path)
    errors: list[BaseException] = []

    def worker_thread() -> None:
        try:
            secondary = journal.open_secondary_connection()
            try:
                repository = JournalRepository(secondary)
                repository.claim_outbox(
                    "owner-a", limit=10, now_utc="2026-01-01T00:00:00Z", lease_seconds=30
                )
            finally:
                secondary.close()
        except BaseException as error:  # noqa: BLE001 - captured for the assertion below
            errors.append(error)

    thread = threading.Thread(target=worker_thread)
    thread.start()
    thread.join(timeout=5)

    assert not errors, f"secondary connection failed from another thread: {errors}"
    journal.close()


def test_run_worker_auto_derives_a_separate_outbox_connection(tmp_path: Path) -> None:
    """This is the exact real (non-test-fake) code path worker.py's main()
    uses: outbox_enabled=True with no outbox_repository supplied, against a
    real Journal (not the SimpleNamespace fake other wiring tests use,
    which lacks open_secondary_connection() and would mask this bug)."""
    account_dir = tmp_path / "accounts"
    account_dir.mkdir()
    account_path = account_dir / "30001.json"
    account_path.write_text(json.dumps(ACCOUNT_JSON), encoding="utf-8")
    (tmp_path / "locks").mkdir()

    journal = open_journal(tmp_path)

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
        outbox_enabled=True,
        outbox_config=OutboxDispatchConfig(dispatch_interval_s=999.0),
    )

    assert outcome.exit_code is WorkerExitCode.CLEAN_SHUTDOWN


class _RaisesOnceThenEmptyRepository:
    """Fakes JournalRepository.claim_outbox: fails exactly once (simulating
    the cross-thread bug, or any transient failure), then returns no work
    on every subsequent call."""

    def __init__(self) -> None:
        self.calls = 0

    def claim_outbox(self, owner_id, *, limit, now_utc, lease_seconds):
        self.calls += 1
        if self.calls == 1:
            raise sqlite3.ProgrammingError(
                "SQLite objects created in a thread can only be used in that same thread."
            )
        return []


def test_dispatch_thread_survives_a_dispatch_once_exception() -> None:
    """Regression test for the second half of the fix: run() must not let
    an exception from dispatch_once() kill the thread permanently -- it
    should log and keep retrying on the next tick."""
    repository = _RaisesOnceThenEmptyRepository()
    lease_lost = threading.Event()
    thread = OutboxDispatchThread(
        repository=repository,
        transport=FakeLease(),
        credential=FenceCredential(30001, "owner-a", "epoch-1", "coord-1", 1),
        owner_id="owner-a",
        config=OutboxDispatchConfig(dispatch_interval_s=0.01),
        lease_lost=lease_lost,
        now_utc=lambda: "2026-01-01T00:00:00Z",
    )

    thread.start()
    try:
        for _ in range(200):
            if repository.calls >= 3:
                break
            threading.Event().wait(0.01)
    finally:
        thread.stop()
        thread.join(timeout=5)

    assert repository.calls >= 3, "dispatcher stopped ticking after the first exception"
    assert not thread.is_alive()
