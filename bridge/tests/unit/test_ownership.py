from __future__ import annotations

import socket
from pathlib import Path

import pytest

from bridge.ownership import (
    LocalLoginLock,
    LocalOwnershipUnavailable,
    StaleLocalLockEvidence,
    _owner_is_alive,
)


def test_one_login_has_one_local_owner(tmp_path: Path) -> None:
    locks = LocalLoginLock(tmp_path)
    first = locks.acquire(1001, "producer-a")

    with pytest.raises(LocalOwnershipUnavailable):
        locks.acquire(1001, "producer-b")

    first.release()
    locks.acquire(1001, "producer-b").release()


def test_acquire_creates_missing_parent_directory(tmp_path: Path) -> None:
    locks = LocalLoginLock(tmp_path / "locks")
    lock = locks.acquire(1001, "producer-a")

    assert lock.path.exists()
    lock.release()


def test_distinct_logins_can_hold_independent_locks(tmp_path: Path) -> None:
    locks = LocalLoginLock(tmp_path)
    first = locks.acquire(1001, "producer-a")
    second = locks.acquire(1002, "producer-b")

    assert first.login == 1001
    assert second.login == 1002

    first.release()
    second.release()


def test_stale_lock_evidence_requires_explicit_operator_recovery(tmp_path: Path) -> None:
    locks = LocalLoginLock(tmp_path)
    locks.path_for(1001).write_text('{"owner_id":"old"}\n', encoding="utf-8")

    with pytest.raises(StaleLocalLockEvidence):
        locks.acquire(1001, "producer-a")


def test_dead_local_owner_lock_is_reclaimed(tmp_path: Path) -> None:
    locks = LocalLoginLock(tmp_path)
    locks.path_for(1001).write_text(
        f'{{"login":1001,"owner_id":"{socket.gethostname()}:99999999"}}',
        encoding="utf-8",
    )

    lock = locks.acquire(1001, "producer-a")

    lock.release()


def test_windows_invalid_parameter_marks_owner_pid_as_dead(monkeypatch) -> None:
    def missing_process(_pid: int, _signal: int) -> None:
        error = OSError("The parameter is incorrect")
        error.winerror = 87  # type: ignore[attr-defined]
        raise error

    monkeypatch.setattr("bridge.ownership.os.kill", missing_process)

    assert _owner_is_alive(f"{socket.gethostname()}:99999999") is False
