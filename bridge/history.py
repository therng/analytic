from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from threading import Lock
from typing import Any, Protocol

from bridge.canonical import (
    canonical_json_bytes,
    history_window_id,
    record_event_id,
    sha256_hex,
)
from bridge.config import TerminalProfile
from bridge.journal.repository import (
    Checkpoint,
    CommittedWindowInput,
    HistoryRecord,
    HistoryWindow,
    JournalRepository,
    OutboxMessage,
)
from bridge.models import (
    AccountIdentity,
    BridgeEnvelope,
    CallState,
    ProducerIdentity,
    TerminalIdentity,
)
from bridge.mt5_adapter import CallResult
from bridge.redis_transport import RedisLease


class HistoryAdapter(Protocol):
    def history_deals(self, start_raw: int, end_raw: int) -> CallResult: ...

    def history_orders(self, start_raw: int, end_raw: int) -> CallResult: ...


class HistorySession(Protocol):
    profile: TerminalProfile
    adapter: HistoryAdapter
    producer: ProducerIdentity
    terminal: TerminalIdentity
    journal_profile_id: str


@dataclass(frozen=True)
class HistoryPolicy:
    maximum_window_raw: int
    overlap_raw: int
    policy_version: int

    def __post_init__(self) -> None:
        if self.maximum_window_raw <= 0:
            raise ValueError("maximum_window_raw must be positive")
        if self.overlap_raw < 0:
            raise ValueError("overlap_raw must not be negative")
        if self.overlap_raw >= self.maximum_window_raw:
            raise ValueError("overlap_raw must be smaller than maximum_window_raw")
        if self.policy_version <= 0:
            raise ValueError("policy_version must be positive")


class WindowOutcomeState(StrEnum):
    COMMITTED = "committed"
    RECONCILED = "reconciled"
    UNCHANGED = "unchanged"
    IDLE = "idle"
    ABORTED = "aborted"


@dataclass(frozen=True)
class WindowOutcome:
    state: WindowOutcomeState
    window: HistoryWindow | None = None
    checkpoint: Checkpoint | None = None
    reason: str | None = None


def _raw_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be a raw integer")
    return value


def _order_key(row: dict[str, Any]) -> tuple[int, int, int, int, int]:
    sentinel = -1
    return (
        _raw_int(row.get("time_done_msc", sentinel), "time_done_msc"),
        _raw_int(row.get("time_done", sentinel), "time_done"),
        _raw_int(row.get("time_setup_msc", sentinel), "time_setup_msc"),
        _raw_int(row.get("time_setup", sentinel), "time_setup"),
        _raw_int(row.get("ticket"), "ticket"),
    )


def _deal_key(row: dict[str, Any]) -> tuple[int, int, int]:
    sentinel = -1
    return (
        _raw_int(row.get("time_msc", sentinel), "time_msc"),
        _raw_int(row.get("time", sentinel), "time"),
        _raw_int(row.get("ticket"), "ticket"),
    )


class HistorySynchronizer:
    """Serial, fail-closed acquisition of one raw deal/order history window."""

    def __init__(
        self,
        *,
        repository: JournalRepository,
        boundary_provider: Any,
        policy: HistoryPolicy,
        observed_at_utc: Callable[[], str],
        revalidate: Callable[[HistorySession], None],
    ) -> None:
        self._repository = repository
        self._boundary_provider = boundary_provider
        self._policy = policy
        self._observed_at_utc = observed_at_utc
        self._revalidate = revalidate
        self._call_lock = Lock()

    def run_next_window(
        self, session: HistorySession, checkpoint: Checkpoint | None
    ) -> WindowOutcome:
        with self._call_lock:
            return self._run_next_window(session, checkpoint)

    def _run_next_window(
        self, session: HistorySession, checkpoint: Checkpoint | None
    ) -> WindowOutcome:
        try:
            expected = self._expected_checkpoint(
                session.profile, session.journal_profile_id, checkpoint
            )
            start_raw = expected.next_window_start_raw
            if checkpoint is not None and checkpoint.last_window_id is not None:
                start_raw = max(
                    session.profile.history_lower_bound_raw,
                    start_raw - self._policy.overlap_raw,
                )
            safe_end = _raw_int(
                self._boundary_provider.safe_end(session.profile), "safe_end"
            )
            end_raw = min(safe_end, start_raw + self._policy.maximum_window_raw)
            if end_raw <= start_raw:
                return WindowOutcome(WindowOutcomeState.IDLE)
            self._revalidate(session)
            deals = session.adapter.history_deals(start_raw, end_raw)
            if deals.state is CallState.FAILED:
                return WindowOutcome(WindowOutcomeState.ABORTED, reason="deals failed")
            orders = session.adapter.history_orders(start_raw, end_raw)
            if orders.state is CallState.FAILED:
                return WindowOutcome(WindowOutcomeState.ABORTED, reason="orders failed")
            committed = self._build_input(
                session,
                expected,
                start_raw,
                end_raw,
                self._half_open_rows(deals.rows, start_raw, end_raw, "time"),
                self._half_open_rows(
                    orders.rows, start_raw, end_raw, "time_done"
                ),
                revision=1,
            )
            self._revalidate(session)
            next_checkpoint = self._repository.commit_window(committed)
            return WindowOutcome(
                WindowOutcomeState.COMMITTED,
                window=committed.window,
                checkpoint=next_checkpoint,
            )
        except (TypeError, ValueError, RuntimeError):
            return WindowOutcome(WindowOutcomeState.ABORTED, reason="validation failed")

    def reconcile(self, session: HistorySession, window_id: str) -> WindowOutcome:
        with self._call_lock:
            return self._reconcile(session, window_id)

    def _reconcile(self, session: HistorySession, window_id: str) -> WindowOutcome:
        try:
            prior = self._repository.get_window(window_id)
            if prior is None:
                return WindowOutcome(
                    WindowOutcomeState.ABORTED, reason="window missing"
                )
            if prior.profile_id != session.journal_profile_id:
                return WindowOutcome(
                    WindowOutcomeState.ABORTED, reason="profile mismatch"
                )
            self._revalidate(session)
            deals = session.adapter.history_deals(prior.start_raw, prior.end_raw)
            if deals.state is CallState.FAILED:
                return WindowOutcome(WindowOutcomeState.ABORTED, reason="deals failed")
            orders = session.adapter.history_orders(prior.start_raw, prior.end_raw)
            if orders.state is CallState.FAILED:
                return WindowOutcome(WindowOutcomeState.ABORTED, reason="orders failed")
            candidate = self._build_input(
                session,
                Checkpoint(
                    profile_id=prior.profile_id,
                    generation=prior.generation,
                    next_window_start_raw=prior.start_raw,
                    last_window_id=None,
                    policy_version=prior.policy_version,
                    updated_at_utc=prior.committed_at_utc,
                ),
                prior.start_raw,
                prior.end_raw,
                self._half_open_rows(
                    deals.rows, prior.start_raw, prior.end_raw, "time"
                ),
                self._half_open_rows(
                    orders.rows, prior.start_raw, prior.end_raw, "time_done"
                ),
                revision=prior.window_revision,
            )
            if self._same_content(prior, candidate.window):
                return WindowOutcome(WindowOutcomeState.UNCHANGED, window=prior)
            revised = self._build_input(
                session,
                candidate.expected_checkpoint,
                prior.start_raw,
                prior.end_raw,
                self._half_open_rows(
                    deals.rows, prior.start_raw, prior.end_raw, "time"
                ),
                self._half_open_rows(
                    orders.rows, prior.start_raw, prior.end_raw, "time_done"
                ),
                revision=prior.window_revision + 1,
                supersedes_window_id=prior.window_id,
            )
            self._revalidate(session)
            self._repository.commit_reconciliation(revised)
            return WindowOutcome(WindowOutcomeState.RECONCILED, window=revised.window)
        except (TypeError, ValueError, RuntimeError):
            return WindowOutcome(WindowOutcomeState.ABORTED, reason="validation failed")

    def _expected_checkpoint(
        self,
        profile: TerminalProfile,
        journal_profile_id: str,
        checkpoint: Checkpoint | None,
    ) -> Checkpoint:
        if checkpoint is None:
            return Checkpoint(
                profile_id=journal_profile_id,
                generation=1,
                next_window_start_raw=profile.history_lower_bound_raw,
                last_window_id=None,
                policy_version=self._policy.policy_version,
                updated_at_utc=self._observed_at_utc(),
            )
        if checkpoint.profile_id != journal_profile_id:
            raise ValueError("checkpoint profile mismatch")
        if checkpoint.policy_version != self._policy.policy_version:
            raise ValueError("checkpoint policy mismatch")
        _raw_int(checkpoint.next_window_start_raw, "checkpoint start")
        if checkpoint.next_window_start_raw < profile.history_lower_bound_raw:
            return Checkpoint(
                profile_id=checkpoint.profile_id,
                generation=checkpoint.generation,
                next_window_start_raw=profile.history_lower_bound_raw,
                last_window_id=None,
                policy_version=checkpoint.policy_version,
                updated_at_utc=checkpoint.updated_at_utc,
            )
        return checkpoint

    @staticmethod
    def _same_content(prior: HistoryWindow, candidate: HistoryWindow) -> bool:
        return (
            prior.deal_count == candidate.deal_count
            and prior.order_count == candidate.order_count
            and prior.deal_digest == candidate.deal_digest
            and prior.order_digest == candidate.order_digest
            and prior.window_digest == candidate.window_digest
        )

    def _build_input(
        self,
        session: HistorySession,
        expected_checkpoint: Checkpoint,
        start_raw: int,
        end_raw: int,
        deal_rows: tuple[dict[str, Any], ...],
        order_rows: tuple[dict[str, Any], ...],
        *,
        revision: int,
        supersedes_window_id: str | None = None,
    ) -> CommittedWindowInput:
        profile = session.profile
        journal_profile_id = session.journal_profile_id
        _raw_int(start_raw, "start_raw")
        _raw_int(end_raw, "end_raw")
        observed = self._observed_at_utc()
        window_id = history_window_id(
            profile_id=journal_profile_id,
            generation=expected_checkpoint.generation,
            start_raw=start_raw,
            end_raw=end_raw,
            policy_version=self._policy.policy_version,
            window_revision=revision,
        )
        records = self._records(profile, journal_profile_id, deal_rows, order_rows)
        by_resource: dict[str, list[HistoryRecord]] = {"deal": [], "order": []}
        for record in records:
            by_resource[record.resource].append(record)
        deal_digests = [record.payload_digest for record in by_resource["deal"]]
        order_digests = [record.payload_digest for record in by_resource["order"]]
        deal_digest = sha256_hex(canonical_json_bytes(deal_digests))
        order_digest = sha256_hex(canonical_json_bytes(order_digests))
        window_payload = {
            "deal_count": len(by_resource["deal"]),
            "deal_digest": deal_digest,
            "end_raw": end_raw,
            "order_count": len(by_resource["order"]),
            "order_digest": order_digest,
            "ordered_event_ids": [record.event_id for record in records],
            "start_raw": start_raw,
            "supersedes_window_id": supersedes_window_id,
            "window_id": window_id,
            "window_revision": revision,
        }
        window_digest = sha256_hex(canonical_json_bytes(window_payload))
        window = HistoryWindow(
            window_id=window_id,
            profile_id=journal_profile_id,
            generation=expected_checkpoint.generation,
            window_revision=revision,
            start_raw=start_raw,
            end_raw=end_raw,
            policy_version=self._policy.policy_version,
            deal_count=len(by_resource["deal"]),
            order_count=len(by_resource["order"]),
            deal_digest=deal_digest,
            order_digest=order_digest,
            window_digest=window_digest,
            observed_started_at_utc=observed,
            observed_finished_at_utc=observed,
            committed_at_utc=observed,
        )
        publication_records = tuple(
            (record, ordinal)
            for resource in ("deal", "order")
            for ordinal, record in enumerate(by_resource[resource])
            if not self._has_outbox_event(record.event_id)
        )
        outbox = self._outbox(
            session, window, publication_records, window_payload, observed
        )
        return CommittedWindowInput(
            expected_checkpoint=expected_checkpoint,
            required_lower_bound_raw=profile.history_lower_bound_raw,
            window=window,
            records=records,
            outbox=outbox,
            supersedes_window_id=supersedes_window_id,
        )

    @staticmethod
    def _half_open_rows(
        rows: tuple[dict[str, Any], ...],
        start_raw: int,
        end_raw: int,
        boundary_field: str,
    ) -> tuple[dict[str, Any], ...]:
        accepted: list[dict[str, Any]] = []
        for row in rows:
            _raw_int(row.get("ticket"), "ticket")
            canonical_json_bytes(row)
            boundary = _raw_int(row.get(boundary_field), boundary_field)
            if start_raw <= boundary < end_raw:
                accepted.append(row)
        return tuple(accepted)

    def _has_outbox_event(self, event_id: str) -> bool:
        lookup = getattr(self._repository, "has_outbox_event", None)
        return bool(lookup(event_id)) if callable(lookup) else False

    @staticmethod
    def _records(
        profile: TerminalProfile,
        journal_profile_id: str,
        deal_rows: tuple[dict[str, Any], ...],
        order_rows: tuple[dict[str, Any], ...],
    ) -> tuple[HistoryRecord, ...]:
        records: list[HistoryRecord] = []
        for resource, rows, key in (
            ("deal", deal_rows, _deal_key),
            ("order", order_rows, _order_key),
        ):
            for row in sorted(rows, key=key):
                ticket = _raw_int(row.get("ticket"), "ticket")
                payload_json = canonical_json_bytes(row)
                payload_digest = sha256_hex(payload_json)
                natural_id = (
                    f"{journal_profile_id}:{profile.expected_login}:"
                    f"{profile.expected_server}:{ticket}"
                )
                records.append(
                    HistoryRecord(
                        resource=resource,  # type: ignore[arg-type]
                        natural_id=natural_id,
                        event_id=record_event_id(
                            namespace="mt5n:v1",
                            schema_version="mt5n.bridge.v1",
                            resource=resource,
                            natural_identity=natural_id,
                            payload_digest=payload_digest,
                        ),
                        payload_json=payload_json,
                        payload_digest=payload_digest,
                    )
                )
        return tuple(records)

    def _outbox(
        self,
        session: HistorySession,
        window: HistoryWindow,
        publication_records: tuple[tuple[HistoryRecord, int], ...],
        window_payload: dict[str, Any],
        observed: str,
    ) -> tuple[OutboxMessage, ...]:
        profile = session.profile
        stream_key = RedisLease.cluster_keys(profile.expected_login)[4]
        messages = [
            OutboxMessage(
                event_id=record.event_id,
                window_id=window.window_id,
                profile_id=window.profile_id,
                stream_key=stream_key,
                envelope_json=self._envelope_json(
                    session=session,
                    message_type=f"history.{record.resource}",
                    event_id=record.event_id,
                    payload={
                        "ordinal": ordinal,
                        "raw": json.loads(record.payload_json),
                        "window_id": window.window_id,
                    },
                    observed=observed,
                ),
                payload_digest=sha256_hex(
                    canonical_json_bytes(
                        {
                            "ordinal": ordinal,
                            "raw": json.loads(record.payload_json),
                            "window_id": window.window_id,
                        }
                    )
                ),
            )
            for record, ordinal in publication_records
        ]
        window_event_id = record_event_id(
            namespace="mt5n:v1",
            schema_version="mt5n.bridge.v1",
            resource="history.window",
            natural_identity=window.window_id,
            payload_digest=window.window_digest,
        )
        messages.append(
            OutboxMessage(
                event_id=window_event_id,
                window_id=window.window_id,
                profile_id=window.profile_id,
                stream_key=stream_key,
                envelope_json=self._envelope_json(
                    session=session,
                    message_type="history.window",
                    event_id=window_event_id,
                    payload=window_payload,
                    observed=observed,
                ),
                payload_digest=window.window_digest,
            )
        )
        return tuple(messages)

    @staticmethod
    def _envelope_json(
        *,
        session: HistorySession,
        message_type: str,
        event_id: str,
        payload: dict[str, Any],
        observed: str,
    ) -> bytes:
        observed_at_utc = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if observed_at_utc.tzinfo is None:
            raise ValueError("observed_at_utc must be timezone-aware")
        observed_at_utc = observed_at_utc.astimezone(UTC)
        payload_digest = sha256_hex(canonical_json_bytes(payload))
        envelope = BridgeEnvelope(
            schema_id="mt5n.bridge.v1",
            message_type=message_type,  # type: ignore[arg-type]
            event_id=event_id,
            payload_digest=payload_digest,
            producer=session.producer,
            terminal=session.terminal,
            account=AccountIdentity(
                login=session.profile.expected_login,
                server=session.profile.expected_server,
            ),
            observed_at_utc=observed_at_utc,
            event_time_semantic="mt5-broker-server-raw",
            payload_state="complete",
            payload=payload,
        )
        return canonical_json_bytes(envelope.model_dump(mode="json", by_alias=True))
