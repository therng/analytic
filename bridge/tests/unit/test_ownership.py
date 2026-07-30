from __future__ import annotations

from pathlib import Path

import pytest

from bridge.ownership import (
    LocalLoginLock,
    LocalOwnershipUnavailable,
    StaleLocalLockEvidence,
)


def test_one_login_has_one_local_owner(tmp_path: Path) -> None:
    locks = LocalLoginLock(tmp_path)
    first = locks.acquire(1001, "producer-a")

    with pytest.raises(LocalOwnershipUnavailable):
        locks.acquire(1001, "producer-b")

    first.release()
    locks.acquire(1001, "producer-b").release()


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
