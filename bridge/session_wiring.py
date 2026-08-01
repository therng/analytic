from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from bridge.canonical import canonical_json_bytes, sha256_hex
from bridge.config import TerminalProfile
from bridge.history import HistoryPolicy, HistorySynchronizer
from bridge.history_boundary import SafeEndBoundaryProvider
from bridge.journal.repository import JournalRepository
from bridge.live import LivePublisher, LiveOutcomeState
from bridge.models import ProducerIdentity, TerminalIdentity
from bridge.mt5_adapter import StrictMt5Adapter
from bridge.redis_transport import FenceCredential, LeaseUnavailable, RedisLease
from bridge.terminal_session import TerminalSession, VerifiedSession
from bridge.worker import PollHistory, PollLive


@dataclass(frozen=True)
class WiredSession:
    """Satisfies both live.py's LiveSession and history.py's HistorySession
    Protocols (profile/adapter/producer/terminal) while keeping the
    original VerifiedSession around for TerminalSession.revalidate calls."""

    profile: TerminalProfile
    adapter: StrictMt5Adapter
    producer: ProducerIdentity
    terminal: TerminalIdentity
    verified: VerifiedSession
    journal_profile_id: str


def build_wired_session(
    *,
    verified: VerifiedSession,
    credential: FenceCredential,
    producer_id: str,
    journal_profile_id: str | None = None,
) -> WiredSession:
    fingerprint = verified.fingerprint
    terminal_id = sha256_hex(
        canonical_json_bytes(
            {
                "pid": fingerprint.pid,
                "creation_time": fingerprint.creation_time,
                "executable_path": fingerprint.executable_path.casefold(),
            }
        )
    )
    producer = ProducerIdentity(
        producer_id=producer_id,
        profile_id=journal_profile_id or verified.profile.profile_id,
        epoch_id=credential.producer_epoch_id,
        coordination_epoch=credential.coordination_epoch,
        fencing_token=credential.fencing_token,
    )
    terminal = TerminalIdentity(
        terminal_id=terminal_id,
        portable=verified.profile.portable,
        path_digest=sha256_hex(verified.profile.executable_path.casefold().encode()),
        data_path_digest=sha256_hex(verified.profile.expected_data_path.casefold().encode()),
    )
    return WiredSession(
        profile=verified.profile,
        adapter=verified.adapter,
        producer=producer,
        terminal=terminal,
        verified=verified,
        journal_profile_id=journal_profile_id or verified.profile.profile_id,
    )


def build_poll_callables(
    *,
    terminal_session: TerminalSession,
    session: WiredSession,
    credential: FenceCredential,
    lease: RedisLease,
    repository: JournalRepository,
    history_policy: HistoryPolicy,
    now_utc: Callable[[], str],
    now_s: Callable[[], float],
    history_grace_s: int,
    on_history_outcome: Callable[[object], None] | None = None,
    on_live_outcome: Callable[[object], None] | None = None,
) -> tuple[PollLive, PollHistory]:
    """Builds the real poll_live/poll_history callables run_worker's poll
    loop calls every cycle, from the already-built LivePublisher/
    HistorySynchronizer -- the piece the entrypoint design's ground-truth
    section named as the last thing standing between run_worker and a real
    (non-test-fake) worker process."""

    def revalidate(_session: object) -> None:
        terminal_session.revalidate(session.verified)

    live_publisher = LivePublisher(
        transport=lease,
        sequences=repository,
        observed_at_utc=now_utc,
        revalidate=revalidate,
    )
    history_synchronizer = HistorySynchronizer(
        repository=repository,
        boundary_provider=SafeEndBoundaryProvider(now_s=now_s, grace_s=history_grace_s),
        policy=history_policy,
        observed_at_utc=now_utc,
        revalidate=revalidate,
    )

    def poll_live() -> object:
        outcome = live_publisher.poll_once(session, credential)
        if on_live_outcome is not None:
            on_live_outcome(outcome)
        if outcome.state is LiveOutcomeState.FENCE_REJECTED:
            # live.py swallows LeaseUnavailable internally and reports it as
            # FENCE_REJECTED instead of raising -- the poll loop's own
            # lease-loss handling (worker.py) expects a raised
            # LeaseUnavailable, so this is the translation point between
            # the two layers' error-reporting conventions.
            raise LeaseUnavailable("live publish fence rejected")
        return outcome

    def poll_history() -> object:
        checkpoint = repository.get_checkpoint(session.journal_profile_id)
        outcome = history_synchronizer.run_next_window(session, checkpoint)
        if on_history_outcome is not None:
            on_history_outcome(outcome)
        # WindowOutcomeState.ABORTED is a legitimate retry-next-cycle
        # result (e.g. a transient MT5 read failure) -- history sync never
        # makes a fenced Redis call directly (that's the outbox
        # dispatcher's job, asynchronously), so there is no lease-rejection
        # case to translate here, unlike poll_live above.
        return outcome

    return poll_live, poll_history
