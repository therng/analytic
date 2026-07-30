from __future__ import annotations

from dataclasses import dataclass
from threading import Event, Thread
from typing import Any

import pytest

from bridge.config import TerminalProfile
from bridge.journal.repository import Checkpoint
from bridge.models import (
    AccountIdentity,
    BridgeEnvelope,
    CallState,
    ProducerIdentity,
    TerminalIdentity,
)
from bridge.mt5_adapter import CallResult

from bridge.history import (
    HistoryPolicy,
    HistorySynchronizer,
    WindowOutcomeState,
)


def profile() -> TerminalProfile:
    return TerminalProfile(
        executable_path=r"C:\MT5-A\terminal64.exe",
        portable=True,
        expected_data_path=r"C:\MT5-A",
        expected_login=10001,
        expected_server="Broker-Demo",
        initialize_timeout_ms=15_000,
        coordination_domain="test",
        history_lower_bound_raw=100,
    )


def checkpoint(start: int = 100) -> Checkpoint:
    return Checkpoint(
        profile_id=profile().profile_id,
        generation=1,
        next_window_start_raw=start,
        last_window_id=None,
        policy_version=7,
        updated_at_utc="2026-01-01T00:00:00Z",
    )


@dataclass
class Adapter:
    deals: CallResult
    orders: CallResult

    def __post_init__(self) -> None:
        self.calls: list[tuple[str, int, int]] = []

    def history_deals(self, start_raw: int, end_raw: int) -> CallResult:
        self.calls.append(("deals", start_raw, end_raw))
        return self.deals

    def history_orders(self, start_raw: int, end_raw: int) -> CallResult:
        self.calls.append(("orders", start_raw, end_raw))
        return self.orders


@dataclass(frozen=True)
class Session:
    profile: TerminalProfile
    adapter: Adapter
    producer: ProducerIdentity = ProducerIdentity(
        producer_id="producer-a",
        profile_id="profile-a",
        epoch_id="epoch-a",
        coordination_epoch="coordination-a",
        fencing_token=1,
    )
    terminal: TerminalIdentity = TerminalIdentity(
        terminal_id="terminal-a",
        portable=True,
        path_digest="path-a",
        data_path_digest="data-a",
    )


class Repository:
    def __init__(self) -> None:
        self.inputs: list[Any] = []

    def commit_window(self, committed: Any) -> Checkpoint:
        self.inputs.append(committed)
        return Checkpoint(
            profile_id=committed.window.profile_id,
            generation=committed.window.generation,
            next_window_start_raw=committed.window.end_raw,
            last_window_id=committed.window.window_id,
            policy_version=committed.window.policy_version,
            updated_at_utc=committed.window.committed_at_utc,
        )


class Boundary:
    def __init__(self, safe_end: int) -> None:
        self.value = safe_end

    def safe_end(self, target: TerminalProfile) -> int:
        assert target == profile()
        return self.value


def successful(rows: tuple[dict[str, Any], ...]) -> CallResult:
    return CallResult(
        state=CallState.SUCCESS_NONEMPTY if rows else CallState.SUCCESS_EMPTY,
        rows=rows,
    )


def synchronizer(
    adapter: Adapter,
    repository: Repository,
    *,
    safe_end: int = 1_000,
    validate: Any = lambda _session: None,
) -> HistorySynchronizer:
    return HistorySynchronizer(
        repository=repository,
        boundary_provider=Boundary(safe_end),
        policy=HistoryPolicy(
            maximum_window_raw=200,
            overlap_raw=20,
            policy_version=7,
        ),
        observed_at_utc=lambda: "2026-01-01T00:00:01Z",
        revalidate=validate,
    )


def test_missing_checkpoint_starts_at_required_lower_bound_with_half_open_cap() -> None:
    repository = Repository()
    adapter = Adapter(successful(()), successful(()))

    outcome = synchronizer(adapter, repository, safe_end=380).run_next_window(
        Session(profile(), adapter), None
    )

    assert outcome.state is WindowOutcomeState.COMMITTED
    assert outcome.window is not None
    assert (outcome.window.start_raw, outcome.window.end_raw) == (100, 300)
    assert adapter.calls == [("deals", 100, 300), ("orders", 100, 300)]


def test_checkpoint_before_required_lower_bound_aborts_without_reading_history(
) -> None:
    repository = Repository()
    adapter = Adapter(successful(()), successful(()))

    outcome = synchronizer(adapter, repository).run_next_window(
        Session(profile(), adapter), checkpoint(99)
    )

    assert outcome.state is WindowOutcomeState.ABORTED
    assert adapter.calls == []
    assert repository.inputs == []


def test_safety_lag_boundary_and_overlap_produce_deterministic_retry_bytes() -> None:
    first_repository = Repository()
    first_adapter = Adapter(successful(()), successful(()))
    prior = Checkpoint(
        **{**checkpoint(250).__dict__, "last_window_id": "prior-window"}
    )
    first = synchronizer(
        first_adapter, first_repository, safe_end=310
    ).run_next_window(Session(profile(), first_adapter), prior)

    second_repository = Repository()
    second_adapter = Adapter(successful(()), successful(()))
    second = synchronizer(
        second_adapter, second_repository, safe_end=310
    ).run_next_window(Session(profile(), second_adapter), prior)

    assert first.state is WindowOutcomeState.COMMITTED
    assert second.state is WindowOutcomeState.COMMITTED
    assert first.window is not None
    assert (first.window.start_raw, first.window.end_raw) == (230, 310)
    assert first_repository.inputs[0] == second_repository.inputs[0]


def test_deals_and_orders_use_raw_stable_tie_ordering() -> None:
    repository = Repository()
    adapter = Adapter(
        successful(
            (
                {"ticket": 3, "time": 109, "time_msc": 20},
                {"ticket": 1, "time": 111, "time_msc": 20},
                {"ticket": 2, "time": 110, "time_msc": 20},
            )
        ),
        successful(
            (
                {
                    "ticket": 3,
                    "time_done": 110,
                    "time_done_msc": 20,
                    "time_setup": 9,
                    "time_setup_msc": 1,
                },
                {
                    "ticket": 1,
                    "time_done": 110,
                    "time_done_msc": 20,
                    "time_setup": 9,
                    "time_setup_msc": 1,
                },
                {
                    "ticket": 2,
                    "time_done": 110,
                    "time_done_msc": 20,
                    "time_setup": 9,
                    "time_setup_msc": 0,
                },
            )
        ),
    )

    synchronizer(adapter, repository).run_next_window(
        Session(profile(), adapter), checkpoint()
    )

    records = repository.inputs[0].records
    assert [record.natural_id for record in records if record.resource == "deal"] == [
        f"{profile().profile_id}:10001:Broker-Demo:3",
        f"{profile().profile_id}:10001:Broker-Demo:2",
        f"{profile().profile_id}:10001:Broker-Demo:1",
    ]
    assert [record.natural_id for record in records if record.resource == "order"] == [
        f"{profile().profile_id}:10001:Broker-Demo:2",
        f"{profile().profile_id}:10001:Broker-Demo:1",
        f"{profile().profile_id}:10001:Broker-Demo:3",
    ]


def test_history_outbox_uses_complete_contract_envelopes_with_raw_payload() -> None:
    repository = Repository()
    adapter = Adapter(
        successful(({"ticket": 1, "time": 100, "time_msc": 100},)),
        successful(()),
    )

    synchronizer(adapter, repository).run_next_window(
        Session(profile(), adapter), checkpoint()
    )

    message = next(
        message
        for message in repository.inputs[0].outbox
        if b'"message_type":"history.deal"' in message.envelope_json
    )
    envelope = BridgeEnvelope.model_validate_json(message.envelope_json)
    assert envelope.account == AccountIdentity(login=10001, server="Broker-Demo")
    assert envelope.payload == {
        "ordinal": 0,
        "raw": {"ticket": 1, "time": 100, "time_msc": 100},
        "window_id": repository.inputs[0].window.window_id,
    }


def test_half_open_window_excludes_rows_at_its_end_boundary() -> None:
    repository = Repository()
    adapter = Adapter(
        successful(
            (
                {"ticket": 1, "time": 299, "time_msc": 299},
                {"ticket": 2, "time": 300, "time_msc": 300},
            )
        ),
        successful(()),
    )

    outcome = synchronizer(adapter, repository, safe_end=300).run_next_window(
        Session(profile(), adapter), checkpoint()
    )

    assert outcome.state is WindowOutcomeState.COMMITTED
    assert [record.natural_id.rsplit(":", 1)[1] for record in repository.inputs[0].records] == [
        "1"
    ]


def test_policy_rejects_overlap_that_cannot_make_forward_progress() -> None:
    with pytest.raises(ValueError, match="smaller"):
        HistoryPolicy(maximum_window_raw=200, overlap_raw=200, policy_version=1)


@pytest.mark.parametrize("failed_resource", ("deals", "orders"))
def test_resource_failure_aborts_combined_window_without_a_journal_input(
    failed_resource: str,
) -> None:
    failed = CallResult(state=CallState.FAILED)
    adapter = Adapter(
        failed if failed_resource == "deals" else successful(()),
        failed if failed_resource == "orders" else successful(()),
    )
    repository = Repository()

    outcome = synchronizer(adapter, repository).run_next_window(
        Session(profile(), adapter), checkpoint()
    )

    assert outcome.state is WindowOutcomeState.ABORTED
    assert repository.inputs == []


@pytest.mark.parametrize(
    "bad_row",
    (
        {"time": 1},
        {"ticket": 1, "time": float("nan"), "time_msc": 1},
    ),
)
def test_invalid_identity_or_serialization_aborts_before_journal_commit(
    bad_row: dict[str, Any],
) -> None:
    repository = Repository()
    adapter = Adapter(successful((bad_row,)), successful(()))

    outcome = synchronizer(adapter, repository).run_next_window(
        Session(profile(), adapter), checkpoint()
    )

    assert outcome.state is WindowOutcomeState.ABORTED
    assert repository.inputs == []


def test_identity_drift_before_journal_commit_aborts_without_commit() -> None:
    repository = Repository()
    adapter = Adapter(successful(()), successful(()))
    checks = 0

    def revalidate(_session: Session) -> None:
        nonlocal checks
        checks += 1
        if checks == 2:
            raise RuntimeError("identity drift")

    outcome = synchronizer(adapter, repository, validate=revalidate).run_next_window(
        Session(profile(), adapter), checkpoint()
    )

    assert outcome.state is WindowOutcomeState.ABORTED
    assert checks == 2
    assert repository.inputs == []


def test_history_calls_are_serialized_across_concurrent_windows() -> None:
    first_started = Event()
    release_first = Event()
    second_started = Event()

    class BlockingAdapter(Adapter):
        def history_deals(self, start_raw: int, end_raw: int) -> CallResult:
            if self is first:
                first_started.set()
                assert release_first.wait(1)
            else:
                second_started.set()
            return super().history_deals(start_raw, end_raw)

    repository = Repository()
    first = BlockingAdapter(successful(()), successful(()))
    second = BlockingAdapter(successful(()), successful(()))
    sync = synchronizer(first, repository)
    first_thread = Thread(
        target=sync.run_next_window,
        args=(Session(profile(), first), checkpoint()),
    )
    second_thread = Thread(
        target=sync.run_next_window,
        args=(Session(profile(), second), checkpoint()),
    )

    first_thread.start()
    assert first_started.wait(1)
    second_thread.start()
    assert not second_started.wait(0.05)
    release_first.set()
    first_thread.join(1)
    second_thread.join(1)
    assert not first_thread.is_alive()
    assert not second_thread.is_alive()
