from __future__ import annotations

import sqlite3
import stat
from datetime import UTC, datetime
from pathlib import Path

import pytest

from bridge.config import JournalConfig
from bridge.journal.connection import (
    Journal,
    _configure_connection,
    _validate_windows_acl,
)
from bridge.journal.repository import (
    Checkpoint,
    CheckpointConflict,
    HistoryRecord,
    HistoryWindow,
    JournalRepository,
    OutboxMessage,
)

# ruff: noqa: E501


def utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def open_repository(tmp_path: Path) -> tuple[Journal, JournalRepository]:
    config = JournalConfig.model_construct(
        path=str(tmp_path / "journal.sqlite3"), busy_timeout_ms=321
    )
    journal = Journal.open(config)
    repository = JournalRepository(journal.connection)
    repository.register_profile(
        profile_id="profile-a",
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="config-a",
        now_utc=utc(),
    )
    journal.connection.execute(
        "INSERT INTO history_checkpoints("
        "profile_id, generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc"
        ") VALUES (?, ?, ?, ?, ?, ?)",
        ("profile-a", 1, 100, None, 1, "2026-01-01T00:00:00Z"),
    )
    return journal, repository


def window(deal_count: int = 1, order_count: int = 1) -> HistoryWindow:
    return HistoryWindow(
        window_id="window-1",
        profile_id="profile-a",
        generation=1,
        window_revision=1,
        start_raw=100,
        end_raw=200,
        policy_version=1,
        deal_count=deal_count,
        order_count=order_count,
        deal_digest="deals",
        order_digest="orders",
        window_digest="window-digest",
        observed_started_at_utc="2026-01-01T00:00:00Z",
        observed_finished_at_utc="2026-01-01T00:01:00Z",
        committed_at_utc="2026-01-01T00:02:00Z",
    )


def record(resource: str, natural_id: str, event_id: str, digest: str) -> HistoryRecord:
    return HistoryRecord(
        resource=resource,  # type: ignore[arg-type]
        natural_id=natural_id,
        event_id=event_id,
        payload_json=('{"ticket":"' + natural_id + '"}').encode(),
        payload_digest=digest,
    )


def outbox(event_id: str, payload_digest: str, message_type: str) -> OutboxMessage:
    return OutboxMessage(
        event_id=event_id,
        window_id="window-1",
        profile_id="profile-a",
        stream_key="mt5n:v1:stream:history:10001",
        envelope_json=('{"message_type":"' + message_type + '"}').encode(),
        payload_digest=payload_digest,
    )


def expected_checkpoint() -> Checkpoint:
    return Checkpoint(
        profile_id="profile-a",
        generation=1,
        next_window_start_raw=100,
        last_window_id=None,
        policy_version=1,
        updated_at_utc="2026-01-01T00:00:00Z",
    )


def test_open_applies_durable_pragmas_and_schema_constraints(tmp_path: Path) -> None:
    journal, _ = open_repository(tmp_path)
    connection = journal.connection

    assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert connection.execute("PRAGMA synchronous").fetchone()[0] == 2
    assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 321
    assert connection.execute("PRAGMA trusted_schema").fetchone()[0] == 0

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO producer_profiles(profile_id, login, server, terminal_id, config_digest, created_at_utc, last_verified_at_utc) VALUES ('other', 10001, 's', 't', 'c', 'now', 'now')"
        )
    columns = {
        row[1]
        for table in (
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        )
        for row in connection.execute(f"PRAGMA table_info({table})")
    }
    assert (
        not {"password", "secret", "token", "credential", "connection_string"} & columns
    )
    journal.close()


def test_open_rejects_group_writable_journal_parent(tmp_path: Path) -> None:
    unsafe = tmp_path / "unsafe"
    unsafe.mkdir()
    unsafe.chmod(stat.S_IRWXU | stat.S_IRWXG)
    config = JournalConfig.model_construct(
        path=str(unsafe / "journal.sqlite3"), busy_timeout_ms=100
    )

    with pytest.raises(ValueError, match="restricted to the service identity"):
        Journal.open(config)


def test_open_rejects_symlinked_journal_path_components(tmp_path: Path) -> None:
    protected = tmp_path / "protected"
    protected.mkdir()
    protected.chmod(stat.S_IRWXU)
    link = tmp_path / "link"
    link.symlink_to(protected, target_is_directory=True)
    config = JournalConfig.model_construct(
        path=str(link / "journal.sqlite3"), busy_timeout_ms=100
    )

    with pytest.raises(ValueError, match="symlink"):
        Journal.open(config)

    journal_path = protected / "journal.sqlite3"
    journal_path.symlink_to(protected / "other.sqlite3")
    config = JournalConfig.model_construct(path=str(journal_path), busy_timeout_ms=100)
    with pytest.raises(ValueError, match="symlink"):
        Journal.open(config)


def test_pragma_configuration_rejects_weaker_effective_values() -> None:
    class Result:
        def __init__(self, value: int | str) -> None:
            self.value = value

        def fetchone(self) -> tuple[int | str]:
            return (self.value,)

    class Connection:
        def execute(self, statement: str) -> Result:
            values: dict[str, int | str] = {
                "PRAGMA journal_mode = WAL": "wal",
                "PRAGMA synchronous": 1,
                "PRAGMA foreign_keys": 1,
                "PRAGMA busy_timeout": 321,
                "PRAGMA trusted_schema": 0,
            }
            return Result(values.get(statement, 0))

    with pytest.raises(RuntimeError, match="durability pragmas"):
        _configure_connection(Connection(), 321)  # type: ignore[arg-type]


def test_windows_acl_policy_accepts_only_current_service_dacl() -> None:
    class Security:
        def owner_is_current_service(self, path: Path) -> bool:
            return True

        def dacl_allows_only_current_service(self, path: Path) -> bool:
            return True

    _validate_windows_acl(Path("C:/journal.sqlite3"), Security())


@pytest.mark.parametrize("owner, dacl", ((False, True), (True, False)))
def test_windows_acl_policy_fails_closed_for_unverifiable_access(
    owner: bool, dacl: bool
) -> None:
    class Security:
        def owner_is_current_service(self, path: Path) -> bool:
            return owner

        def dacl_allows_only_current_service(self, path: Path) -> bool:
            return dacl

    with pytest.raises(ValueError, match="service identity"):
        _validate_windows_acl(Path("C:/journal.sqlite3"), Security())


def test_commit_window_persists_versions_memberships_outbox_and_checkpoint_together(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    records = (
        record("deal", "deal-1", "deal-event-1", "deal-digest-1"),
        record("order", "order-1", "order-event-1", "order-digest-1"),
    )
    checkpoint = repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=1),
        records,
        (
            outbox("deal-event-1", "deal-digest-1", "history.deal"),
            outbox("order-event-1", "order-digest-1", "history.order"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )

    assert checkpoint.next_window_start_raw == 200
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 1
    )
    assert (
        journal.connection.execute(
            "SELECT COUNT(*) FROM history_record_versions"
        ).fetchone()[0]
        == 2
    )
    memberships = journal.connection.execute(
        "SELECT resource, ordinal FROM history_window_records ORDER BY resource, ordinal"
    ).fetchall()
    assert [(row[0], row[1]) for row in memberships] == [("deal", 0), ("order", 0)]
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0]
        == 3
    )
    journal.close()


def test_changed_payload_creates_linked_correction_while_exact_version_is_reused(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    original = record("deal", "deal-1", "event-1", "digest-1")
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (original,),
        (
            outbox("event-1", "digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )
    corrected = record("deal", "deal-1", "event-2", "digest-2")
    revised = HistoryWindow(
        **{
            **window(deal_count=1, order_count=0).__dict__,
            "window_id": "window-2",
            "window_revision": 2,
            "start_raw": 200,
            "end_raw": 300,
        }
    )
    repository.commit_window(
        Checkpoint("profile-a", 1, 200, "window-1", 1, "2026-01-01T00:02:00Z"),
        revised,
        (corrected,),
        (
            OutboxMessage(
                "event-2",
                "window-2",
                "profile-a",
                "stream",
                b'{"message_type":"history.deal"}',
                "digest-2",
            ),
            OutboxMessage(
                "window-event-2",
                "window-2",
                "profile-a",
                "stream",
                b'{"message_type":"history.window"}',
                "window-digest",
            ),
        ),
    )

    versions = journal.connection.execute(
        "SELECT event_id, correction_of FROM history_record_versions ORDER BY event_id"
    ).fetchall()
    assert versions[0][1] is None
    assert versions[1][1] is not None
    journal.close()


def test_exact_payload_version_is_reused_by_later_window(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    original = record("deal", "deal-1", "event-1", "digest-1")
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (original,),
        (
            outbox("event-1", "digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )
    replay_window = HistoryWindow(
        **{
            **window(deal_count=1, order_count=0).__dict__,
            "window_id": "window-2",
            "window_revision": 2,
            "start_raw": 200,
            "end_raw": 300,
        }
    )
    repository.commit_window(
        Checkpoint("profile-a", 1, 200, "window-1", 1, "2026-01-01T00:02:00Z"),
        replay_window,
        (original,),
        (
            OutboxMessage(
                "window-event-2",
                "window-2",
                "profile-a",
                "stream",
                b'{"message_type":"history.window"}',
                "window-digest",
            ),
        ),
    )

    assert (
        journal.connection.execute(
            "SELECT COUNT(*) FROM history_record_versions"
        ).fetchone()[0]
        == 1
    )
    journal.close()


@pytest.mark.parametrize(
    "failure_label",
    (
        "before_begin",
        "before_checkpoint_read",
        "before_window_insert",
        "before_record_lookup",
        "before_correction_lookup",
        "before_record_version_insert",
        "before_membership_insert",
        "before_outbox_existing_read",
        "before_outbox_existing_read",
        "before_outbox_insert",
        "before_checkpoint_upsert",
        "before_commit",
    ),
)
def test_commit_window_rolls_back_every_write_when_failure_is_injected(
    tmp_path: Path, failure_label: str
) -> None:
    journal, repository = open_repository(tmp_path)

    def fail_at_checkpoint(label: str) -> None:
        if label == failure_label:
            raise RuntimeError("injected")

    repository.failure_injector = fail_at_checkpoint
    with pytest.raises(RuntimeError, match="injected"):
        repository.commit_window(
            expected_checkpoint(),
            window(deal_count=1, order_count=0),
            (record("deal", "deal-1", "event-1", "digest-1"),),
            (
                outbox("event-1", "digest-1", "history.deal"),
                outbox("window-event-1", "window-digest", "history.window"),
            ),
        )

    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute(
            "SELECT COUNT(*) FROM history_record_versions"
        ).fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute(
            "SELECT COUNT(*) FROM history_checkpoints"
        ).fetchone()[0]
        == 1
    )
    journal.close()


def test_record_outbox_reuse_check_is_transactional(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    original = record("deal", "deal-1", "event-1", "digest-1")
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=1, order_count=0),
        (original,),
        (
            outbox("event-1", "digest-1", "history.deal"),
            outbox("window-event-1", "window-digest", "history.window"),
        ),
    )

    repository.failure_injector = lambda label: (
        (_ for _ in ()).throw(RuntimeError("injected"))
        if label == "before_existing_record_outbox_read"
        else None
    )
    with pytest.raises(RuntimeError, match="injected"):
        repository.commit_window(
            Checkpoint("profile-a", 1, 200, "window-1", 1, "2026-01-01T00:02:00Z"),
            HistoryWindow(
                **{
                    **window(deal_count=1, order_count=0).__dict__,
                    "window_id": "window-2",
                    "window_revision": 2,
                    "start_raw": 200,
                    "end_raw": 300,
                }
            ),
            (original,),
            (
                OutboxMessage(
                    "window-event-2",
                    "window-2",
                    "profile-a",
                    "stream",
                    b'{"message_type":"history.window"}',
                    "window-digest",
                ),
            ),
        )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 1
    )
    assert (
        journal.connection.execute(
            "SELECT COUNT(*) FROM history_checkpoints"
        ).fetchone()[0]
        == 1
    )
    journal.close()


@pytest.mark.parametrize(
    "failure_label",
    (
        "before_begin",
        "before_checkpoint_read",
        "before_window_insert",
        "before_outbox_existing_read",
        "before_outbox_insert",
        "before_checkpoint_upsert",
        "before_commit",
    ),
)
def test_empty_window_rolls_back_at_every_reachable_statement_boundary(
    tmp_path: Path, failure_label: str
) -> None:
    journal, repository = open_repository(tmp_path)
    repository.failure_injector = lambda label: (
        (_ for _ in ()).throw(RuntimeError("injected"))
        if label == failure_label
        else None
    )

    with pytest.raises(RuntimeError, match="injected"):
        repository.commit_window(
            expected_checkpoint(),
            window(deal_count=0, order_count=0),
            (),
            (outbox("window-event-1", "window-digest", "history.window"),),
        )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute(
            "SELECT COUNT(*) FROM history_checkpoints"
        ).fetchone()[0]
        == 1
    )
    journal.close()


def test_checkpoint_compare_and_swap_and_expiring_outbox_claims(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    repository.commit_window(
        expected_checkpoint(),
        window(deal_count=0, order_count=0),
        (),
        (outbox("window-event-1", "window-digest", "history.window"),),
    )

    with pytest.raises(CheckpointConflict):
        repository.commit_window(
            expected_checkpoint(),
            HistoryWindow(
                **{
                    **window(deal_count=0, order_count=0).__dict__,
                    "window_id": "wrong-checkpoint",
                    "window_revision": 2,
                }
            ),
            (),
            (
                OutboxMessage(
                    "window-event-2",
                    "wrong-checkpoint",
                    "profile-a",
                    "stream",
                    b'{"message_type":"history.window"}',
                    "window-digest",
                ),
            ),
        )
    claimed = repository.claim_outbox(
        "worker-a", limit=1, now_utc="2026-01-01T00:03:00Z", lease_seconds=30
    )
    assert [message.event_id for message in claimed] == ["window-event-1"]
    reclaimed = repository.claim_outbox(
        "worker-b", limit=1, now_utc="2026-01-01T00:04:00Z", lease_seconds=30
    )
    assert [message.event_id for message in reclaimed] == ["window-event-1"]
    assert reclaimed[0].attempt_count == 2
    journal.close()


@pytest.mark.parametrize(
    ("records", "messages", "match"),
    (
        (
            (),
            (),
            "history.window",
        ),
        (
            (),
            (
                outbox("window-event-1", "window-digest", "history.window"),
                outbox("window-event-2", "window-digest", "history.window"),
            ),
            "exactly one",
        ),
        (
            (record("deal", "deal-1", "event-1", "deal-digest-1"),),
            (outbox("window-event-1", "window-digest", "history.window"),),
            "record outbox",
        ),
        (
            (record("deal", "deal-1", "event-1", "deal-digest-1"),),
            (
                outbox("event-1", "deal-digest-1", "history.order"),
                outbox("window-event-1", "window-digest", "history.window"),
            ),
            "message type",
        ),
    ),
)
def test_commit_window_rejects_incomplete_or_invalid_outbox_coverage(
    tmp_path: Path,
    records: tuple[HistoryRecord, ...],
    messages: tuple[OutboxMessage, ...],
    match: str,
) -> None:
    journal, repository = open_repository(tmp_path)
    with pytest.raises(ValueError, match=match):
        repository.commit_window(
            expected_checkpoint(),
            window(deal_count=1, order_count=0),
            records,
            messages,
        )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0]
        == 0
    )
    journal.close()


def test_commit_window_rejects_outbox_profile_or_digest_not_owned_by_window(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    record_message = outbox("event-1", "deal-digest-1", "history.deal")
    wrong_profile = OutboxMessage(
        record_message.event_id,
        record_message.window_id,
        "profile-b",
        record_message.stream_key,
        record_message.envelope_json,
        record_message.payload_digest,
    )
    with pytest.raises(ValueError, match="profile"):
        repository.commit_window(
            expected_checkpoint(),
            window(deal_count=1, order_count=0),
            (record("deal", "deal-1", "event-1", "deal-digest-1"),),
            (
                wrong_profile,
                outbox("window-event-1", "window-digest", "history.window"),
            ),
        )
    with pytest.raises(ValueError, match="digest"):
        repository.commit_window(
            expected_checkpoint(),
            window(deal_count=1, order_count=0),
            (record("deal", "deal-1", "event-1", "deal-digest-1"),),
            (
                outbox("event-1", "deal-digest-1", "history.deal"),
                outbox("window-event-1", "wrong-digest", "history.window"),
            ),
        )
    journal.close()


@pytest.mark.parametrize(
    "records", ((), (record("deal", "deal-1", "event-1", "digest-1"),))
)
def test_commit_window_rejects_unbacked_record_outbox_events(
    tmp_path: Path, records: tuple[HistoryRecord, ...]
) -> None:
    journal, repository = open_repository(tmp_path)
    messages = (
        *((outbox("event-1", "digest-1", "history.deal"),) if records else ()),
        outbox("extra-event", "extra-digest", "history.deal"),
        outbox("window-event-1", "window-digest", "history.window"),
    )
    with pytest.raises(ValueError, match="unbacked"):
        repository.commit_window(
            expected_checkpoint(),
            window(deal_count=len(records), order_count=0),
            records,
            messages,
        )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 0
    )
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0]
        == 0
    )
    journal.close()
