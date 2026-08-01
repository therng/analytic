from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from bridge.config import JournalConfig, TerminalProfile
from bridge.history import (
    HistoryPolicy,
    HistorySynchronizer,
    WindowOutcomeState,
)
from bridge.journal.connection import Journal
from bridge.journal.repository import (
    Checkpoint,
    CheckpointConflict,
    HistoryWindow,
    JournalRepository,
    OutboxMessage,
)
from bridge.models import (
    CallState,
    ProducerIdentity,
    TerminalIdentity,
)
from bridge.mt5_adapter import CallResult


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


class Adapter:
    def __init__(
        self,
        deals: tuple[dict[str, Any], ...],
        orders: tuple[dict[str, Any], ...] = (),
    ) -> None:
        self.deals = deals
        self.orders = orders

    def history_deals(self, _start: int, _end: int) -> CallResult:
        return CallResult(state=CallState.SUCCESS_NONEMPTY, rows=self.deals)

    def history_orders(self, _start: int, _end: int) -> CallResult:
        return CallResult(
            state=CallState.SUCCESS_NONEMPTY if self.orders else CallState.SUCCESS_EMPTY,
            rows=self.orders,
        )


class Session:
    def __init__(self, target: TerminalProfile, adapter: Adapter) -> None:
        self.profile = target
        self.adapter = adapter
        self.producer = ProducerIdentity(
            producer_id="producer-a",
            profile_id="profile-a",
            epoch_id="epoch-a",
            coordination_epoch="coordination-a",
            fencing_token=1,
        )
        self.terminal = TerminalIdentity(
            terminal_id="terminal-a",
            portable=True,
            path_digest="path-a",
            data_path_digest="data-a",
        )


class Boundary:
    def __init__(self, value: int = 200) -> None:
        self.value = value

    def safe_end(self, _profile: TerminalProfile) -> int:
        return self.value


def open_repository(tmp_path: Path) -> tuple[Journal, JournalRepository]:
    journal = Journal.open(
        JournalConfig.model_construct(path=str(tmp_path / "journal.sqlite3"))
    )
    repository = JournalRepository(journal.connection)
    repository.register_profile(
        profile_id=profile().profile_id,
        login=10001,
        server="Broker-Demo",
        terminal_id="terminal-a",
        config_digest="config-a",
        now_utc="2026-01-01T00:00:00Z",
    )
    return journal, repository


def synchronizer(repository: JournalRepository) -> HistorySynchronizer:
    return HistorySynchronizer(
        repository=repository,
        boundary_provider=Boundary(),
        policy=HistoryPolicy(
            maximum_window_raw=200, overlap_raw=0, policy_version=1
        ),
        observed_at_utc=lambda: "2026-01-01T00:00:01Z",
        revalidate=lambda _session: None,
    )


def checkpoint() -> Checkpoint:
    return Checkpoint(
        profile_id=profile().profile_id,
        generation=1,
        next_window_start_raw=100,
        last_window_id=None,
        policy_version=1,
        updated_at_utc="2026-01-01T00:00:00Z",
    )


def legacy_window(start_raw: int, end_raw: int) -> HistoryWindow:
    return HistoryWindow(
        window_id=f"legacy-{start_raw}-{end_raw}",
        profile_id=profile().profile_id,
        generation=1,
        window_revision=1,
        start_raw=start_raw,
        end_raw=end_raw,
        policy_version=1,
        deal_count=0,
        order_count=0,
        deal_digest="deals",
        order_digest="orders",
        window_digest="window",
        observed_started_at_utc="2026-01-01T00:00:00Z",
        observed_finished_at_utc="2026-01-01T00:00:01Z",
        committed_at_utc="2026-01-01T00:00:02Z",
    )


def legacy_window_outbox(window: HistoryWindow) -> tuple[OutboxMessage, ...]:
    return (
        OutboxMessage(
            event_id=f"event-{window.window_id}",
            window_id=window.window_id,
            profile_id=window.profile_id,
            stream_key="mt5:account:10001:stream:history",
            envelope_json=b'{"message_type":"history.window"}',
            payload_digest=window.window_digest,
        ),
    )


def test_reconciliation_is_unchanged_for_identical_content(tmp_path: Path) -> None:
    journal, repository = open_repository(tmp_path)
    sync = synchronizer(repository)
    session = Session(
        profile(), Adapter(({"ticket": 1, "time": 100, "time_msc": 100},))
    )
    first = sync.run_next_window(session, checkpoint())

    replay = sync.reconcile(session, first.window.window_id)  # type: ignore[union-attr]

    assert replay.state is WindowOutcomeState.UNCHANGED
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 1
    )
    journal.close()


def test_reconciliation_late_record_or_correction_supersedes_prior(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    sync = synchronizer(repository)
    session = Session(
        profile(),
        Adapter(({"ticket": 1, "time": 100, "time_msc": 100, "profit": 1},)),
    )
    first = sync.run_next_window(session, checkpoint())
    before = journal.connection.execute(
        "SELECT next_window_start_raw, last_window_id FROM history_checkpoints"
    ).fetchone()
    session.adapter.deals = (
        {"ticket": 1, "time": 100, "time_msc": 100, "profit": 2},
        {"ticket": 2, "time": 101, "time_msc": 101, "profit": 3},
    )

    replay = sync.reconcile(session, first.window.window_id)  # type: ignore[union-attr]

    assert replay.state is WindowOutcomeState.RECONCILED
    assert journal.connection.execute(
        "SELECT state FROM history_windows WHERE window_id = ?",
        (first.window.window_id,),
    ).fetchone()[0] == "SUPERSEDED"  # type: ignore[union-attr]
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 2
    )
    assert journal.connection.execute(
        "SELECT next_window_start_raw, last_window_id FROM history_checkpoints"
    ).fetchone() == before
    journal.close()


def test_reconciliation_window_envelope_records_revision_and_supersession(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    sync = synchronizer(repository)
    session = Session(
        profile(),
        Adapter(({"ticket": 1, "time": 100, "time_msc": 100, "profit": 1},)),
    )
    first = sync.run_next_window(session, checkpoint())
    session.adapter.deals = (
        {"ticket": 1, "time": 100, "time_msc": 100, "profit": 2},
    )

    replay = sync.reconcile(session, first.window.window_id)  # type: ignore[union-attr]

    row = journal.connection.execute(
        "SELECT envelope_json FROM outbox_messages WHERE window_id = ? "
        "AND envelope_json LIKE '%history.window%'",
        (replay.window.window_id,),  # type: ignore[union-attr]
    ).fetchone()
    assert row is not None
    payload = json.loads(bytes(row[0]))["payload"]
    assert payload["window_revision"] == 2
    assert payload["supersedes_window_id"] == first.window.window_id  # type: ignore[union-attr]
    assert payload["window_id"] == replay.window.window_id  # type: ignore[union-attr]

    journal.close()


def test_first_commit_rejects_fabricated_checkpoint_instead_of_skipping_history(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    sync = HistorySynchronizer(
        repository=repository,
        boundary_provider=Boundary(400),
        policy=HistoryPolicy(
            maximum_window_raw=200, overlap_raw=0, policy_version=1
        ),
        observed_at_utc=lambda: "2026-01-01T00:00:01Z",
        revalidate=lambda _session: None,
    )
    session = Session(profile(), Adapter(()))
    fabricated = Checkpoint(
        profile_id=profile().profile_id,
        generation=2,
        next_window_start_raw=300,
        last_window_id=None,
        policy_version=1,
        updated_at_utc="2026-01-01T00:00:00Z",
    )

    outcome = sync.run_next_window(session, fabricated)

    assert outcome.state is WindowOutcomeState.ABORTED
    assert journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0] == 0
    journal.close()


def test_fresh_repository_rejects_legacy_positional_checkpoint_bootstrap(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    window = legacy_window(300, 400)
    fabricated = Checkpoint(
        profile_id=profile().profile_id,
        generation=1,
        next_window_start_raw=300,
        last_window_id=None,
        policy_version=1,
        updated_at_utc="2026-01-01T00:00:00Z",
    )

    with pytest.raises(CheckpointConflict):
        repository.commit_window(fabricated, window, (), legacy_window_outbox(window))

    assert journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0] == 0
    journal.close()


def test_legacy_positional_commit_remains_valid_after_durable_bootstrap(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    sync = synchronizer(repository)
    first = sync.run_next_window(Session(profile(), Adapter(())), checkpoint())
    window = legacy_window(200, 300)

    next_checkpoint = repository.commit_window(
        first.checkpoint,  # type: ignore[arg-type]
        window,
        (),
        legacy_window_outbox(window),
    )

    assert next_checkpoint.next_window_start_raw == 300
    journal.close()


def test_overlapping_forward_window_reuses_exact_record_version_and_outbox_event(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    boundary = Boundary()
    sync = HistorySynchronizer(
        repository=repository,
        boundary_provider=boundary,
        policy=HistoryPolicy(
            maximum_window_raw=200, overlap_raw=20, policy_version=1
        ),
        observed_at_utc=lambda: "2026-01-01T00:00:01Z",
        revalidate=lambda _session: None,
    )
    session = Session(
        profile(), Adapter(({"ticket": 1, "time": 180, "time_msc": 180},))
    )
    first = sync.run_next_window(session, checkpoint())
    boundary.value = 300

    second = sync.run_next_window(session, first.checkpoint)  # type: ignore[arg-type]

    assert second.state is WindowOutcomeState.COMMITTED
    assert second.window is not None
    assert (second.window.start_raw, second.window.end_raw) == (180, 300)
    assert journal.connection.execute(
        "SELECT COUNT(*) FROM history_record_versions"
    ).fetchone()[0] == 1
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM outbox_messages").fetchone()[0]
        == 3
    )
    journal.close()


def test_deduped_overlap_keeps_per_resource_ordinals_for_late_records(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    boundary = Boundary()
    sync = HistorySynchronizer(
        repository=repository,
        boundary_provider=boundary,
        policy=HistoryPolicy(
            maximum_window_raw=200, overlap_raw=20, policy_version=1
        ),
        observed_at_utc=lambda: "2026-01-01T00:00:01Z",
        revalidate=lambda _session: None,
    )
    session = Session(
        profile(), Adapter(({"ticket": 1, "time": 180, "time_msc": 180},))
    )
    first = sync.run_next_window(session, checkpoint())
    boundary.value = 300
    session.adapter.deals = (
        {"ticket": 1, "time": 180, "time_msc": 180},
        {"ticket": 2, "time": 181, "time_msc": 181},
    )
    session.adapter.orders = (
        {
            "ticket": 3,
            "time_done": 182,
            "time_done_msc": 182,
            "time_setup": 179,
            "time_setup_msc": 179,
        },
    )

    replay = sync.run_next_window(session, first.checkpoint)  # type: ignore[arg-type]

    rows = journal.connection.execute(
        "SELECT envelope_json FROM outbox_messages WHERE window_id = ?",
        (replay.window.window_id,),  # type: ignore[union-attr]
    ).fetchall()
    payloads = {
        json.loads(bytes(row[0]))["message_type"]: json.loads(bytes(row[0]))[
            "payload"
        ]
        for row in rows
    }
    assert payloads["history.deal"]["raw"]["ticket"] == 2
    assert payloads["history.deal"]["ordinal"] == 1
    assert payloads["history.order"]["raw"]["ticket"] == 3
    assert payloads["history.order"]["ordinal"] == 0
    journal.close()


def test_reconciliation_failure_rolls_back_new_revision_and_supersession(
    tmp_path: Path,
) -> None:
    journal, repository = open_repository(tmp_path)
    sync = synchronizer(repository)
    session = Session(
        profile(),
        Adapter(({"ticket": 1, "time": 100, "time_msc": 100, "profit": 1},)),
    )
    first = sync.run_next_window(session, checkpoint())
    session.adapter.deals = (
        {"ticket": 1, "time": 100, "time_msc": 100, "profit": 2},
    )
    repository.failure_injector = lambda label: (
        (_ for _ in ()).throw(RuntimeError("injected"))
        if label == "before_prior_window_supersede"
        else None
    )

    outcome = sync.reconcile(
        session, first.window.window_id  # type: ignore[union-attr]
    )

    assert outcome.state is WindowOutcomeState.ABORTED
    assert (
        journal.connection.execute("SELECT COUNT(*) FROM history_windows").fetchone()[0]
        == 1
    )
    assert journal.connection.execute(
        "SELECT state FROM history_windows WHERE window_id = ?",
        (first.window.window_id,),
    ).fetchone()[0] == "COMMITTED"  # type: ignore[union-attr]
    journal.close()
