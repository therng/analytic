from __future__ import annotations

import json
import threading
from pathlib import Path

from bridge.health import HealthStore, LeaseFence, QuarantineDetail


def test_load_account_missing_returns_none(tmp_path: Path):
    store = HealthStore(tmp_path)
    assert store.load_account("abc") is None


def test_get_restart_state_defaults_to_zero_for_fresh_account(tmp_path: Path):
    store = HealthStore(tmp_path)
    assert store.get_restart_state("abc") == (0, None)


def test_first_transition_has_generation_one(tmp_path: Path):
    store = HealthStore(tmp_path)
    record = store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="starting",
        last_transition_reason="startup",
        last_transition_at_utc="2026-07-30T00:00:00Z",
        restart_count=0,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
    )
    assert record.state_generation == 1


def test_generation_increments_on_each_transition(tmp_path: Path):
    store = HealthStore(tmp_path)
    for i in range(3):
        record = store.record_transition(
            profile_id="abc",
            login=1,
            supervisor_instance_id="sup-1",
            state="running",
            last_transition_reason="startup",
            last_transition_at_utc=f"2026-07-30T00:0{i}:00Z",
            restart_count=i,
            restart_count_window_start_utc="2026-07-30T00:00:00Z",
        )
    assert record.state_generation == 3


def test_restart_state_resumes_from_prior_transition(tmp_path: Path):
    store = HealthStore(tmp_path)
    store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="running",
        last_transition_reason="mt5_ipc_failure",
        last_transition_at_utc="2026-07-30T00:05:00Z",
        restart_count=3,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
    )
    assert store.get_restart_state("abc") == (3, "2026-07-30T00:00:00Z")


def test_restart_state_persists_across_fresh_store_simulating_supervisor_restart(
    tmp_path: Path,
):
    first = HealthStore(tmp_path)
    first.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="running",
        last_transition_reason="mt5_ipc_failure",
        last_transition_at_utc="2026-07-30T00:05:00Z",
        restart_count=4,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
    )
    second = HealthStore(tmp_path)
    assert second.get_restart_state("abc") == (4, "2026-07-30T00:00:00Z")


def test_poll_timestamps_preserved_across_transition_that_does_not_supply_them(
    tmp_path: Path,
):
    store = HealthStore(tmp_path)
    store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="running",
        last_transition_reason="startup",
        last_transition_at_utc="2026-07-30T00:00:00Z",
        restart_count=0,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
        last_successful_live_poll_utc="2026-07-30T00:00:05Z",
    )
    record = store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="running",
        last_transition_reason="lease_lost",
        last_transition_at_utc="2026-07-30T00:01:00Z",
        restart_count=1,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
    )
    assert record.last_successful_live_poll_utc == "2026-07-30T00:00:05Z"


def test_lease_fence_and_quarantine_round_trip(tmp_path: Path):
    store = HealthStore(tmp_path)
    fence = LeaseFence(coordination_epoch="epoch-1", fencing_token=7)
    quarantine = QuarantineDetail(
        quarantined_at_utc="2026-07-30T00:00:00Z",
        quarantine_reason="journal_failure",
        cleared_at_utc=None,
    )
    store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="quarantined",
        last_transition_reason="journal_failure",
        last_transition_at_utc="2026-07-30T00:00:00Z",
        restart_count=0,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
        current_lease_fence=fence,
        quarantine=quarantine,
    )
    loaded = store.load_account("abc")
    assert loaded.current_lease_fence == fence
    assert loaded.quarantine == quarantine


def test_supervisor_file_round_trip(tmp_path: Path):
    store = HealthStore(tmp_path)
    store.write_supervisor(
        supervisor_instance_id="sup-1",
        started_at_utc="2026-07-30T00:00:00Z",
        updated_at_utc="2026-07-30T00:01:00Z",
        account_profile_ids=["abc", "def"],
    )
    loaded = store.load_supervisor()
    assert loaded["supervisor_instance_id"] == "sup-1"
    assert loaded["accounts"] == ["abc", "def"]
    assert loaded["schema_version"] == 1


def test_schema_version_present_on_every_account_write(tmp_path: Path):
    store = HealthStore(tmp_path)
    store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="starting",
        last_transition_reason="startup",
        last_transition_at_utc="2026-07-30T00:00:00Z",
        restart_count=0,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
    )
    raw = json.loads((tmp_path / "health" / "abc.json").read_text(encoding="utf-8"))
    assert raw["schema_version"] == 1


def test_concurrent_transitions_never_produce_partial_file_on_read(tmp_path: Path):
    store = HealthStore(tmp_path)
    store.record_transition(
        profile_id="abc",
        login=1,
        supervisor_instance_id="sup-1",
        state="starting",
        last_transition_reason="startup",
        last_transition_at_utc="2026-07-30T00:00:00Z",
        restart_count=0,
        restart_count_window_start_utc="2026-07-30T00:00:00Z",
    )
    errors: list[Exception] = []
    stop = threading.Event()

    def writer() -> None:
        for i in range(100):
            store.record_transition(
                profile_id="abc",
                login=1,
                supervisor_instance_id="sup-1",
                state="running",
                last_transition_reason="startup",
                last_transition_at_utc=f"2026-07-30T00:{i:02d}:00Z",
                restart_count=i,
                restart_count_window_start_utc="2026-07-30T00:00:00Z",
            )
        stop.set()

    def reader() -> None:
        while not stop.is_set():
            try:
                loaded = store.load_account("abc")
                if loaded is not None:
                    assert loaded.schema_version == 1
            except Exception as error:  # noqa: BLE001
                errors.append(error)

    writer_thread = threading.Thread(target=writer)
    reader_threads = [threading.Thread(target=reader) for _ in range(3)]
    writer_thread.start()
    for thread in reader_threads:
        thread.start()
    writer_thread.join(timeout=30)
    stop.set()
    for thread in reader_threads:
        thread.join(timeout=30)

    assert errors == []
