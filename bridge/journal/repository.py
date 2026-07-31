from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Literal

from bridge.canonical import canonical_json_bytes, sha256_hex
from bridge.restart_policy import BackoffConfig, compute_backoff_delay_ms

# ruff: noqa: E501

Resource = Literal["deal", "order"]
FailureInjector = Callable[[str], None]


class CheckpointConflict(RuntimeError):
    """The planned window no longer matches the durable checkpoint."""


class OutboxStateConflict(RuntimeError):
    """An outbox ack/fail call found the row already resolved by a racing
    dispatch (already PUBLISHED) or reclaimed out from under this caller
    after its claim lease expired -- see design doc §11.3. The caller must
    treat this as "someone else already resolved this message," never as an
    error worth retrying or crashing over."""


class OutboxFailOutcome(StrEnum):
    REQUEUED = "requeued"
    QUARANTINED = "quarantined"


@dataclass(frozen=True)
class Checkpoint:
    profile_id: str
    generation: int
    next_window_start_raw: int
    last_window_id: str | None
    policy_version: int
    updated_at_utc: str


@dataclass(frozen=True)
class HistoryWindow:
    window_id: str
    profile_id: str
    generation: int
    window_revision: int
    start_raw: int
    end_raw: int
    policy_version: int
    deal_count: int
    order_count: int
    deal_digest: str
    order_digest: str
    window_digest: str
    observed_started_at_utc: str
    observed_finished_at_utc: str
    committed_at_utc: str


@dataclass(frozen=True)
class HistoryRecord:
    resource: Resource
    natural_id: str
    event_id: str
    payload_json: bytes
    payload_digest: str


@dataclass(frozen=True)
class OutboxMessage:
    event_id: str
    window_id: str
    profile_id: str
    stream_key: str
    envelope_json: bytes
    payload_digest: str


@dataclass(frozen=True)
class CommittedWindowInput:
    """Precomputed immutable window bytes, identities, and journal transition."""

    expected_checkpoint: Checkpoint
    required_lower_bound_raw: int
    window: HistoryWindow
    records: tuple[HistoryRecord, ...]
    outbox: tuple[OutboxMessage, ...]
    supersedes_window_id: str | None = None

    def __post_init__(self) -> None:
        if (
            isinstance(self.required_lower_bound_raw, bool)
            or not isinstance(self.required_lower_bound_raw, int)
            or self.required_lower_bound_raw < 0
        ):
            raise ValueError("required lower bound must be a raw non-negative integer")
        if self.expected_checkpoint.profile_id != self.window.profile_id:
            raise ValueError("checkpoint and window profile mismatch")
        if self.expected_checkpoint.generation != self.window.generation:
            raise ValueError("checkpoint and window generation mismatch")
        if self.expected_checkpoint.policy_version != self.window.policy_version:
            raise ValueError("checkpoint and window policy mismatch")
        if self.window.end_raw <= self.window.start_raw:
            raise ValueError("window end must be after start")
        if len({record.event_id for record in self.records}) != len(self.records):
            raise ValueError("record event IDs must be unique")
        if len({message.event_id for message in self.outbox}) != len(self.outbox):
            raise ValueError("outbox event IDs must be unique")
        for record in self.records:
            if not record.natural_id or not record.event_id:
                raise ValueError("record identity must not be empty")
            try:
                decoded = json.loads(record.payload_json)
            except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("record payload must be valid JSON") from error
            if canonical_json_bytes(decoded) != record.payload_json:
                raise ValueError("record payload must be canonical JSON")
            if sha256_hex(record.payload_json) != record.payload_digest:
                raise ValueError("record payload digest mismatch")
        for message in self.outbox:
            if (
                message.window_id != self.window.window_id
                or message.profile_id != self.window.profile_id
            ):
                raise ValueError("outbox ownership does not match window")
            try:
                envelope = json.loads(message.envelope_json)
            except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError("outbox envelope must be valid JSON") from error
            if canonical_json_bytes(envelope) != message.envelope_json:
                raise ValueError("outbox envelope must be canonical JSON")
            if not isinstance(envelope, dict) or not isinstance(
                envelope.get("message_type"), str
            ):
                raise ValueError("outbox envelope must declare message_type")
            declared_digest = envelope.get("payload_digest")
            if declared_digest is not None and declared_digest != message.payload_digest:
                raise ValueError("outbox envelope digest mismatch")


@dataclass(frozen=True)
class ClaimedOutboxMessage(OutboxMessage):
    attempt_count: int
    claim_expires_at_utc: str


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


class JournalRepository:
    def __init__(
        self,
        connection: sqlite3.Connection,
        *,
        failure_injector: FailureInjector | None = None,
    ) -> None:
        self._connection = connection
        self.failure_injector = failure_injector

    def _before(self, label: str) -> None:
        if self.failure_injector is not None:
            self.failure_injector(label)

    def _execute(
        self, label: str, statement: str, parameters: tuple[object, ...] = ()
    ) -> sqlite3.Cursor:
        self._before(label)
        return self._connection.execute(statement, parameters)

    def register_profile(
        self,
        *,
        profile_id: str,
        login: int,
        server: str,
        terminal_id: str,
        config_digest: str,
        now_utc: str,
    ) -> str:
        """Idempotent upsert keyed on two independent unique constraints --
        `profile_id` (the row's identity, PRIMARY KEY and the FK parent for
        history_checkpoints/history_windows/producer_epochs) and `login`
        (UNIQUE, one journal-tracked producer per login at a time).

        Same profile_id re-registering (the common restart case: config
        unchanged) only bumps last_verified_at_utc -- terminal_id/
        config_digest/created_at_utc stay frozen, matching the existing
        "identity confirmed, don't silently mutate it" contract.

        A *different* profile_id for a login that already has a row means
        the producer's config changed (path/server/data_path drift) without
        the login itself changing. `profile_id` is a PRIMARY KEY referenced
        by FK from every durable-progress table with `PRAGMA foreign_keys =
        ON`; swapping it on an existing row would either orphan those FK
        children or raise `FOREIGN KEY constraint failed` outright the
        moment any exist -- exactly the crash this method exists to
        prevent. So the existing profile_id (and everything durably keyed
        to it) is left untouched; only the descriptive fields that are safe
        to refresh (server, terminal_id, config_digest, last_verified_at_utc)
        move to the newly observed values on that same row.

        Returns the profile_id now in effect for `login` -- the caller's
        requested id on the fast path, or the pre-existing one it was
        reconciled against when they differ. Callers making further calls
        keyed by profile_id in the same registration (e.g. register_epoch)
        must use the returned value, not blindly the id they passed in.
        """
        self._connection.execute(
            "INSERT INTO producer_profiles("
            "profile_id, login, server, terminal_id, config_digest, created_at_utc, last_verified_at_utc"
            ") VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(profile_id) DO UPDATE SET "
            "last_verified_at_utc = excluded.last_verified_at_utc "
            "ON CONFLICT(login) DO UPDATE SET "
            "server = excluded.server, "
            "terminal_id = excluded.terminal_id, "
            "config_digest = excluded.config_digest, "
            "last_verified_at_utc = excluded.last_verified_at_utc",
            (profile_id, login, server, terminal_id, config_digest, now_utc, now_utc),
        )
        row = self._connection.execute(
            "SELECT profile_id FROM producer_profiles WHERE login = ?", (login,)
        ).fetchone()
        return row[0]

    def register_epoch(
        self,
        *,
        epoch_id: str,
        profile_id: str,
        fence_token: int,
        started_at_utc: str,
        start_reason: str,
    ) -> None:
        """Record a new producer epoch. Must run after register_profile()
        for the same profile_id (FK) and before any live_sequences.reserve()
        call using this epoch_id (FK) -- reserve() has no way to satisfy
        either constraint on its own. epoch_id is generated fresh per worker
        process start, so a conflict here would only ever mean this exact
        epoch was already registered (e.g. a retried startup) -- safe to
        treat as a no-op rather than an error."""
        self._connection.execute(
            "INSERT INTO producer_epochs("
            "epoch_id, profile_id, fence_token, started_at_utc, start_reason"
            ") VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(epoch_id) DO NOTHING",
            (epoch_id, profile_id, fence_token, started_at_utc, start_reason),
        )

    def reserve(self, profile_id: str, epoch_id: str) -> int:
        """Allocate one durable, profile-scoped live event sequence number."""
        if not profile_id or not epoch_id:
            raise ValueError("profile_id and epoch_id are required")
        row = self._execute(
            "before_live_sequence_reserve",
            "INSERT INTO live_sequences(profile_id, producer_epoch_id, next_sequence) "
            "VALUES (?, ?, 2) "
            "ON CONFLICT(profile_id) DO UPDATE SET "
            "producer_epoch_id = excluded.producer_epoch_id, "
            "next_sequence = live_sequences.next_sequence + 1 "
            "RETURNING next_sequence",
            (profile_id, epoch_id),
        ).fetchone()
        sequence: object = row[0] if row is not None else None
        if isinstance(sequence, bool) or not isinstance(sequence, int):
            raise RuntimeError("live sequence reservation failed")
        return sequence - 1

    def _checkpoint(self, profile_id: str) -> Checkpoint | None:
        row = self._execute(
            "before_checkpoint_read",
            "SELECT profile_id, generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc "
            "FROM history_checkpoints WHERE profile_id = ?",
            (profile_id,),
        ).fetchone()
        return Checkpoint(*row) if row is not None else None

    def get_checkpoint(self, profile_id: str) -> Checkpoint | None:
        """Public accessor -- the worker's startup needs to load its own
        checkpoint before its first `HistorySynchronizer.run_next_window`
        call (`None` means "no durable progress yet, start from
        `profile.history_lower_bound_raw`", exactly matching
        `HistorySynchronizer._expected_checkpoint`'s existing handling)."""
        return self._checkpoint(profile_id)

    @staticmethod
    def _matches(
        actual: Checkpoint | None,
        expected: Checkpoint,
        required_lower_bound_raw: int,
    ) -> bool:
        if actual is None:
            return (
                expected.generation == 1
                and expected.next_window_start_raw == required_lower_bound_raw
                and expected.last_window_id is None
            )
        return (
            actual.generation == expected.generation
            and actual.next_window_start_raw == expected.next_window_start_raw
            and actual.last_window_id == expected.last_window_id
            and actual.policy_version == expected.policy_version
        )

    @staticmethod
    def _message_type(message: OutboxMessage) -> str:
        try:
            envelope = json.loads(message.envelope_json)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("outbox envelope must be valid JSON") from error
        message_type = (
            envelope.get("message_type") if isinstance(envelope, dict) else None
        )
        if not isinstance(message_type, str):
            raise ValueError("outbox envelope must declare message_type")
        return message_type

    def _validate_outbox_coverage(
        self,
        window: HistoryWindow,
        records: Sequence[HistoryRecord],
        outbox: Sequence[OutboxMessage],
    ) -> None:
        if any(message.window_id != window.window_id for message in outbox):
            raise ValueError("outbox message window mismatch")
        if any(message.profile_id != window.profile_id for message in outbox):
            raise ValueError("outbox message profile mismatch")
        event_ids = [message.event_id for message in outbox]
        if len(set(event_ids)) != len(event_ids):
            raise ValueError("outbox event IDs must be unique")
        by_event = {message.event_id: message for message in outbox}
        window_messages = [
            message
            for message in outbox
            if self._message_type(message) == "history.window"
        ]
        if len(window_messages) != 1:
            raise ValueError("exactly one history.window outbox message is required")
        if window_messages[0].payload_digest != window.window_digest:
            raise ValueError("history.window outbox digest mismatch")
        history_messages = [
            message
            for message in outbox
            if self._message_type(message) in {"history.deal", "history.order"}
        ]
        record_event_ids = {record.event_id for record in records}
        if any(
            message.event_id not in record_event_ids for message in history_messages
        ):
            raise ValueError("history record outbox message is unbacked by a record")
        counts: dict[Resource, int] = {"deal": 0, "order": 0}
        for record in records:
            counts[record.resource] += 1
            message = by_event.get(record.event_id)
            if message is None:
                existing = self._execute(
                    "before_existing_record_outbox_read",
                    "SELECT profile_id, envelope_json, payload_digest "
                    "FROM outbox_messages WHERE event_id = ?",
                    (record.event_id,),
                ).fetchone()
                if existing is None:
                    raise ValueError("record outbox message is required")
                if (
                    existing[0] != window.profile_id
                    or self._message_type(
                        OutboxMessage(
                            event_id=record.event_id,
                            window_id="existing",
                            profile_id=str(existing[0]),
                            stream_key="existing",
                            envelope_json=bytes(existing[1]),
                            payload_digest=str(existing[2]),
                        )
                    )
                    != f"history.{record.resource}"
                ):
                    raise ValueError("record outbox coverage conflicts with record")
                continue
            if self._message_type(message) != f"history.{record.resource}":
                raise ValueError("record outbox message type mismatch")
        if counts["deal"] != window.deal_count or counts["order"] != window.order_count:
            raise ValueError("window counts do not match supplied records")

    def _insert_or_reuse_outbox(self, message: OutboxMessage, now_utc: str) -> None:
        existing = self._execute(
            "before_outbox_existing_read",
            "SELECT window_id, profile_id, stream_key, envelope_json, payload_digest "
            "FROM outbox_messages WHERE event_id = ?",
            (message.event_id,),
        ).fetchone()
        if existing is not None:
            _, existing_profile_id, existing_stream_key, existing_envelope, existing_digest = existing
            if (
                existing_profile_id != message.profile_id
                or existing_stream_key != message.stream_key
                or existing_envelope != message.envelope_json
                or existing_digest != message.payload_digest
            ):
                raise ValueError("outbox event ID conflicts with an existing message")
            # Exact history records recur in overlap windows. Their first
            # outbox row remains the single durable publication obligation.
            return
        self._execute(
            "before_outbox_insert",
            "INSERT INTO outbox_messages("
            "event_id, window_id, profile_id, stream_key, envelope_json, payload_digest, state, attempt_count, next_attempt_at_utc"
            ") VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)",
            (
                message.event_id,
                message.window_id,
                message.profile_id,
                message.stream_key,
                message.envelope_json,
                message.payload_digest,
                now_utc,
            ),
        )

    def commit_window(
        self,
        committed: CommittedWindowInput | Checkpoint,
        window: HistoryWindow | None = None,
        records: Sequence[HistoryRecord] = (),
        outbox: Sequence[OutboxMessage] = (),
    ) -> Checkpoint:
        """Atomically persist a forward window and its sole checkpoint transition.

        The `CommittedWindowInput` form is the synchronizer contract.  The
        positional form remains for the prior repository contract tests.
        """
        if isinstance(committed, CommittedWindowInput):
            if committed.supersedes_window_id is not None:
                raise ValueError("forward window cannot supersede another window")
            return self._commit_window(
                committed.expected_checkpoint,
                committed.window,
                committed.records,
                committed.outbox,
                advance_checkpoint=True,
                required_lower_bound_raw=committed.required_lower_bound_raw,
                allow_initial_checkpoint=True,
            )
        if window is None:
            raise TypeError("window is required with a checkpoint")
        return self._commit_window(
            committed,
            window,
            records,
            outbox,
            advance_checkpoint=True,
            required_lower_bound_raw=committed.next_window_start_raw,
            allow_initial_checkpoint=False,
        )

    def commit_reconciliation(self, committed: CommittedWindowInput) -> None:
        if committed.supersedes_window_id is None:
            raise ValueError("reconciliation must supersede a prior window")
        self._commit_window(
            committed.expected_checkpoint,
            committed.window,
            committed.records,
            committed.outbox,
            advance_checkpoint=False,
            supersedes_window_id=committed.supersedes_window_id,
            required_lower_bound_raw=committed.required_lower_bound_raw,
            allow_initial_checkpoint=False,
        )

    def has_outbox_event(self, event_id: str) -> bool:
        return (
            self._connection.execute(
                "SELECT 1 FROM outbox_messages WHERE event_id = ?", (event_id,)
            ).fetchone()
            is not None
        )

    def get_window(self, window_id: str) -> HistoryWindow | None:
        row = self._connection.execute(
            "SELECT w.window_id, w.profile_id, w.generation, w.window_revision, w.start_raw, w.end_raw, "
            "c.policy_version, w.deal_count, w.order_count, w.deal_digest, w.order_digest, w.window_digest, "
            "w.observed_started_at_utc, w.observed_finished_at_utc, w.committed_at_utc "
            "FROM history_windows AS w JOIN history_checkpoints AS c ON c.profile_id = w.profile_id "
            "WHERE w.window_id = ?",
            (window_id,),
        ).fetchone()
        return HistoryWindow(*row) if row is not None else None

    def _commit_window(
        self,
        expected_checkpoint: Checkpoint,
        window: HistoryWindow,
        records: Sequence[HistoryRecord],
        outbox: Sequence[OutboxMessage],
        *,
        advance_checkpoint: bool,
        supersedes_window_id: str | None = None,
        required_lower_bound_raw: int,
        allow_initial_checkpoint: bool,
    ) -> Checkpoint:
        if expected_checkpoint.profile_id != window.profile_id:
            raise ValueError("checkpoint and window profile mismatch")
        if expected_checkpoint.generation != window.generation:
            raise ValueError("checkpoint and window generation mismatch")
        if expected_checkpoint.policy_version != window.policy_version:
            raise ValueError("checkpoint and window policy mismatch")
        if advance_checkpoint and window.start_raw > expected_checkpoint.next_window_start_raw:
            raise ValueError("window start cannot skip checkpoint coverage")
        if window.end_raw <= window.start_raw:
            raise ValueError("window end must be after start")
        self._before("before_begin")
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            self._validate_outbox_coverage(window, records, outbox)
            if advance_checkpoint:
                actual = self._checkpoint(window.profile_id)
                if actual is None and not allow_initial_checkpoint:
                    raise CheckpointConflict(
                        "fresh history requires CommittedWindowInput"
                    )
                if not self._matches(
                    actual, expected_checkpoint, required_lower_bound_raw
                ):
                    raise CheckpointConflict("checkpoint generation or start changed")
            elif supersedes_window_id is None:
                raise ValueError("reconciliation requires a prior window")
            else:
                prior = self._execute(
                    "before_reconciliation_read",
                    "SELECT profile_id, generation, start_raw, end_raw, window_revision, state FROM history_windows WHERE window_id = ?",
                    (supersedes_window_id,),
                ).fetchone()
                if prior is None:
                    raise ValueError("prior reconciliation window is missing")
                if tuple(prior[:5]) != (
                    window.profile_id,
                    window.generation,
                    window.start_raw,
                    window.end_raw,
                    window.window_revision - 1,
                ) or prior[5] != "COMMITTED":
                    raise ValueError("prior reconciliation window does not match")
            self._execute(
                "before_window_insert",
                "INSERT INTO history_windows("
                "window_id, profile_id, generation, window_revision, start_raw, end_raw, state, deal_count, order_count, "
                "deal_digest, order_digest, window_digest, observed_started_at_utc, observed_finished_at_utc, committed_at_utc"
                ") VALUES (?, ?, ?, ?, ?, ?, 'COMMITTED', ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    window.window_id,
                    window.profile_id,
                    window.generation,
                    window.window_revision,
                    window.start_raw,
                    window.end_raw,
                    window.deal_count,
                    window.order_count,
                    window.deal_digest,
                    window.order_digest,
                    window.window_digest,
                    window.observed_started_at_utc,
                    window.observed_finished_at_utc,
                    window.committed_at_utc,
                ),
            )
            if supersedes_window_id is not None:
                self._execute(
                    "before_prior_window_supersede",
                    "UPDATE history_windows SET state = 'SUPERSEDED' WHERE window_id = ?",
                    (supersedes_window_id,),
                )
            ordinals: dict[Resource, int] = {"deal": 0, "order": 0}
            for record in records:
                ordinal = ordinals[record.resource]
                ordinals[record.resource] += 1
                row = self._execute(
                    "before_record_lookup",
                    "SELECT record_version_id FROM history_record_versions "
                    "WHERE profile_id = ? AND resource = ? AND natural_id = ? AND payload_digest = ?",
                    (
                        window.profile_id,
                        record.resource,
                        record.natural_id,
                        record.payload_digest,
                    ),
                ).fetchone()
                if row is None:
                    correction = self._execute(
                        "before_correction_lookup",
                        "SELECT record_version_id FROM history_record_versions "
                        "WHERE profile_id = ? AND resource = ? AND natural_id = ? "
                        "ORDER BY rowid DESC LIMIT 1",
                        (window.profile_id, record.resource, record.natural_id),
                    ).fetchone()
                    record_version_id = record.event_id
                    self._execute(
                        "before_record_version_insert",
                        "INSERT INTO history_record_versions("
                        "record_version_id, profile_id, resource, natural_id, event_id, payload_json, payload_digest, correction_of"
                        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            record_version_id,
                            window.profile_id,
                            record.resource,
                            record.natural_id,
                            record.event_id,
                            record.payload_json,
                            record.payload_digest,
                            correction[0] if correction is not None else None,
                        ),
                    )
                else:
                    record_version_id = str(row[0])
                self._execute(
                    "before_membership_insert",
                    "INSERT INTO history_window_records(window_id, resource, ordinal, record_version_id) VALUES (?, ?, ?, ?)",
                    (window.window_id, record.resource, ordinal, record_version_id),
                )
            for message in outbox:
                self._insert_or_reuse_outbox(message, window.committed_at_utc)
            if advance_checkpoint:
                next_checkpoint = Checkpoint(
                    profile_id=window.profile_id,
                    generation=window.generation,
                    next_window_start_raw=max(
                        expected_checkpoint.next_window_start_raw, window.end_raw
                    ),
                    last_window_id=window.window_id,
                    policy_version=window.policy_version,
                    updated_at_utc=window.committed_at_utc,
                )
                self._execute(
                    "before_checkpoint_upsert",
                    "INSERT INTO history_checkpoints("
                    "profile_id, generation, next_window_start_raw, last_window_id, policy_version, updated_at_utc"
                    ") VALUES (?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(profile_id) DO UPDATE SET generation = excluded.generation, "
                    "next_window_start_raw = excluded.next_window_start_raw, last_window_id = excluded.last_window_id, "
                    "policy_version = excluded.policy_version, updated_at_utc = excluded.updated_at_utc",
                    (
                        next_checkpoint.profile_id,
                        next_checkpoint.generation,
                        next_checkpoint.next_window_start_raw,
                        next_checkpoint.last_window_id,
                        next_checkpoint.policy_version,
                        next_checkpoint.updated_at_utc,
                    ),
                )
            else:
                next_checkpoint = expected_checkpoint
            self._before("before_commit")
            self._connection.commit()
            return next_checkpoint
        except BaseException:
            self._connection.rollback()
            raise

    # A candidate history.window row is only claimed once every sibling
    # row for its window_id is PUBLISHED -- see design doc §11.8. The
    # predicate is an existence check for "any sibling NOT published", not
    # an absence check for two specific bad states, so a QUARANTINED
    # sibling correctly keeps blocking (fix for review finding B2).
    def _has_blocking_sibling(self, window_id: str, event_id: str) -> bool:
        return (
            self._connection.execute(
                "SELECT 1 FROM outbox_messages "
                "WHERE window_id = ? AND event_id != ? AND state != 'PUBLISHED' LIMIT 1",
                (window_id, event_id),
            ).fetchone()
            is not None
        )

    def has_blocking_sibling(self, window_id: str, event_id: str) -> bool:
        """Public entry point for the dispatcher's pre-publish re-check
        (§11.6 scenario 6, §11.8) -- same predicate as the claim-time gate,
        deliberately reused rather than re-implemented, so the two checks
        can never drift apart."""
        return self._has_blocking_sibling(window_id, event_id)

    def claim_outbox(
        self,
        claimed_by: str,
        *,
        limit: int,
        now_utc: str,
        lease_seconds: int,
    ) -> tuple[ClaimedOutboxMessage, ...]:
        if limit <= 0 or lease_seconds <= 0:
            raise ValueError("limit and lease_seconds must be positive")
        expires_at = (
            (_parse_utc(now_utc) + timedelta(seconds=lease_seconds))
            .isoformat()
            .replace("+00:00", "Z")
        )
        # Over-fetch candidates: a history.window candidate blocked by a
        # non-PUBLISHED sibling is skipped without consuming a claim slot,
        # so more candidates than `limit` may need to be considered to fill
        # a batch of `limit` actual claims (§11.8).
        candidate_limit = max(limit * 4, limit + 16)
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            candidates = self._connection.execute(
                "SELECT event_id, window_id, envelope_json FROM outbox_messages WHERE "
                "(state = 'PENDING' AND next_attempt_at_utc <= ?) OR "
                "(state = 'INFLIGHT' AND claim_expires_at_utc <= ?) "
                "ORDER BY next_attempt_at_utc, event_id LIMIT ?",
                (now_utc, now_utc, candidate_limit),
            ).fetchall()
            claimed: list[ClaimedOutboxMessage] = []
            for event_id, window_id, envelope_json in candidates:
                if len(claimed) >= limit:
                    break
                event_id = str(event_id)
                window_id = str(window_id)
                message_type = self._message_type(
                    OutboxMessage(
                        event_id=event_id,
                        window_id=window_id,
                        profile_id="",
                        stream_key="",
                        envelope_json=bytes(envelope_json),
                        payload_digest="",
                    )
                )
                if message_type == "history.window" and self._has_blocking_sibling(
                    window_id, event_id
                ):
                    continue
                self._connection.execute(
                    "UPDATE outbox_messages SET state = 'INFLIGHT', attempt_count = attempt_count + 1, "
                    "claimed_by = ?, claim_expires_at_utc = ? WHERE event_id = ?",
                    (claimed_by, expires_at, event_id),
                )
                row = self._connection.execute(
                    "SELECT event_id, window_id, profile_id, stream_key, envelope_json, payload_digest, attempt_count, claim_expires_at_utc "
                    "FROM outbox_messages WHERE event_id = ?",
                    (event_id,),
                ).fetchone()
                assert row is not None
                claimed.append(ClaimedOutboxMessage(*row))
            self._connection.commit()
            return tuple(claimed)
        except BaseException:
            self._connection.rollback()
            raise

    def ack_outbox(self, event_id: str, *, redis_entry_id: str, now_utc: str) -> None:
        """Mark a claimed message as durably published. No read-before-write
        needed -- a single guarded UPDATE, matching every other simple
        state transition in this file."""
        cursor = self._connection.execute(
            "UPDATE outbox_messages SET state = 'PUBLISHED', published_at_utc = ?, "
            "redis_entry_id = ? WHERE event_id = ? AND state = 'INFLIGHT'",
            (now_utc, redis_entry_id, event_id),
        )
        if cursor.rowcount == 0:
            raise OutboxStateConflict(
                f"no INFLIGHT outbox row for event_id={event_id!r} to acknowledge"
            )

    # Kept as a clearer alias for callers describing "mark published" intent.
    mark_published = ack_outbox

    def fail_outbox(
        self,
        event_id: str,
        *,
        error_class: str,
        error_redacted: str,
        retryable: bool,
        now_utc: str,
        backoff_config: BackoffConfig,
        max_attempts: int,
    ) -> OutboxFailOutcome:
        """Records a genuine delivery failure. Unlike claim_outbox's
        attempt_count (incremented on every claim, including reclaims from
        crashes and lease loss that have nothing to do with the message),
        delivery_failure_count is incremented ONLY here, ONLY after a real
        publish attempt actually failed -- the fix for review finding B1.
        Read-then-write, so this needs its own BEGIN IMMEDIATE (unlike
        ack_outbox/requeue_outbox's single blind UPDATE)."""
        if max_attempts <= 0:
            raise ValueError("max_attempts must be positive")
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            row = self._connection.execute(
                "SELECT delivery_failure_count FROM outbox_messages "
                "WHERE event_id = ? AND state = 'INFLIGHT'",
                (event_id,),
            ).fetchone()
            if row is None:
                raise OutboxStateConflict(
                    f"no INFLIGHT outbox row for event_id={event_id!r} to fail"
                )
            next_failure_count = int(row[0]) + 1
            if retryable and next_failure_count < max_attempts:
                delay_ms = compute_backoff_delay_ms(next_failure_count, backoff_config)
                next_attempt_at = (
                    (_parse_utc(now_utc) + timedelta(milliseconds=delay_ms))
                    .isoformat()
                    .replace("+00:00", "Z")
                )
                self._connection.execute(
                    "UPDATE outbox_messages SET delivery_failure_count = ?, state = 'PENDING', "
                    "next_attempt_at_utc = ?, last_error_class = ?, last_error_redacted = ? "
                    "WHERE event_id = ?",
                    (next_failure_count, next_attempt_at, error_class, error_redacted, event_id),
                )
                outcome = OutboxFailOutcome.REQUEUED
            else:
                self._connection.execute(
                    "UPDATE outbox_messages SET delivery_failure_count = ?, state = 'QUARANTINED', "
                    "quarantined_at_utc = ?, last_error_class = ?, last_error_redacted = ? "
                    "WHERE event_id = ?",
                    (next_failure_count, now_utc, error_class, error_redacted, event_id),
                )
                outcome = OutboxFailOutcome.QUARANTINED
            self._connection.commit()
            return outcome
        except BaseException:
            self._connection.rollback()
            raise

    def requeue_outbox(self, event_id: str, *, operator: str, now_utc: str) -> None:
        """The unquarantine operation for a single message (§11.3).
        delivery_failure_count/attempt_count/last_error_* are left as the
        audit trail of why it was quarantined; only state,
        next_attempt_at_utc, and quarantined_at_utc change. `operator` is
        accepted for interface symmetry with bridge/quarantine.py's
        account-level unquarantine and for structured logging by the
        caller -- this table has no per-operator audit column of its own."""
        del operator
        cursor = self._connection.execute(
            "UPDATE outbox_messages SET state = 'PENDING', next_attempt_at_utc = ?, "
            "quarantined_at_utc = NULL WHERE event_id = ? AND state = 'QUARANTINED'",
            (now_utc, event_id),
        )
        if cursor.rowcount == 0:
            raise LookupError(f"no QUARANTINED outbox row for event_id={event_id!r}")

    def cleanup_published_outbox(self, *, published_before_utc: str) -> int:
        """§11.9: only PUBLISHED rows older than the retention cutoff are
        deletion-eligible. PENDING/INFLIGHT/QUARANTINED rows are never
        touched here -- a QUARANTINED row is only ever cleared by
        requeue_outbox, never by this method."""
        cursor = self._connection.execute(
            "DELETE FROM outbox_messages WHERE state = 'PUBLISHED' AND published_at_utc < ?",
            (published_before_utc,),
        )
        return cursor.rowcount

    def outbox_quarantine_summary(self) -> tuple[int, str | None]:
        """(count, oldest quarantined_at_utc) over all currently QUARANTINED
        rows -- the source query behind the AccountHealth fields
        `outbox_quarantined_count`/`oldest_outbox_quarantined_at_utc`
        (design doc §9/§11.8, O2)."""
        row = self._connection.execute(
            "SELECT COUNT(*), MIN(quarantined_at_utc) FROM outbox_messages "
            "WHERE state = 'QUARANTINED'"
        ).fetchone()
        count = int(row[0]) if row is not None else 0
        oldest = str(row[1]) if row is not None and row[1] is not None else None
        return count, oldest
