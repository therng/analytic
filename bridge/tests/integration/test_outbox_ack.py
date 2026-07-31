from __future__ import annotations

import threading
from pathlib import Path

import pytest

from bridge.journal.repository import (
    JournalRepository,
    OutboxFailOutcome,
    OutboxMessage,
    OutboxStateConflict,
)
from bridge.restart_policy import BackoffConfig
from test_journal_repository import expected_checkpoint, open_repository, outbox, record, window

# ruff: noqa: E501

BACKOFF = BackoffConfig(base_delay_ms=1000, max_delay_ms=60_000)


def commit_full_window(repository: JournalRepository) -> None:
    """One window: a deal record, an order record, and the window summary
    message -- three outbox rows total, matching the shape §11.8's
    ordering gate cares about."""
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=1),
        (
            record("deal", "deal-1", "deal-event-1", "deal-digest-1"),
            record("order", "order-1", "order-event-1", "order-digest-1"),
        ),
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("order-event-1", "order-digest-1", "history.order"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )


def test_normal_publish_marks_row_published(tmp_path: Path) -> None:
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
    [claimed] = repository.claim_outbox(
        "worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30
    )
    assert claimed.event_id == "deal-event-1"

    repository.ack_outbox(
        "deal-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:05Z"
    )
    row = journal.connection.execute(
        "SELECT state, published_at_utc, redis_entry_id FROM outbox_messages WHERE event_id = ?",
        ("deal-event-1",),
    ).fetchone()
    assert row == ("PUBLISHED", "2026-01-01T00:03:05Z", "1-1")
    journal.close()


def test_ack_on_non_inflight_row_raises_conflict(tmp_path: Path) -> None:
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
    # Never claimed -- still PENDING, not INFLIGHT.
    with pytest.raises(OutboxStateConflict):
        repository.ack_outbox(
            "deal-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:00Z"
        )
    journal.close()


def test_duplicate_ack_second_call_conflicts_not_double_published(tmp_path: Path) -> None:
    """Duplicate-publish safety: a reclaimed-and-redispatched duplicate
    racing the original ack must never silently double-resolve the row."""
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
    repository.claim_outbox("worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)
    repository.ack_outbox("deal-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:05Z")
    with pytest.raises(OutboxStateConflict):
        repository.ack_outbox("deal-event-1", redis_entry_id="1-2", now_utc="2026-01-01T00:03:06Z")
    row = journal.connection.execute(
        "SELECT redis_entry_id FROM outbox_messages WHERE event_id = ?", ("deal-event-1",)
    ).fetchone()
    assert row == ("1-1",)  # first ack wins, second never overwrote it
    journal.close()


def test_fail_outbox_retryable_requeues_with_backoff(tmp_path: Path) -> None:
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
    repository.claim_outbox("worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)

    outcome = repository.fail_outbox(
        "deal-event-1",
        error_class="RedisTransportError",
        error_redacted="RedisTransportError",
        retryable=True,
        now_utc="2026-01-01T00:03:05Z",
        backoff_config=BACKOFF,
        max_attempts=8,
    )
    assert outcome is OutboxFailOutcome.REQUEUED
    row = journal.connection.execute(
        "SELECT state, delivery_failure_count, next_attempt_at_utc FROM outbox_messages WHERE event_id = ?",
        ("deal-event-1",),
    ).fetchone()
    assert row[0] == "PENDING"
    assert row[1] == 1
    assert row[2] > "2026-01-01T00:03:05Z"
    journal.close()


def test_fail_outbox_quarantines_at_max_attempts_not_before_or_after(tmp_path: Path) -> None:
    """Regression test for review finding B1's threshold arithmetic: the
    Nth genuine delivery failure quarantines, not the (N-1)th or (N+1)th."""
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
    max_attempts = 3
    # Each cycle's now_utc must be far enough past the previous
    # fail_outbox's computed next_attempt_at_utc (up to ~60s backoff) for
    # the row to be claimable again.
    hours = iter(range(1, max_attempts + 2))
    for expected_failure_count in range(1, max_attempts):
        now_utc = f"2026-01-01T{next(hours):02d}:00:00Z"
        repository.claim_outbox("worker-a", limit=1, now_utc=now_utc, lease_seconds=30)
        outcome = repository.fail_outbox(
            "deal-event-1",
            error_class="RedisTransportError",
            error_redacted="RedisTransportError",
            retryable=True,
            now_utc=now_utc,
            backoff_config=BACKOFF,
            max_attempts=max_attempts,
        )
        assert outcome is OutboxFailOutcome.REQUEUED
        row = journal.connection.execute(
            "SELECT delivery_failure_count FROM outbox_messages WHERE event_id = ?",
            ("deal-event-1",),
        ).fetchone()
        assert row[0] == expected_failure_count

    # The max_attempts-th failure quarantines.
    now_utc = f"2026-01-01T{next(hours):02d}:00:00Z"
    repository.claim_outbox("worker-a", limit=1, now_utc=now_utc, lease_seconds=30)
    outcome = repository.fail_outbox(
        "deal-event-1",
        error_class="RedisTransportError",
        error_redacted="RedisTransportError",
        retryable=True,
        now_utc=now_utc,
        backoff_config=BACKOFF,
        max_attempts=max_attempts,
    )
    assert outcome is OutboxFailOutcome.QUARANTINED
    row = journal.connection.execute(
        "SELECT state, delivery_failure_count, quarantined_at_utc FROM outbox_messages WHERE event_id = ?",
        ("deal-event-1",),
    ).fetchone()
    assert row == ("QUARANTINED", max_attempts, now_utc)
    journal.close()


def test_fail_outbox_non_retryable_quarantines_on_first_call(tmp_path: Path) -> None:
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
    repository.claim_outbox("worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)
    outcome = repository.fail_outbox(
        "deal-event-1",
        error_class="MalformedEnvelope",
        error_redacted="MalformedEnvelope",
        retryable=False,
        now_utc="2026-01-01T00:03:00Z",
        backoff_config=BACKOFF,
        max_attempts=8,
    )
    assert outcome is OutboxFailOutcome.QUARANTINED
    journal.close()


def test_retry_counter_isolation_reclaim_churn_never_quarantines(tmp_path: Path) -> None:
    """Regression test for review finding B1: attempt_count (bumped by
    every claim_outbox reclaim, including ones caused by an unrelated
    crashing dispatcher) must never be read by the quarantine threshold.
    Only delivery_failure_count -- incremented solely by fail_outbox after
    a genuine publish attempt failed -- may quarantine a message."""
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
    max_attempts = 3
    # Reclaim the same row far past max_attempts purely via lease-expiry
    # churn -- never calling fail_outbox, exactly like a repeatedly
    # crashing dispatcher or a flapping lease would. Each cycle's now_utc
    # must be past the previous cycle's claim_expires_at_utc (now + lease).
    for cycle in range(max_attempts + 5):
        now_utc = f"2026-01-01T{cycle + 1:02d}:00:00Z"
        claimed = repository.claim_outbox(
            "worker-a", limit=1, now_utc=now_utc, lease_seconds=1
        )
        assert [message.event_id for message in claimed] == ["deal-event-1"]
        assert claimed[0].attempt_count == cycle + 1

    row = journal.connection.execute(
        "SELECT state, delivery_failure_count FROM outbox_messages WHERE event_id = ?",
        ("deal-event-1",),
    ).fetchone()
    assert row == ("INFLIGHT", 0)  # never quarantined, never touched by fail_outbox
    journal.close()


def test_requeue_outbox_clears_quarantine_and_lookup_error_when_not_quarantined(
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
    with pytest.raises(LookupError):
        repository.requeue_outbox(
            "deal-event-1", operator="alice", now_utc="2026-01-01T00:03:00Z"
        )

    repository.claim_outbox("worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)
    repository.fail_outbox(
        "deal-event-1",
        error_class="MalformedEnvelope",
        error_redacted="MalformedEnvelope",
        retryable=False,
        now_utc="2026-01-01T00:03:00Z",
        backoff_config=BACKOFF,
        max_attempts=8,
    )
    repository.requeue_outbox("deal-event-1", operator="alice", now_utc="2026-01-01T00:04:00Z")
    row = journal.connection.execute(
        "SELECT state, next_attempt_at_utc, quarantined_at_utc, delivery_failure_count "
        "FROM outbox_messages WHERE event_id = ?",
        ("deal-event-1",),
    ).fetchone()
    assert row[0] == "PENDING"
    assert row[1] == "2026-01-01T00:04:00Z"
    assert row[2] is None
    assert row[3] == 1  # audit trail preserved, not reset
    journal.close()


def test_ordering_gate_blocks_history_window_while_sibling_pending_or_inflight(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    commit_full_window(repository)

    claimed = repository.claim_outbox(
        "worker-a", limit=10, now_utc="2026-01-01T00:03:00Z", lease_seconds=30
    )
    claimed_ids = {message.event_id for message in claimed}
    assert "window-event-1" not in claimed_ids
    assert claimed_ids == {"deal-event-1", "order-event-1"}
    journal.close()


def test_ordering_gate_blocks_history_window_while_sibling_quarantined(tmp_path: Path) -> None:
    """Regression test for review finding B2: the first draft's gate only
    checked for PENDING/INFLIGHT siblings, which a QUARANTINED sibling
    would satisfy (falsely) -- it must block on QUARANTINED too."""
    journal, repository = open_repository(tmp_path)
    commit_full_window(repository)

    repository.claim_outbox("worker-a", limit=10, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)
    repository.fail_outbox(
        "deal-event-1",
        error_class="MalformedEnvelope",
        error_redacted="MalformedEnvelope",
        retryable=False,
        now_utc="2026-01-01T00:03:01Z",
        backoff_config=BACKOFF,
        max_attempts=8,
    )
    repository.ack_outbox("order-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:01Z")

    # deal-event-1 is QUARANTINED, order-event-1 is PUBLISHED -- window
    # must still be blocked.
    claimed = repository.claim_outbox(
        "worker-b", limit=10, now_utc="2026-01-01T00:04:00Z", lease_seconds=30
    )
    assert "window-event-1" not in {message.event_id for message in claimed}
    assert repository.has_blocking_sibling("window-1", "window-event-1") is True

    # Requeue and publish the quarantined sibling -- now the window
    # message becomes claimable.
    repository.requeue_outbox("deal-event-1", operator="alice", now_utc="2026-01-01T00:05:00Z")
    repository.claim_outbox("worker-c", limit=10, now_utc="2026-01-01T00:05:00Z", lease_seconds=30)
    repository.ack_outbox("deal-event-1", redis_entry_id="1-2", now_utc="2026-01-01T00:05:01Z")

    assert repository.has_blocking_sibling("window-1", "window-event-1") is False
    claimed = repository.claim_outbox(
        "worker-d", limit=10, now_utc="2026-01-01T00:06:00Z", lease_seconds=30
    )
    assert [message.event_id for message in claimed] == ["window-event-1"]
    journal.close()


def test_cleanup_deletes_only_old_published_rows_never_quarantined_or_active(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    commit_full_window(repository)
    repository.claim_outbox("worker-a", limit=10, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)
    repository.ack_outbox("deal-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:01Z")
    repository.fail_outbox(
        "order-event-1",
        error_class="MalformedEnvelope",
        error_redacted="MalformedEnvelope",
        retryable=False,
        now_utc="2026-01-01T00:03:02Z",
        backoff_config=BACKOFF,
        max_attempts=8,
    )
    # window-event-1 is still PENDING (blocked, never claimed above).

    deleted = repository.cleanup_published_outbox(published_before_utc="2026-01-02T00:00:00Z")
    assert deleted == 1  # only the PUBLISHED deal row
    remaining = {
        row[0]
        for row in journal.connection.execute("SELECT event_id FROM outbox_messages")
    }
    assert remaining == {"order-event-1", "window-event-1"}  # QUARANTINED + PENDING survive
    journal.close()


def test_cleanup_does_not_break_ordering_gate_for_still_pending_window(tmp_path: Path) -> None:
    """Regression test for review finding C3: cleanup deletes a PUBLISHED
    sibling out from under a still-pending window message; the gate's
    existence-of-non-published-row check must remain correct afterward,
    since a deleted row was -- by definition -- already PUBLISHED."""
    journal, repository = open_repository(tmp_path)
    commit_full_window(repository)
    repository.claim_outbox("worker-a", limit=10, now_utc="2026-01-01T00:03:00Z", lease_seconds=30)
    repository.ack_outbox("deal-event-1", redis_entry_id="1-1", now_utc="2026-01-01T00:03:01Z")
    repository.ack_outbox("order-event-1", redis_entry_id="1-2", now_utc="2026-01-01T00:03:01Z")
    # window-event-1 is still PENDING (never claimed this round).

    deleted = repository.cleanup_published_outbox(published_before_utc="2026-01-02T00:00:00Z")
    assert deleted == 2

    assert repository.has_blocking_sibling("window-1", "window-event-1") is False
    claimed = repository.claim_outbox(
        "worker-b", limit=10, now_utc="2026-01-01T00:04:00Z", lease_seconds=30
    )
    assert [message.event_id for message in claimed] == ["window-event-1"]
    journal.close()


def test_reclaimed_inflight_row_is_available_after_lease_expiry(tmp_path: Path) -> None:
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
    first = repository.claim_outbox(
        "worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=5
    )
    assert first[0].attempt_count == 1
    # Not acked -- simulates a crash between claim and publish.
    still_leased = repository.claim_outbox(
        "worker-b", limit=1, now_utc="2026-01-01T00:03:04Z", lease_seconds=5
    )
    assert still_leased == ()  # lease not expired yet
    reclaimed = repository.claim_outbox(
        "worker-b", limit=1, now_utc="2026-01-01T00:03:06Z", lease_seconds=5
    )
    assert [message.event_id for message in reclaimed] == ["deal-event-1"]
    assert reclaimed[0].attempt_count == 2
    journal.close()


def test_concurrent_dispatchers_never_double_claim(tmp_path: Path) -> None:
    """Two separate connections to the same journal file, both racing
    claim_outbox for the same batch of messages -- SQLite's BEGIN IMMEDIATE
    single-writer lock must ensure no event_id is claimed twice."""
    journal, repository = open_repository(tmp_path)
    checkpoint = expected_checkpoint()
    for index in range(6):
        base = window(deal_count=1, order_count=0)
        window_row = type(base)(
            **{
                **base.__dict__,
                "window_id": f"window-{index}",
                "start_raw": checkpoint.next_window_start_raw,
                "end_raw": checkpoint.next_window_start_raw + 1,
            }
        )
        checkpoint = repository.commit_window(
            checkpoint,
            window_row,
            (record("deal", f"deal-{index}", f"deal-event-{index}", f"digest-{index}"),),
            (
                OutboxMessage(
                    f"deal-event-{index}",
                    f"window-{index}",
                    "profile-a",
                    "mt5n:v1:stream:history:10001",
                    b'{"message_type":"history.deal"}',
                    f"digest-{index}",
                ),
                OutboxMessage(
                    f"window-event-{index}",
                    f"window-{index}",
                    "profile-a",
                    "mt5n:v1:stream:history:10001",
                    b'{"message_type":"history.window"}',
                    "window-digest",
                ),
            ),
        )
    journal.close()

    import sqlite3

    def make_repo() -> tuple[sqlite3.Connection, JournalRepository]:
        connection = sqlite3.connect(
            str(tmp_path / "journal.sqlite3"), timeout=5.0, check_same_thread=False
        )
        return connection, JournalRepository(connection)

    connection_a, repo_a = make_repo()
    connection_b, repo_b = make_repo()

    results: dict[str, tuple[str, ...]] = {}

    def worker(name: str, repo: JournalRepository) -> None:
        claimed = repo.claim_outbox(
            name, limit=6, now_utc="2026-01-01T00:03:00Z", lease_seconds=30
        )
        results[name] = tuple(message.event_id for message in claimed)

    thread_a = threading.Thread(target=worker, args=("worker-a", repo_a))
    thread_b = threading.Thread(target=worker, args=("worker-b", repo_b))
    thread_a.start()
    thread_b.start()
    thread_a.join()
    thread_b.join()

    all_claimed = results["worker-a"] + results["worker-b"]
    assert len(all_claimed) == len(set(all_claimed))  # no event_id claimed twice
    connection_a.close()
    connection_b.close()
