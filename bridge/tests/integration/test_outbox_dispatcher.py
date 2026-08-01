from __future__ import annotations

import threading
from pathlib import Path

from bridge.journal.repository import ClaimedOutboxMessage, JournalRepository
from bridge.outbox_dispatcher import OutboxDispatchConfig, OutboxDispatchThread
from bridge.redis_transport import FenceCredential, LeaseUnavailable, RedisTransportError
from bridge.restart_policy import BackoffConfig
from test_journal_repository import expected_checkpoint, open_repository, outbox, record, window

# ruff: noqa: E501

CREDENTIAL = FenceCredential(
    login=10001,
    owner_id="worker-a",
    producer_epoch_id="epoch-1",
    coordination_epoch="coord-1",
    fencing_token=1,
)


class FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, bytes]] = []
        self._next_entry_id = 1
        self.raise_for: dict[str, Exception] = {}
        self.always_raise: Exception | None = None

    def append_stream_fenced(self, credential: FenceCredential, event_id: str, envelope: bytes) -> str:
        assert credential == CREDENTIAL
        self.calls.append((event_id, envelope))
        if self.always_raise is not None:
            raise self.always_raise
        error = self.raise_for.pop(event_id, None)
        if error is not None:
            raise error
        entry_id = f"1-{self._next_entry_id}"
        self._next_entry_id += 1
        return entry_id


def make_config(**overrides: object) -> OutboxDispatchConfig:
    base = dict(
        batch_size=10,
        claim_lease_s=30,
        max_attempts=3,
        backoff=BackoffConfig(base_delay_ms=1, max_delay_ms=10),
        cleanup_interval_s=1_000_000.0,
        dispatch_interval_s=999.0,
    )
    base.update(overrides)
    return OutboxDispatchConfig(**base)  # type: ignore[arg-type]


def make_thread(
    repository: JournalRepository,
    transport: FakeTransport,
    *,
    lease_lost: threading.Event | None = None,
    config: OutboxDispatchConfig | None = None,
    now_utc: str = "2026-01-01T00:03:00Z",
) -> OutboxDispatchThread:
    return OutboxDispatchThread(
        repository=repository,
        transport=transport,
        credential=CREDENTIAL,
        owner_id="worker-a",
        config=config or make_config(),
        lease_lost=lease_lost or threading.Event(),
        now_utc=lambda: now_utc,
    )


def commit_full_window(repository: JournalRepository) -> None:
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (record("deal", "deal-1", "deal-event-1", "deal-digest-1"),),
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )


def test_normal_publish_then_window_on_second_cycle(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    commit_full_window(repository)
    transport = FakeTransport()
    thread = make_thread(repository, transport)

    thread.dispatch_once()
    row = journal.connection.execute(
        "SELECT state FROM outbox_messages WHERE event_id = 'deal-event-1'"
    ).fetchone()
    assert row == ("PUBLISHED",)
    # window message was claimed in the SAME batch as the still-INFLIGHT
    # deal, so the sibling gate must have skipped it this cycle.
    window_row = journal.connection.execute(
        "SELECT state FROM outbox_messages WHERE event_id = 'window-event-1'"
    ).fetchone()
    assert window_row == ("PENDING",)

    thread.dispatch_once()
    window_row = journal.connection.execute(
        "SELECT state FROM outbox_messages WHERE event_id = 'window-event-1'"
    ).fetchone()
    assert window_row == ("PUBLISHED",)
    journal.close()


def test_redis_transient_failure_then_retry_succeeds(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (record("deal", "deal-1", "deal-event-1", "deal-digest-1"),),
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )
    transport = FakeTransport()
    transport.raise_for["deal-event-1"] = RedisTransportError("timeout")
    thread = make_thread(repository, transport, now_utc="2026-01-01T00:03:00Z")

    thread.dispatch_once()
    row = journal.connection.execute(
        "SELECT state, delivery_failure_count FROM outbox_messages WHERE event_id = 'deal-event-1'"
    ).fetchone()
    assert row == ("PENDING", 1)

    thread_2 = make_thread(repository, transport, now_utc="2026-01-01T00:04:00Z")
    thread_2.dispatch_once()
    row = journal.connection.execute(
        "SELECT state FROM outbox_messages WHERE event_id = 'deal-event-1'"
    ).fetchone()
    assert row == ("PUBLISHED",)
    journal.close()


def test_lease_unavailable_sets_lease_lost_without_touching_delivery_failure_count(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (record("deal", "deal-1", "deal-event-1", "deal-digest-1"),),
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )
    transport = FakeTransport()
    transport.always_raise = LeaseUnavailable("fence rejected")
    lease_lost = threading.Event()
    thread = make_thread(repository, transport, lease_lost=lease_lost)

    thread.dispatch_once()
    assert lease_lost.is_set()
    row = journal.connection.execute(
        "SELECT state, delivery_failure_count FROM outbox_messages WHERE event_id = 'deal-event-1'"
    ).fetchone()
    assert row == ("INFLIGHT", 0)  # untouched -- fail_outbox must never be called here
    journal.close()


def test_quarantine_threshold_reached_via_repeated_dispatcher_failures(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (record("deal", "deal-1", "deal-event-1", "deal-digest-1"),),
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )
    transport = FakeTransport()
    transport.always_raise = RedisTransportError("down")
    config = make_config(max_attempts=3)

    for hour in range(1, 4):
        thread = make_thread(
            repository, transport, config=config, now_utc=f"2026-01-01T{hour:02d}:00:00Z"
        )
        thread.dispatch_once()

    row = journal.connection.execute(
        "SELECT state, delivery_failure_count FROM outbox_messages WHERE event_id = 'deal-event-1'"
    ).fetchone()
    assert row == ("QUARANTINED", 3)
    journal.close()


def test_pre_publish_recheck_refuses_to_publish_window_with_unpublished_sibling(
    tmp_path: Path,
) -> None:
    """Defense-in-depth test (§11.6 scenario 6): even if a caller hands the
    dispatcher a ClaimedOutboxMessage for a history.window row whose
    sibling isn't PUBLISHED (bypassing the claim-time gate, simulating a
    hypothetical gate bug), the dispatcher's own pre-publish re-check must
    refuse to call the transport at all."""
    journal, repository = open_repository(tmp_path)
    commit_full_window(repository)
    # deal-event-1 is still PENDING -- window-event-1 is not eligible.
    transport = FakeTransport()
    thread = make_thread(repository, transport)

    fake_claim = ClaimedOutboxMessage(
        event_id="window-event-1",
        window_id="window-1",
        profile_id="profile-a",
        stream_key="mt5:account:10001:stream:history",
        envelope_json=b'{"message_type":"history.window"}',
        payload_digest="window-digest",
        attempt_count=1,
        claim_expires_at_utc="2026-01-01T00:04:00Z",
    )
    thread._dispatch_one(fake_claim)  # noqa: SLF001 - exercising the defense-in-depth path directly
    assert transport.calls == []
    journal.close()


def test_duplicate_publish_at_transport_layer_does_not_crash_dispatcher(tmp_path: Path) -> None:
    """Duplicate-publish safety: a message reclaimed after an unacked but
    actually-successful publish gets published again at the transport
    layer (accepted, documented at-least-once tradeoff) -- the dispatcher
    must not raise even though ack_outbox's second call for an
    already-PUBLISHED row will hit OutboxStateConflict."""
    journal, repository = open_repository(tmp_path)
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (record("deal", "deal-1", "deal-event-1", "deal-digest-1"),),
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )
    transport = FakeTransport()
    thread = make_thread(repository, transport)
    claimed = repository.claim_outbox(
        "worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30
    )
    # Simulate: transport already succeeded and a first dispatcher already
    # acked it (crash recovery scenario 3) -- this second dispatch attempt
    # is the reclaim-driven duplicate.
    repository.ack_outbox("deal-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:01Z")

    thread._dispatch_one(claimed[0])  # noqa: SLF001 - duplicate delivery simulation
    assert transport.calls == [("deal-event-1", b'{"message_type":"history.deal"}')]
    row = journal.connection.execute(
        "SELECT redis_entry_id FROM outbox_messages WHERE event_id = 'deal-event-1'"
    ).fetchone()
    assert row == ("1-1",)  # first ack's entry id survives, no crash, no corruption
    journal.close()
