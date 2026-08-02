from __future__ import annotations

import sys
from types import SimpleNamespace
from pathlib import Path

import pytest

from bridge.journal.repository import (
    Checkpoint,
    HistoryRecord,
    HistoryWindow,
    JournalRepository,
    OutboxMessage,
)
from bridge.replay_published_outbox import FencedReplayTarget, PublishedOutboxReplay
from bridge.redis_transport import FenceCredential
from bridge.scripts import replay_published_outbox as replay_script
from bridge.scripts.replay_published_outbox import main


class FakeReplayTarget:
    def __init__(self) -> None:
        self.entries: list[tuple[str, dict[str, str | bytes]]] = []
        self.values: dict[str, bytes] = {}
        self.block_recovery_lock = False

    def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    def set(
        self, key: str, value: bytes, *, nx: bool = False, px: int | None = None
    ) -> bool:
        del px
        if self.block_recovery_lock and key.endswith(":lock"):
            return False
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    def xadd(self, stream: str, fields: dict[str, str | bytes]) -> str:
        self.entries.append((stream, fields))
        return f"{len(self.entries)}-0"


def test_fenced_target_delegates_history_append_to_the_lease() -> None:
    class Lease:
        def __init__(self) -> None:
            self.calls: list[tuple[object, str, bytes]] = []

        def append_stream_fenced(self, credential: object, event_id: str, envelope: bytes) -> str:
            self.calls.append((credential, event_id, envelope))
            return "1-0"

    raw_target = FakeReplayTarget()
    lease = Lease()
    credential = FenceCredential(10001, "replay", "epoch", "coordination", 1)

    result = FencedReplayTarget(raw_target, lease, credential).xadd(
        "mt5:account:{10001}:stream:history",
        {"event_id": "deal-event", "envelope": b'{"message_type":"history.deal"}'},
    )

    assert result == "1-0"
    assert lease.calls == [
        (credential, "deal-event", b'{"message_type":"history.deal"}')
    ]
    assert raw_target.entries == []


def _checkpoint() -> Checkpoint:
    return Checkpoint(
        profile_id="profile-a",
        generation=1,
        next_window_start_raw=100,
        last_window_id=None,
        policy_version=1,
        updated_at_utc="2026-01-01T00:00:00Z",
    )


def _window() -> HistoryWindow:
    return HistoryWindow(
        window_id="window-1",
        profile_id="profile-a",
        generation=1,
        window_revision=1,
        start_raw=100,
        end_raw=200,
        policy_version=1,
        deal_count=1,
        order_count=0,
        deal_digest="deal-digest",
        order_digest="",
        window_digest="window-digest",
        observed_started_at_utc="2026-01-01T00:00:00Z",
        observed_finished_at_utc="2026-01-01T00:01:00Z",
        committed_at_utc="2026-01-01T00:02:00Z",
    )


def _seed_published_journal(path: Path) -> None:
    from bridge.config import JournalConfig
    from bridge.journal.connection import Journal

    journal = Journal.open(JournalConfig.model_construct(path=str(path), busy_timeout_ms=100))
    repository = JournalRepository(journal.connection)
    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="config-a",
        now_utc="2026-01-01T00:00:00Z",
    )
    journal.connection.execute(
        "INSERT INTO history_checkpoints("
        "profile_id, generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc"
        ") VALUES (?, ?, ?, ?, ?, ?)",
        ("profile-a", 1, 100, None, 1, "2026-01-01T00:00:00Z"),
    )
    repository.commit_window(
        _checkpoint(),
        _window(),
        (
            HistoryRecord(
                resource="deal",
                natural_id="deal-1",
                event_id="deal-event",
                payload_json=b'{"ticket":"deal-1"}',
                payload_digest="deal-digest",
            ),
        ),
        (
            OutboxMessage(
                event_id="deal-event",
                window_id="window-1",
                profile_id="profile-a",
                stream_key="mt5:account:{10001}:stream:history",
                envelope_json=b'{"message_type":"history.deal"}',
                payload_digest="deal-digest",
            ),
            OutboxMessage(
                event_id="window-event",
                window_id="window-1",
                profile_id="profile-a",
                stream_key="mt5:account:{10001}:stream:history",
                envelope_json=b'{"message_type":"history.window"}',
                payload_digest="window-digest",
            ),
        ),
    )
    first_claim = repository.claim_outbox(
        "worker-a", limit=2, now_utc="2026-01-01T00:03:00Z", lease_seconds=30
    )
    repository.ack_outbox(
        first_claim[0].event_id, redis_entry_id="1-1", now_utc="2026-01-01T00:03:01Z"
    )
    second_claim = repository.claim_outbox(
        "worker-a", limit=2, now_utc="2026-01-01T00:03:02Z", lease_seconds=30
    )
    repository.ack_outbox(
        second_claim[0].event_id, redis_entry_id="2-1", now_utc="2026-01-01T00:03:03Z"
    )
    journal.close()


def test_read_messages_orders_records_before_window_without_mutating_source(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite3"
    _seed_published_journal(journal_path)
    before = journal_path.read_bytes()

    messages = PublishedOutboxReplay(journal_path, login=10001).read_messages()

    assert [(message.event_id, message.envelope) for message in messages] == [
        ("deal-event", b'{"message_type":"history.deal"}'),
        ("window-event", b'{"message_type":"history.window"}'),
    ]
    assert journal_path.read_bytes() == before


def test_replay_appends_immutable_messages_once_per_target(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite3"
    _seed_published_journal(journal_path)
    before = journal_path.read_bytes()
    replay = PublishedOutboxReplay(journal_path, login=10001)
    target = FakeReplayTarget()

    result = replay.replay(target, target_id="postgres-reset-20260803")

    assert result.published_count == 2
    assert target.entries == [
        (
            "mt5:account:{10001}:stream:history",
            {"event_id": "deal-event", "envelope": b'{"message_type":"history.deal"}'},
        ),
        (
            "mt5:account:{10001}:stream:history",
            {"event_id": "window-event", "envelope": b'{"message_type":"history.window"}'},
        ),
    ]
    assert journal_path.read_bytes() == before


def test_replay_refuses_a_completed_target_without_appending_duplicates(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite3"
    _seed_published_journal(journal_path)
    replay = PublishedOutboxReplay(journal_path, login=10001)
    target = FakeReplayTarget()
    replay.replay(target, target_id="postgres-reset-20260803")

    with pytest.raises(
        RuntimeError, match="published outbox replay already completed for target"
    ):
        replay.replay(target, target_id="postgres-reset-20260803")

    assert len(target.entries) == 2


def test_replay_rejects_a_mismatched_source_stream_before_target_append(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite3"
    _seed_published_journal(journal_path)
    from bridge.config import JournalConfig
    from bridge.journal.connection import Journal

    journal = Journal.open(JournalConfig.model_construct(path=str(journal_path), busy_timeout_ms=100))
    journal.connection.execute("UPDATE outbox_messages SET stream_key = 'wrong-stream'")
    journal.connection.commit()
    journal.close()
    target = FakeReplayTarget()

    with pytest.raises(RuntimeError, match="stream does not match login"):
        PublishedOutboxReplay(journal_path, login=10001).replay(
            target, target_id="postgres-reset-20260803"
        )

    assert target.entries == []


def test_replay_refuses_a_target_held_by_another_recovery_before_append(tmp_path: Path) -> None:
    journal_path = tmp_path / "journal.sqlite3"
    _seed_published_journal(journal_path)
    target = FakeReplayTarget()
    target.block_recovery_lock = True

    with pytest.raises(RuntimeError, match="recovery lock is unavailable"):
        PublishedOutboxReplay(journal_path, login=10001).replay(
            target, target_id="postgres-reset-20260803"
        )

    assert target.entries == []


def test_cli_requires_explicit_confirmation_before_loading_redis(tmp_path: Path, capsys) -> None:
    exit_code = main(
        [
            "--journal",
            str(tmp_path / "journal.sqlite3"),
            "--login",
            "10001",
            "--target-id",
            "postgres-reset-20260803",
        ]
    )

    assert exit_code == 2
    assert "REPLAY_PUBLISHED_OUTBOX" in capsys.readouterr().err


def test_cli_acquires_and_releases_the_native_lease_for_replay(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    journal_path = tmp_path / "journal.sqlite3"
    _seed_published_journal(journal_path)
    target = FakeReplayTarget()

    class Lease:
        acquired = False
        released = False

        def __init__(self, client: FakeReplayTarget) -> None:
            assert client is target

        def acquire(self, login: int, owner_id: str, producer_epoch_id: str, ttl_ms: int) -> FenceCredential:
            assert login == 10001
            assert owner_id.startswith("published-outbox-replay:")
            assert producer_epoch_id
            assert ttl_ms == 1_800_000
            Lease.acquired = True
            return FenceCredential(login, owner_id, producer_epoch_id, "epoch", 1)

        def append_stream_fenced(
            self, credential: FenceCredential, event_id: str, envelope: bytes
        ) -> str:
            return target.xadd(
                "mt5:account:{10001}:stream:history",
                {"event_id": event_id, "envelope": envelope},
            )

        def release(self, credential: FenceCredential) -> None:
            Lease.released = True

    monkeypatch.setenv("REDIS_URL", "redis://safe-test")
    monkeypatch.setitem(sys.modules, "redis", SimpleNamespace(Redis=SimpleNamespace(from_url=lambda _: target)))
    monkeypatch.setattr(replay_script, "RedisLease", Lease, raising=False)

    exit_code = main(
        [
            "--journal",
            str(journal_path),
            "--login",
            "10001",
            "--target-id",
            "postgres-reset-20260803",
            "--confirm",
            "REPLAY_PUBLISHED_OUTBOX",
        ]
    )

    assert exit_code == 0
    assert Lease.acquired is True
    assert Lease.released is True
    assert "published=2" in capsys.readouterr().out
