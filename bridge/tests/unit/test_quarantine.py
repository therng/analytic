from __future__ import annotations

from pathlib import Path

import pytest

from bridge.quarantine import QuarantineStore


def test_get_missing_profile_returns_none(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    assert store.get("abc") is None
    assert store.is_quarantined("abc") is False


def test_quarantine_then_get_is_active(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    store.quarantine(
        profile_id="abc",
        login=123,
        reason="config_invalid",
        triggering_exit_code=10,
        restart_count_at_quarantine=0,
    )
    assert store.is_quarantined("abc") is True
    record = store.get("abc")
    assert record.quarantine_reason == "config_invalid"
    assert record.cleared_at_utc is None


def test_clear_unknown_profile_raises(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    with pytest.raises(LookupError):
        store.clear("nope", operator="alice")


def test_clear_makes_account_no_longer_quarantined(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    store.quarantine(
        profile_id="abc",
        login=123,
        reason="journal_failure",
        triggering_exit_code=15,
        restart_count_at_quarantine=2,
    )
    store.clear("abc", operator="alice")
    assert store.is_quarantined("abc") is False
    record = store.get("abc")
    assert record.cleared_by == "alice"
    assert record.cleared_at_utc is not None
    # Historical record preserved, not deleted.
    assert record.quarantine_reason == "journal_failure"


def test_persistence_across_fresh_store_instance_simulates_supervisor_restart(
    tmp_path: Path,
):
    first_instance = QuarantineStore(tmp_path)
    first_instance.quarantine(
        profile_id="abc",
        login=123,
        reason="identity_violation",
        triggering_exit_code=12,
        restart_count_at_quarantine=3,
    )

    # A brand new QuarantineStore over the same state_dir, as a fresh
    # supervisor process would construct after an NSSM restart, must still
    # see the account as quarantined -- this is the property that prevents
    # "restart the service" from being a de facto quarantine bypass.
    second_instance = QuarantineStore(tmp_path)
    assert second_instance.is_quarantined("abc") is True


def test_clear_persists_across_fresh_store_instance(tmp_path: Path):
    first_instance = QuarantineStore(tmp_path)
    first_instance.quarantine(
        profile_id="abc",
        login=123,
        reason="config_invalid",
        triggering_exit_code=10,
        restart_count_at_quarantine=0,
    )
    first_instance.clear("abc", operator="bob")

    second_instance = QuarantineStore(tmp_path)
    assert second_instance.is_quarantined("abc") is False


def test_list_active_excludes_cleared_records(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    store.quarantine(
        profile_id="active",
        login=1,
        reason="journal_failure",
        triggering_exit_code=15,
        restart_count_at_quarantine=0,
    )
    store.quarantine(
        profile_id="cleared",
        login=2,
        reason="config_invalid",
        triggering_exit_code=10,
        restart_count_at_quarantine=0,
    )
    store.clear("cleared", operator="alice")

    active = store.list_active()
    assert [record.profile_id for record in active] == ["active"]


def test_list_active_on_empty_store_returns_empty_list(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    assert store.list_active() == []


def test_re_quarantine_after_clear_reactivates(tmp_path: Path):
    store = QuarantineStore(tmp_path)
    store.quarantine(
        profile_id="abc",
        login=123,
        reason="mt5_ipc_failure",
        triggering_exit_code=14,
        restart_count_at_quarantine=5,
    )
    store.clear("abc", operator="alice")
    assert store.is_quarantined("abc") is False

    store.quarantine(
        profile_id="abc",
        login=123,
        reason="journal_failure",
        triggering_exit_code=15,
        restart_count_at_quarantine=0,
    )
    assert store.is_quarantined("abc") is True
    assert store.get("abc").cleared_at_utc is None
