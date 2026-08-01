from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from threading import Event, Thread
from typing import Any

import pytest

from bridge.config import TerminalProfile
from bridge.journal.migrations import apply_migrations
from bridge.journal.repository import JournalRepository
from bridge.live import LiveOutcomeState, LivePublisher
from bridge.models import CallState, ProducerIdentity, TerminalIdentity
from bridge.mt5_adapter import CallResult
from bridge.redis_transport import FenceCredential, LeaseUnavailable


def profile() -> TerminalProfile:
    return TerminalProfile(
        executable_path=r"C:\\MT5-A\\terminal64.exe",
        portable=True,
        expected_data_path=r"C:\\MT5-A",
        expected_login=10001,
        expected_server="Broker-Demo",
        initialize_timeout_ms=15_000,
        coordination_domain="test",
        history_lower_bound_raw=100,
    )


def producer(
    epoch: str = "epoch-a", coordination: str = "coordination-a"
) -> ProducerIdentity:
    return ProducerIdentity(
        producer_id="producer-a",
        profile_id=profile().profile_id,
        epoch_id=epoch,
        coordination_epoch=coordination,
        fencing_token=1,
    )


def fence() -> FenceCredential:
    return FenceCredential(
        login=10001,
        owner_id="owner-a",
        producer_epoch_id="epoch-a",
        coordination_epoch="coordination-a",
        fencing_token=1,
    )


def successful_value(value: dict[str, Any]) -> CallResult:
    return CallResult(state=CallState.SUCCESS_NONEMPTY, value=value)


def successful_rows(rows: tuple[dict[str, Any], ...]) -> CallResult:
    return CallResult(
        state=CallState.SUCCESS_NONEMPTY if rows else CallState.SUCCESS_EMPTY,
        rows=rows,
    )


@dataclass
class Adapter:
    account_result: CallResult
    positions_result: CallResult
    orders_result: CallResult

    def account(self) -> CallResult:
        return self.account_result

    def positions(self) -> CallResult:
        return self.positions_result

    def orders(self) -> CallResult:
        return self.orders_result


TERMINAL = TerminalIdentity(
    terminal_id="terminal-a",
    portable=True,
    path_digest="path-a",
    data_path_digest="data-a",
)


@dataclass(frozen=True)
class Session:
    profile: TerminalProfile
    adapter: Adapter
    producer: ProducerIdentity
    terminal: TerminalIdentity = TERMINAL
    journal_profile_id: str = profile().profile_id


class Sequences:
    def __init__(self) -> None:
        self.next = 1
        self.calls: list[tuple[str, str]] = []

    def reserve(self, profile_id: str, epoch_id: str) -> int:
        self.calls.append((profile_id, epoch_id))
        sequence = self.next
        self.next += 1
        return sequence


class Transport:
    def __init__(self) -> None:
        self.live: list[bytes] = []
        self.fail_live = False

    def publish_live_fenced(self, credential: FenceCredential, envelope: bytes) -> None:
        if self.fail_live:
            raise LeaseUnavailable("live fenced publication was rejected")
        self.live.append(envelope)


def publisher(
    transport: Transport,
    sequences: Sequences,
    *,
    revalidate: Any = lambda _session: None,
) -> LivePublisher:
    return LivePublisher(
        transport=transport,
        sequences=sequences,
        observed_at_utc=lambda: "2026-01-01T00:00:01Z",
        revalidate=revalidate,
    )


def session(
    adapter: Adapter,
    *,
    epoch: str = "epoch-a",
    coordination: str = "coordination-a",
) -> Session:
    return Session(profile(), adapter, producer(epoch, coordination))


def reconciled_session(adapter: Adapter) -> Session:
    return Session(
        profile(),
        adapter,
        producer().model_copy(update={"profile_id": "journal-profile"}),
        journal_profile_id="journal-profile",
    )


def complete_adapter(
    *,
    positions: tuple[dict[str, Any], ...] = (),
    orders: tuple[dict[str, Any], ...] = (),
) -> Adapter:
    return Adapter(
        successful_value({"login": 10001, "server": "Broker-Demo", "balance": 1.0}),
        successful_rows(positions),
        successful_rows(orders),
    )


def test_live_transport_protocol_has_no_stream_append_method() -> None:
    """Regression guard for the stream:live removal: LiveTransport's Protocol
    must expose only publish_live_fenced. If a stream-append method is ever
    reintroduced here, this fails immediately rather than silently
    resurrecting a call site that every other test's minimal Transport fake
    (which never defined such a method) would otherwise mask."""
    from bridge.live import LiveTransport

    assert set(LiveTransport.__protocol_attrs__) == {"publish_live_fenced"}


def test_minimal_transport_with_only_publish_live_fenced_is_sufficient() -> None:
    """A transport stub implementing nothing but publish_live_fenced must be
    enough to drive a full successful poll — proving _publish_pending calls
    no other transport method (in particular, no removed stream-append call)
    for either a snapshot or an error outcome."""

    class MinimalTransport:
        def __init__(self) -> None:
            self.live: list[bytes] = []

        def publish_live_fenced(
            self, credential: FenceCredential, envelope: bytes
        ) -> None:
            self.live.append(envelope)

    transport = MinimalTransport()
    live = publisher(transport, Sequences())

    snapshot_outcome = live.poll_once(session(complete_adapter()), fence())
    assert snapshot_outcome.state is LiveOutcomeState.PUBLISHED
    assert len(transport.live) == 1

    foreign_account = complete_adapter()
    foreign_account.account_result = successful_value(
        {"login": 99999, "server": "Other-Broker", "balance": 1.0}
    )
    error_outcome = live.poll_once(session(foreign_account), fence())
    assert error_outcome.state is LiveOutcomeState.FAILED
    assert len(transport.live) == 1  # unchanged — error kind never publishes


def test_empty_live_collections_publish_complete_canonical_snapshot() -> None:
    transport = Transport()
    sequences = Sequences()

    outcome = publisher(transport, sequences).poll_once(
        session(complete_adapter()), fence()
    )

    assert outcome.state is LiveOutcomeState.PUBLISHED
    assert outcome.envelope is not None
    assert sequences.calls == [(profile().profile_id, "epoch-a")]
    assert len(transport.live) == 1
    envelope = json.loads(transport.live[0])
    assert envelope["message_type"] == "live.snapshot"
    assert envelope["payload_state"] == "complete"
    assert envelope["payload"] == {
        "account": {
            "raw": {"balance": 1.0, "login": 10001, "server": "Broker-Demo"},
            "state": "success_nonempty",
        },
        "orders": {"rows": [], "state": "success_empty"},
        "positions": {"rows": [], "state": "success_empty"},
        "sequence": 1,
    }


@pytest.mark.parametrize("failed", ("account", "positions", "orders"))
def test_failed_required_read_preserves_last_complete_snapshot_and_emits_live_error(
    failed: str,
) -> None:
    transport = Transport()
    sequences = Sequences()
    live = publisher(transport, sequences)
    assert (
        live.poll_once(session(complete_adapter()), fence()).state
        is LiveOutcomeState.PUBLISHED
    )
    prior = transport.live[-1]
    failed_result = CallResult(state=CallState.FAILED)
    adapter = complete_adapter()
    setattr(adapter, f"{failed}_result", failed_result)

    outcome = live.poll_once(session(adapter), fence())

    assert outcome.state is LiveOutcomeState.FAILED
    assert transport.live[-1] == prior
    assert outcome.envelope is not None
    envelope = json.loads(outcome.envelope)
    assert envelope["message_type"] == "live.error"
    assert envelope["payload_state"] == "failed"
    assert envelope["payload"]["failed_resources"] == [failed]


def test_disappearance_emits_no_close_or_cancel_event() -> None:
    transport = Transport()
    sequences = Sequences()
    live = publisher(transport, sequences)
    open_row = {"ticket": 7, "symbol": "EURUSD", "time": 1_700_000_000}
    pending_row = {"ticket": 9, "symbol": "GBPUSD", "time_setup": 1_700_000_001}
    assert (
        live.poll_once(
            session(complete_adapter(positions=(open_row,), orders=(pending_row,))),
            fence(),
        ).state
        is LiveOutcomeState.PUBLISHED
    )

    outcome = live.poll_once(session(complete_adapter()), fence())

    assert outcome.state is LiveOutcomeState.PUBLISHED
    assert len(transport.live) == 2
    envelope = json.loads(transport.live[-1])
    assert envelope["payload"]["positions"]["rows"] == []
    assert envelope["payload"]["orders"]["rows"] == []
    assert "close" not in transport.live[-1].decode().lower()
    assert "cancel" not in transport.live[-1].decode().lower()


def test_live_retry_reuses_identical_snapshot_bytes_and_event_id() -> None:
    transport = Transport()
    transport.fail_live = True
    sequences = Sequences()
    live = publisher(transport, sequences)
    active_session = session(complete_adapter())

    failed = live.poll_once(active_session, fence())
    transport.fail_live = False
    retried = live.poll_once(active_session, fence())

    assert failed.state is LiveOutcomeState.FENCE_REJECTED
    assert retried.state is LiveOutcomeState.PUBLISHED
    assert failed.envelope is not None
    assert retried.envelope == failed.envelope
    assert sequences.calls == [(profile().profile_id, "epoch-a")]
    assert transport.live == [failed.envelope]


def test_fresh_producer_epoch_uses_a_distinct_event_id() -> None:
    transport = Transport()
    sequences = Sequences()
    live = publisher(transport, sequences)
    first = live.poll_once(session(complete_adapter()), fence())
    next_fence = FenceCredential(10001, "owner-b", "epoch-b", "coordination-b", 1)
    second = live.poll_once(
        session(complete_adapter(), epoch="epoch-b", coordination="coordination-b"),
        next_fence,
    )

    assert first.envelope is not None
    assert second.envelope is not None
    assert (
        json.loads(first.envelope)["event_id"]
        != json.loads(second.envelope)["event_id"]
    )
    assert [json.loads(item)["payload"]["sequence"] for item in transport.live] == [
        1,
        2,
    ]


def test_stale_fence_rejection_does_not_replace_cache_or_append_an_error() -> None:
    transport = Transport()
    sequences = Sequences()
    live = publisher(transport, sequences)
    first = live.poll_once(session(complete_adapter()), fence())
    stale = FenceCredential(10001, "owner-a", "old-epoch", "coordination-a", 1)

    outcome = live.poll_once(session(complete_adapter()), stale)

    assert first.envelope is not None
    assert outcome.state is LiveOutcomeState.FENCE_REJECTED
    assert transport.live == [first.envelope]


def test_mismatched_producer_profile_cannot_publish_live_state() -> None:
    transport = Transport()
    sequences = Sequences()
    active_session = session(complete_adapter())
    mismatched_session = Session(
        active_session.profile,
        active_session.adapter,
        active_session.producer.model_copy(update={"profile_id": "other-profile"}),
    )

    outcome = publisher(transport, sequences).poll_once(mismatched_session, fence())

    assert outcome.state is LiveOutcomeState.FENCE_REJECTED
    assert transport.live == []
    assert sequences.calls == []


def test_reconciled_journal_profile_owns_live_sequence_and_envelope() -> None:
    transport = Transport()
    sequences = Sequences()

    outcome = publisher(transport, sequences).poll_once(
        reconciled_session(complete_adapter()), fence()
    )

    assert outcome.state is LiveOutcomeState.PUBLISHED
    assert sequences.calls == [("journal-profile", "epoch-a")]
    assert json.loads(transport.live[0])["producer"]["profile_id"] == "journal-profile"


def test_pending_retry_revalidates_before_publishing_cached_snapshot() -> None:
    transport = Transport()
    transport.fail_live = True
    checks = 0

    def revalidate(_session: Session) -> None:
        nonlocal checks
        checks += 1
        if checks == 4:
            raise RuntimeError("identity drift")

    live = publisher(transport, Sequences(), revalidate=revalidate)
    assert live.poll_once(session(complete_adapter()), fence()).state is (
        LiveOutcomeState.FENCE_REJECTED
    )
    transport.fail_live = False

    outcome = live.poll_once(session(complete_adapter()), fence())

    assert outcome.state is LiveOutcomeState.FAILED
    assert checks == 4
    assert transport.live == []


def test_live_error_still_revalidates_before_reporting_failure() -> None:
    transport = Transport()
    checks = 0

    def revalidate(_session: Session) -> None:
        nonlocal checks
        checks += 1
        if checks == 2:
            raise RuntimeError("identity drift")

    failed_adapter = complete_adapter()
    failed_adapter.orders_result = CallResult(state=CallState.FAILED)

    outcome = publisher(transport, Sequences(), revalidate=revalidate).poll_once(
        session(failed_adapter), fence()
    )

    assert outcome.state is LiveOutcomeState.FAILED
    assert checks == 2
    assert transport.live == []


def test_foreign_account_identity_never_becomes_a_live_snapshot() -> None:
    transport = Transport()
    foreign_account = complete_adapter()
    foreign_account.account_result = successful_value(
        {"login": 99999, "server": "Other-Broker", "balance": 1.0}
    )

    outcome = publisher(transport, Sequences()).poll_once(
        session(foreign_account), fence()
    )

    assert outcome.state is LiveOutcomeState.FAILED
    assert transport.live == []
    assert outcome.envelope is not None
    assert json.loads(outcome.envelope)["message_type"] == "live.error"


def test_account_collection_has_explicit_success_status() -> None:
    transport = Transport()

    assert (
        publisher(transport, Sequences())
        .poll_once(session(complete_adapter()), fence())
        .state
        is LiveOutcomeState.PUBLISHED
    )

    assert json.loads(transport.live[0])["payload"]["account"]["state"] == (
        "success_nonempty"
    )


def test_sqlite_sequences_are_monotonic_across_producer_epochs() -> None:
    connection = sqlite3.connect(":memory:")
    apply_migrations(connection)
    repository = JournalRepository(connection)
    profile_id = profile().profile_id
    repository.register_profile(
        profile_id=profile_id,
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="config-a",
        now_utc="2026-01-01T00:00:00Z",
    )
    connection.executemany(
        "INSERT INTO producer_epochs("
        "epoch_id, profile_id, fence_token, started_at_utc, start_reason"
        ") VALUES (?, ?, ?, ?, ?)",
        (
            ("epoch-a", profile_id, 1, "2026-01-01T00:00:00Z", "test"),
            ("epoch-b", profile_id, 1, "2026-01-02T00:00:00Z", "test"),
        ),
    )

    assert repository.reserve(profile_id, "epoch-a") == 1
    assert repository.reserve(profile_id, "epoch-a") == 2
    assert repository.reserve(profile_id, "epoch-b") == 3
    assert repository.reserve(profile_id, "epoch-a") == 4


def test_reconciled_profile_reserves_sequence_against_existing_journal_row() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    apply_migrations(connection)
    repository = JournalRepository(connection)
    repository.register_profile(
        profile_id="journal-profile",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-old",
        config_digest="config-old",
        now_utc="2026-01-01T00:00:00Z",
    )
    registered_profile_id = repository.register_profile(
        profile_id=profile().profile_id,
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-new",
        config_digest="config-new",
        now_utc="2026-01-02T00:00:00Z",
    )
    repository.register_epoch(
        epoch_id="epoch-a",
        profile_id=registered_profile_id,
        fence_token=1,
        started_at_utc="2026-01-02T00:00:00Z",
        start_reason="test",
    )

    outcome = LivePublisher(
        transport=Transport(),
        sequences=repository,
        observed_at_utc=lambda: "2026-01-02T00:00:01Z",
        revalidate=lambda _session: None,
    ).poll_once(reconciled_session(complete_adapter()), fence())

    assert outcome.state is LiveOutcomeState.PUBLISHED
    assert repository.reserve("journal-profile", "epoch-a") == 2


def test_sqlite_sequence_survives_journal_reopen(tmp_path: Path) -> None:
    path = tmp_path / "live.sqlite3"
    profile_id = profile().profile_id
    first = sqlite3.connect(path)
    apply_migrations(first)
    repository = JournalRepository(first)
    repository.register_profile(
        profile_id=profile_id,
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="config-a",
        now_utc="2026-01-01T00:00:00Z",
    )
    first.execute(
        "INSERT INTO producer_epochs("
        "epoch_id, profile_id, fence_token, started_at_utc, start_reason"
        ") VALUES (?, ?, ?, ?, ?)",
        ("epoch-a", profile_id, 1, "2026-01-01T00:00:00Z", "test"),
    )
    assert repository.reserve(profile_id, "epoch-a") == 1
    first.commit()
    first.close()

    second = sqlite3.connect(path)
    assert JournalRepository(second).reserve(profile_id, "epoch-a") == 2
    second.close()


def test_live_calls_are_serialized_across_concurrent_polls() -> None:
    first_started = Event()
    release_first = Event()
    second_started = Event()

    class BlockingAdapter(Adapter):
        def account(self) -> CallResult:
            if self is first:
                first_started.set()
                assert release_first.wait(1)
            else:
                second_started.set()
            return super().account()

    transport = Transport()
    live = publisher(transport, Sequences())
    first = BlockingAdapter(**complete_adapter().__dict__)
    second = BlockingAdapter(**complete_adapter().__dict__)
    first_thread = Thread(target=live.poll_once, args=(session(first), fence()))
    second_thread = Thread(target=live.poll_once, args=(session(second), fence()))

    first_thread.start()
    assert first_started.wait(1)
    second_thread.start()
    assert not second_started.wait(0.05)
    release_first.set()
    first_thread.join(1)
    second_thread.join(1)
    assert not first_thread.is_alive()
    assert not second_thread.is_alive()
