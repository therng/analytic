from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Callable, Protocol

from bridge.journal.repository import (
    ClaimedOutboxMessage,
    JournalRepository,
    OutboxStateConflict,
)
from bridge.redis_transport import FenceCredential, LeaseUnavailable, RedisTransportError
from bridge.restart_policy import BackoffConfig


class OutboxTransport(Protocol):
    def append_stream_fenced(
        self, credential: FenceCredential, event_id: str, envelope: bytes
    ) -> str: ...


@dataclass(frozen=True)
class OutboxDispatchConfig:
    """§11.4's BRIDGE_OUTBOX_* defaults, as constructor arguments -- this
    module never reads environment variables itself, matching
    WorkerRuntimeConfig's existing convention of taking fully-resolved
    config rather than self-reading env."""

    batch_size: int = 50
    dispatch_interval_s: float = 2.0
    claim_lease_s: int = 30
    max_attempts: int = 8
    backoff: BackoffConfig = BackoffConfig(base_delay_ms=1000, max_delay_ms=60_000)
    cleanup_interval_s: float = 3600.0
    retention_s: float = 7 * 24 * 3600.0


def _message_type(envelope_json: bytes) -> str:
    envelope = json.loads(envelope_json)
    message_type = envelope.get("message_type") if isinstance(envelope, dict) else None
    if not isinstance(message_type, str):
        raise ValueError("outbox envelope must declare message_type")
    return message_type


class OutboxDispatchThread(threading.Thread):
    """Drains bridge/journal/repository.py's outbox_messages table to
    Redis (design doc §11). Plugs into the same `lease_lost` signal the
    worker's LeaseRenewalThread already sets (§11.5) rather than inventing
    a second failure-detection mechanism -- a fence rejection here means
    the credential is stale, not that any specific message failed, so it
    is never routed through fail_outbox."""

    def __init__(
        self,
        *,
        repository: JournalRepository,
        transport: OutboxTransport,
        credential: FenceCredential,
        owner_id: str,
        config: OutboxDispatchConfig,
        lease_lost: threading.Event,
        now_utc: Callable[[], str],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__(daemon=True)
        self._repository = repository
        self._transport = transport
        self._credential = credential
        self._owner_id = owner_id
        self._config = config
        self._lease_lost = lease_lost
        self._now_utc = now_utc
        self._clock = clock
        self._stop_event = threading.Event()
        self._stopping = threading.Event()
        self._last_cleanup_at = clock()

    def mark_shutting_down(self) -> None:
        self._stopping.set()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.wait(self._config.dispatch_interval_s):
            if self._lease_lost.is_set() or self._stopping.is_set():
                return
            try:
                self.dispatch_once()
            except Exception as error:  # noqa: BLE001 - an uncaught exception here
                # would silently kill this thread forever (Python threads
                # don't propagate exceptions anywhere); log and retry next
                # tick instead of leaving outbox delivery permanently dead
                # for the rest of the process's life.
                print(
                    f"[outbox] dispatch_once failed, will retry next tick: "
                    f"{type(error).__name__}: {error}",
                    file=sys.stderr,
                )
            if self._lease_lost.is_set() or self._stopping.is_set():
                return
            self._maybe_cleanup()

    def dispatch_once(self) -> None:
        """One claim-and-drain cycle. Public so tests (and a caller that
        wants a single synchronous pass instead of the sleep loop) can
        invoke it directly without starting the thread."""
        claimed = self._repository.claim_outbox(
            self._owner_id,
            limit=self._config.batch_size,
            now_utc=self._now_utc(),
            lease_seconds=self._config.claim_lease_s,
        )
        for message in claimed:
            if self._lease_lost.is_set() or self._stopping.is_set():
                return
            self._dispatch_one(message)

    def _dispatch_one(self, message: ClaimedOutboxMessage) -> None:
        try:
            message_type = _message_type(message.envelope_json)
        except (TypeError, ValueError, json.JSONDecodeError):
            self._fail(message, error_class="MalformedEnvelope", retryable=False)
            return

        if message_type == "history.window" and self._repository.has_blocking_sibling(
            message.window_id, message.event_id
        ):
            # §11.6 scenario 6: the claim-time gate already checked this,
            # inside the same transaction, so a mismatch here means that
            # gate has a bug -- not an expected runtime path. Skip this
            # message this cycle (it stays INFLIGHT, reclaimable) rather
            # than crash the whole dispatch loop over one message.
            return

        try:
            redis_entry_id = self._transport.append_stream_fenced(
                self._credential, message.event_id, message.envelope_json
            )
        except LeaseUnavailable:
            # §11.5: the credential is stale, not the message -- never call
            # fail_outbox here. Leave the row exactly as claim_outbox left
            # it; it becomes reclaimable once its lease expires.
            self._lease_lost.set()
            return
        except RedisTransportError:
            self._fail(message, error_class="RedisTransportError", retryable=True)
            return
        except (TypeError, ValueError) as error:  # noqa: BLE001 - see §11.4's table
            self._fail(message, error_class=type(error).__name__, retryable=False)
            return

        try:
            self._repository.ack_outbox(
                message.event_id, redis_entry_id=redis_entry_id, now_utc=self._now_utc()
            )
        except OutboxStateConflict:
            # Someone else already resolved this message (§11.3) -- not an
            # error worth surfacing.
            pass

    def _fail(self, message: ClaimedOutboxMessage, *, error_class: str, retryable: bool) -> None:
        try:
            self._repository.fail_outbox(
                message.event_id,
                error_class=error_class,
                # Redacted by construction: only the exception's class name
                # is recorded, never its message text, so an exception that
                # happens to embed a secret in its str() never reaches
                # durable storage (bridge/errors.py's RedactedFailure uses
                # the same "never store free-text error detail" bias).
                error_redacted=error_class,
                retryable=retryable,
                now_utc=self._now_utc(),
                backoff_config=self._config.backoff,
                max_attempts=self._config.max_attempts,
            )
        except OutboxStateConflict:
            pass

    def _maybe_cleanup(self) -> None:
        now = self._clock()
        if now - self._last_cleanup_at < self._config.cleanup_interval_s:
            return
        self._last_cleanup_at = now
        cutoff = self._now_utc_minus(self._config.retention_s)
        self._repository.cleanup_published_outbox(published_before_utc=cutoff)

    def _now_utc_minus(self, seconds: float) -> str:
        now = datetime.fromisoformat(self._now_utc().replace("Z", "+00:00")).astimezone(UTC)
        return (now - timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z")
