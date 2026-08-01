from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from threading import Lock
from typing import Any, Protocol

from bridge.canonical import (
    canonical_json_bytes,
    record_event_id,
    sha256_hex,
)
from bridge.config import TerminalProfile
from bridge.models import (
    AccountIdentity,
    BridgeEnvelope,
    CallState,
    ProducerIdentity,
    TerminalIdentity,
)
from bridge.mt5_adapter import CallResult
from bridge.redis_transport import FenceCredential, LeaseUnavailable


class LiveAdapter(Protocol):
    def account(self) -> CallResult: ...

    def positions(self) -> CallResult: ...

    def orders(self) -> CallResult: ...


class LiveSession(Protocol):
    profile: TerminalProfile
    adapter: LiveAdapter
    producer: ProducerIdentity
    terminal: TerminalIdentity
    journal_profile_id: str


class LiveTransport(Protocol):
    def publish_live_fenced(
        self, credential: FenceCredential, envelope: bytes
    ) -> None: ...


class LiveSequenceStore(Protocol):
    def reserve(self, profile_id: str, epoch_id: str) -> int: ...


class LiveOutcomeState(StrEnum):
    PUBLISHED = "published"
    FAILED = "failed"
    FENCE_REJECTED = "fence_rejected"


@dataclass(frozen=True)
class LiveOutcome:
    state: LiveOutcomeState
    envelope: bytes | None = None
    reason: str | None = None


@dataclass(frozen=True)
class _PendingPublication:
    kind: str
    envelope: bytes
    event_id: str


class LivePublisher:
    """Serial, fail-closed publication of complete raw MT5 live observations."""

    def __init__(
        self,
        *,
        transport: LiveTransport,
        sequences: LiveSequenceStore,
        observed_at_utc: Callable[[], str],
        revalidate: Callable[[LiveSession], None],
    ) -> None:
        self._transport = transport
        self._sequences = sequences
        self._observed_at_utc = observed_at_utc
        self._revalidate = revalidate
        self._call_lock = Lock()
        self._pending: dict[tuple[str, str], _PendingPublication] = {}

    def poll_once(self, session: LiveSession, fence: FenceCredential) -> LiveOutcome:
        with self._call_lock:
            return self._poll_once(session, fence)

    def _poll_once(self, session: LiveSession, fence: FenceCredential) -> LiveOutcome:
        if not self._matches_fence(session, fence):
            return LiveOutcome(LiveOutcomeState.FENCE_REJECTED, reason="fence mismatch")
        key = (session.journal_profile_id, session.producer.epoch_id)
        pending = self._pending.get(key)
        if pending is not None:
            return self._publish_pending(session, fence, pending)

        try:
            self._revalidate(session)
            account = session.adapter.account()
            positions = session.adapter.positions()
            orders = session.adapter.orders()
            failed_resources = self._failed_resources(account, positions, orders)
            if failed_resources:
                return self._publish_error(
                    session, fence, key, failed_resources, account, positions, orders
                )
            payload = self._snapshot_payload(
                session.profile, account, positions, orders
            )
            self._revalidate(session)
            pending = self._build_pending(session, "live.snapshot", "complete", payload)
        except (TypeError, ValueError, RuntimeError):
            return self._publish_error(
                session,
                fence,
                key,
                ["identity_or_validation"],
                None,
                None,
                None,
            )
        self._pending[key] = pending
        return self._publish_pending(session, fence, pending)

    @staticmethod
    def _matches_fence(session: LiveSession, fence: FenceCredential) -> bool:
        producer = session.producer
        return (
            session.profile.expected_login == fence.login
            and producer.profile_id == session.journal_profile_id
            and producer.epoch_id == fence.producer_epoch_id
            and producer.coordination_epoch == fence.coordination_epoch
            and producer.fencing_token == fence.fencing_token
        )

    @staticmethod
    def _failed_resources(
        account: CallResult, positions: CallResult, orders: CallResult
    ) -> list[str]:
        return [
            name
            for name, result in (
                ("account", account),
                ("positions", positions),
                ("orders", orders),
            )
            if result.state is CallState.FAILED
        ]

    @staticmethod
    def _snapshot_payload(
        profile: TerminalProfile,
        account: CallResult,
        positions: CallResult,
        orders: CallResult,
    ) -> dict[str, Any]:
        if account.state is not CallState.SUCCESS_NONEMPTY or not isinstance(
            account.value, dict
        ):
            raise ValueError("account read is not a successful value")
        if (
            account.value.get("login") != profile.expected_login
            or account.value.get("server") != profile.expected_server
        ):
            raise ValueError("account identity does not match profile")
        for name, result in (("positions", positions), ("orders", orders)):
            if result.state not in {
                CallState.SUCCESS_NONEMPTY,
                CallState.SUCCESS_EMPTY,
            }:
                raise ValueError(f"{name} read is not successful")
            canonical_json_bytes(result.rows)
        canonical_json_bytes(account.value)
        return {
            "account": {"raw": account.value, "state": account.state.value},
            "orders": {"rows": list(orders.rows), "state": orders.state.value},
            "positions": {
                "rows": list(positions.rows),
                "state": positions.state.value,
            },
        }

    def _publish_error(
        self,
        session: LiveSession,
        fence: FenceCredential,
        key: tuple[str, str],
        failed_resources: list[str],
        account: CallResult | None,
        positions: CallResult | None,
        orders: CallResult | None,
    ) -> LiveOutcome:
        try:
            states = {
                name: result.state.value if result is not None else "failed"
                for name, result in (
                    ("account", account),
                    ("positions", positions),
                    ("orders", orders),
                )
            }
            pending = self._build_pending(
                session,
                "live.error",
                "failed",
                {"failed_resources": failed_resources, "states": states},
            )
        except (TypeError, ValueError, RuntimeError):
            return LiveOutcome(
                LiveOutcomeState.FAILED, reason="error serialization failed"
            )
        self._pending[key] = pending
        return self._publish_pending(session, fence, pending)

    def _build_pending(
        self,
        session: LiveSession,
        message_type: str,
        payload_state: str,
        payload: dict[str, Any],
    ) -> _PendingPublication:
        sequence = self._sequences.reserve(
            session.journal_profile_id, session.producer.epoch_id
        )
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise ValueError("live sequence must be a positive integer")
        payload_with_sequence = {**payload, "sequence": sequence}
        payload_digest = sha256_hex(canonical_json_bytes(payload_with_sequence))
        event_id = record_event_id(
            namespace="mt5n:v1",
            schema_version="mt5n.bridge.v1",
            resource=message_type,
            natural_identity=(
                f"{session.journal_profile_id}:{session.producer.epoch_id}:{sequence}"
            ),
            payload_digest=payload_digest,
        )
        observed_at_utc = self._parse_observed_at_utc(self._observed_at_utc())
        envelope = BridgeEnvelope(
            schema="mt5n.bridge.v1",
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
            payload_state=payload_state,  # type: ignore[arg-type]
            payload=payload_with_sequence,
        )
        return _PendingPublication(
            kind=message_type,
            envelope=canonical_json_bytes(
                envelope.model_dump(mode="json", by_alias=True)
            ),
            event_id=event_id,
        )

    @staticmethod
    def _parse_observed_at_utc(observed: str) -> datetime:
        parsed = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("observed_at_utc must be timezone-aware")
        return parsed.astimezone(UTC)

    def _publish_pending(
        self,
        session: LiveSession,
        fence: FenceCredential,
        pending: _PendingPublication,
    ) -> LiveOutcome:
        try:
            self._revalidate(session)
            if pending.kind == "live.snapshot":
                self._transport.publish_live_fenced(fence, pending.envelope)
        except LeaseUnavailable:
            return LiveOutcome(LiveOutcomeState.FENCE_REJECTED, pending.envelope)
        except (TypeError, ValueError, RuntimeError):
            return LiveOutcome(LiveOutcomeState.FAILED, pending.envelope)
        self._pending.pop(self._pending_key(pending.envelope), None)
        if pending.kind == "live.snapshot":
            return LiveOutcome(LiveOutcomeState.PUBLISHED, pending.envelope)
        return LiveOutcome(LiveOutcomeState.FAILED, pending.envelope)

    @staticmethod
    def _pending_key(envelope: bytes) -> tuple[str, str]:
        decoded = BridgeEnvelope.model_validate_json(envelope)
        return (decoded.producer.profile_id, decoded.producer.epoch_id)
