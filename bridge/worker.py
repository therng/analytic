from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable, Protocol

from bridge.account_config import ConfigLoadError, load_account_file
from bridge.atomic_io import atomic_write_json
from bridge.canonical import canonical_json_bytes, sha256_hex
from bridge.exit_codes import WorkerExitCode
from bridge.journal.backup import JournalCheckState, JournalRecoveryError
from bridge.journal.connection import Journal
from bridge.journal.repository import JournalRepository
from bridge.outbox_dispatcher import OutboxDispatchConfig, OutboxDispatchThread, OutboxTransport
from bridge.ownership import (
    LocalLoginLock,
    LocalOwnershipUnavailable,
    StaleLocalLockEvidence,
)
from bridge.redis_transport import (
    FenceCredential,
    LeaseUnavailable,
    RedisLease,
    RedisTransportError,
)
from bridge.terminal_session import (
    TerminalIdentityViolation,
    TerminalNotReadyError,
    TerminalSession,
    VerifiedSession,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# §8 startup: reverse-order cleanup stack
# ---------------------------------------------------------------------------


class CleanupStack:
    """A stack of undo callables pushed after each successful startup step,
    popped and invoked in LIFO order on any later step's failure -- never a
    hand-written try/except cascade per step, which is exactly the shape
    most likely to silently drift out of order after a future edit."""

    def __init__(self) -> None:
        self._undo: list[tuple[str, Callable[[], None]]] = []

    def push(self, label: str, undo: Callable[[], None]) -> None:
        self._undo.append((label, undo))

    def unwind(self) -> list[str]:
        """Runs every undo callable in reverse order. A failure in one undo
        does not prevent the rest from running; failures are collected and
        raised together at the end so cleanup is never silently partial."""
        executed: list[str] = []
        errors: list[tuple[str, Exception]] = []
        while self._undo:
            label, undo = self._undo.pop()
            try:
                undo()
                executed.append(label)
            except Exception as error:  # noqa: BLE001 - collected, not swallowed
                errors.append((label, error))
        if errors:
            raise ExceptionGroup(  # noqa: F821 - py3.11+
                "cleanup step(s) failed during reverse unwind",
                [error for _, error in errors],
            )
        return executed


# ---------------------------------------------------------------------------
# §4 renewal-thread failure — bounded fail-closed watchdog
# ---------------------------------------------------------------------------


def is_lease_stale(*, last_success_at: float, now: float, ttl_s: float, margin_s: float) -> bool:
    """The single bound every renewal-thread failure mode converges to:
    Redis timeout, thread death, delayed renewal, or an unclassifiable
    response all stop `last_success_at` from advancing, and this check
    fires at the same fixed bound regardless of which one happened."""
    return (now - last_success_at) > (ttl_s - margin_s)


class LeaseRenewalThread(threading.Thread):
    """Background renewal, independent of the poll loop so a slow/blocked
    MT5 call can never delay a renewal attempt. Sets `lease_lost` on a
    definitive LeaseUnavailable (the fast path); the main loop's own
    `is_lease_stale` check is the actual safety net for every failure mode
    that doesn't produce a clean LeaseUnavailable at all (§4)."""

    def __init__(
        self,
        *,
        lease: RedisLease,
        credential: FenceCredential,
        ttl_ms: int,
        renew_interval_s: float,
        clock: Callable[[], float] = time.monotonic,
        lease_lost: threading.Event | None = None,
    ) -> None:
        super().__init__(daemon=True)
        self._lease = lease
        self._credential = credential
        self._ttl_ms = ttl_ms
        self._renew_interval_s = renew_interval_s
        self._clock = clock
        self._stop_event = threading.Event()
        # Shared with OutboxDispatchThread (design doc §11.5, "first one to
        # detect the loss wins" extended to a third thread) when the caller
        # passes one in; a standalone caller (or an existing test) that
        # doesn't pass one still gets a private Event, unchanged behavior.
        self.lease_lost = lease_lost if lease_lost is not None else threading.Event()
        self._lock = threading.Lock()
        self._last_success_at = clock()
        self._shutting_down = threading.Event()

    def get_last_success_at(self) -> float:
        with self._lock:
            return self._last_success_at

    def mark_shutting_down(self) -> None:
        """Called by the main thread's clean-shutdown path before releasing
        the lease, so a renewal attempt that loses the shutdown race (fires
        just as the main thread releases the lease) is treated as a no-op
        rather than a spurious lease-loss signal (§4 shutdown races)."""
        self._shutting_down.set()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.wait(self._renew_interval_s):
            if self._shutting_down.is_set():
                return
            try:
                ok = self._lease.renew(self._credential, self._ttl_ms)
                if ok:
                    with self._lock:
                        self._last_success_at = self._clock()
            except LeaseUnavailable:
                if not self._shutting_down.is_set():
                    self.lease_lost.set()
                return
            except RedisTransportError:
                # Unclassifiable response (§4): do not mark success, do not
                # give up either -- persistent ambiguity converges to the
                # same is_lease_stale bound as every other failure mode.
                continue


# ---------------------------------------------------------------------------
# Worker session — what the injected poll callables operate against
# ---------------------------------------------------------------------------


class PollLive(Protocol):
    def __call__(self) -> object: ...


class PollHistory(Protocol):
    def __call__(self) -> object: ...


@dataclass(frozen=True)
class WorkerRuntimeConfig:
    owner_id: str
    lease_ttl_ms: int
    lease_renew_interval_ms: int
    lease_watchdog_margin_s: float
    revalidate_every_n_polls: int
    live_poll_s: float
    history_poll_s: float


class WorkerDependencies(Protocol):
    local_lock: LocalLoginLock
    journal_open: Callable[[object], Journal]
    lease: RedisLease
    terminal_session: TerminalSession
    poll_live: PollLive
    poll_history: PollHistory


@dataclass(frozen=True)
class WorkerOutcome:
    exit_code: WorkerExitCode
    detail: str


def run_worker(
    *,
    config_path,
    runtime_config: WorkerRuntimeConfig,
    local_lock: LocalLoginLock,
    journal_open: Callable[[object], Journal],
    lease: RedisLease,
    terminal_session: TerminalSession,
    poll_live: PollLive | None = None,
    poll_history: PollHistory | None = None,
    poll_callables_factory: Callable[[VerifiedSession, FenceCredential], tuple[PollLive, PollHistory]]
    | None = None,
    now_s: float = 0.0,
    max_history_skew_s: int = 86400,
    producer_epoch_id: str = "",
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    stop_requested: threading.Event | None = None,
    max_poll_cycles: int | None = None,
    parent_pid_check: Callable[[], int] | None = os.getppid,
    outbox_repository: JournalRepository | None = None,
    outbox_enabled: bool = False,
    outbox_transport: OutboxTransport | None = None,
    outbox_config: OutboxDispatchConfig | None = None,
    outbox_now_utc: Callable[[], str] | None = None,
) -> WorkerOutcome:
    """Runs one account worker through the full §8 startup order, then the
    poll loop, returning the exit code the process should use. `stop_requested`
    lets a caller (or a test) request a clean stop; `max_poll_cycles` bounds
    the loop for tests -- production callers leave it None and rely on
    `stop_requested` alone.

    `poll_live`/`poll_history` may be supplied directly (as before), or
    `poll_callables_factory(verified, credential)` may be supplied instead
    -- called right after Step 5's verified MT5 connection, when a real
    `verified`/`credential` first exist, which is exactly what
    `bridge/session_wiring.py`'s real (non-test-fake) poll_live/poll_history
    need and could not be constructed before this function ran. Exactly one
    of the two modes must be supplied."""
    if (poll_live is None or poll_history is None) == (poll_callables_factory is None):
        raise ValueError(
            "exactly one of (poll_live and poll_history) or poll_callables_factory is required"
        )
    cleanup = CleanupStack()
    stop_requested = stop_requested or threading.Event()
    initial_parent_pid = parent_pid_check() if parent_pid_check else None

    # Step 1: config validation
    try:
        account = load_account_file(
            config_path, now_s=now_s, max_history_skew_s=max_history_skew_s
        )
    except ConfigLoadError as error:
        return WorkerOutcome(WorkerExitCode.CONFIG_INVALID, str(error))

    # Step 2: local ownership
    try:
        local_handle = local_lock.acquire(account.profile.expected_login, runtime_config.owner_id)
    except StaleLocalLockEvidence as error:
        return WorkerOutcome(WorkerExitCode.CONFIG_INVALID, str(error))
    except LocalOwnershipUnavailable as error:
        return WorkerOutcome(WorkerExitCode.DUPLICATE_OWNERSHIP, str(error))
    cleanup.push("local_lock", local_handle.release)

    # Step 3: journal open/migrate
    try:
        journal = journal_open(account.journal)
    except JournalRecoveryError as error:
        logger.exception(
            "journal_open failed: profile_id=%s login=%s journal=%s",
            account.profile.profile_id,
            account.profile.expected_login,
            account.journal,
        )
        cleanup.unwind()
        # A held lock (AV scan, another handle mid-close) is transient --
        # worth a backoff retry, not a permanent quarantine like real
        # corruption. See bridge/journal/backup.py check_journal().
        exit_code = (
            WorkerExitCode.JOURNAL_LOCKED
            if error.state is JournalCheckState.LOCKED
            else WorkerExitCode.JOURNAL_FAILURE
        )
        return WorkerOutcome(exit_code, str(error))
    except Exception as error:  # noqa: BLE001 - journal.open raises various failure types
        logger.exception(
            "journal_open failed: profile_id=%s login=%s journal=%s",
            account.profile.profile_id,
            account.profile.expected_login,
            account.journal,
        )
        cleanup.unwind()
        return WorkerOutcome(WorkerExitCode.JOURNAL_FAILURE, str(error))
    cleanup.push("journal", journal.close)
    try:
        JournalRepository(journal.connection).recover_history_lower_bound(
            account.profile.profile_id,
            account.profile.history_lower_bound_raw,
            _default_now_utc(),
            journal_path=getattr(journal, "path", None),
        )
    except Exception as error:  # noqa: BLE001 - guarded backup/SQLite recovery
        logger.exception(
            "recover_history_lower_bound failed: profile_id=%s login=%s journal=%s",
            account.profile.profile_id,
            account.profile.expected_login,
            getattr(journal, "path", None),
        )
        cleanup.unwind()
        return WorkerOutcome(WorkerExitCode.JOURNAL_FAILURE, str(error))
    if outbox_repository is None and outbox_enabled:
        # The dispatcher runs on its own thread (started in Step 6 below),
        # and sqlite3.Connection objects are not safe to use from a thread
        # other than the one that created them -- so this must be a second,
        # independently-configured connection to the same WAL-mode journal
        # file, never journal.connection itself.
        outbox_connection = journal.open_secondary_connection()
        cleanup.push("outbox_connection", outbox_connection.close)
        outbox_repository = JournalRepository(outbox_connection)

    # Step 4: Redis lease
    try:
        credential = lease.acquire(
            account.profile.expected_login,
            runtime_config.owner_id,
            producer_epoch_id,
            runtime_config.lease_ttl_ms,
        )
    except LeaseUnavailable as error:
        cleanup.unwind()
        return WorkerOutcome(WorkerExitCode.DUPLICATE_OWNERSHIP, str(error))
    cleanup.push("lease", lambda: lease.release(credential))

    # Step 5: verified MT5 connection
    try:
        verified = terminal_session.connect_verified(account.profile)
    except TerminalNotReadyError as error:
        cleanup.unwind()
        return WorkerOutcome(WorkerExitCode.TERMINAL_NOT_READY, str(error))
    except TerminalIdentityViolation as error:
        cleanup.unwind()
        return WorkerOutcome(WorkerExitCode.IDENTITY_VIOLATION, str(error))
    except Exception as error:  # noqa: BLE001 - MT5 IPC-layer failures
        cleanup.unwind()
        return WorkerOutcome(WorkerExitCode.MT5_IPC_FAILURE, str(error))

    if poll_callables_factory is not None:
        try:
            poll_live, poll_history = poll_callables_factory(verified, credential)
        except Exception as error:  # noqa: BLE001 - session wiring/journal/Redis failures, any of them
            cleanup.unwind()
            return WorkerOutcome(WorkerExitCode.UNEXPECTED_FATAL, str(error))
    assert poll_live is not None and poll_history is not None

    # Step 6: publisher loops
    lease_lost = threading.Event()
    renewal_thread = LeaseRenewalThread(
        lease=lease,
        credential=credential,
        ttl_ms=runtime_config.lease_ttl_ms,
        renew_interval_s=runtime_config.lease_renew_interval_ms / 1000,
        clock=clock,
        lease_lost=lease_lost,
    )
    renewal_thread.start()
    cleanup.push("renewal_thread", renewal_thread.stop)

    # Outbox dispatch (design doc §11) is optional: a caller that doesn't
    # pass outbox_repository gets the worker's existing live/history
    # behavior unchanged -- this keeps every current and future test that
    # doesn't care about the outbox from having to stand one up.
    outbox_thread: OutboxDispatchThread | None = None
    if outbox_repository is not None:
        outbox_thread = OutboxDispatchThread(
            repository=outbox_repository,
            transport=outbox_transport or lease,
            credential=credential,
            owner_id=runtime_config.owner_id,
            config=outbox_config or OutboxDispatchConfig(),
            lease_lost=lease_lost,
            now_utc=outbox_now_utc or _default_now_utc,
            clock=clock,
        )
        outbox_thread.start()
        cleanup.push("outbox_thread", outbox_thread.stop)

    outcome: WorkerOutcome | None = None
    try:
        outcome = _poll_loop(
            runtime_config=runtime_config,
            terminal_session=terminal_session,
            verified=verified,
            poll_live=poll_live,
            poll_history=poll_history,
            renewal_thread=renewal_thread,
            clock=clock,
            sleep=sleep,
            stop_requested=stop_requested,
            max_poll_cycles=max_poll_cycles,
            parent_pid_check=parent_pid_check,
            initial_parent_pid=initial_parent_pid,
        )
    finally:
        if outcome is not None and outcome.exit_code is WorkerExitCode.CLEAN_SHUTDOWN:
            renewal_thread.mark_shutting_down()
            if outbox_thread is not None:
                outbox_thread.mark_shutting_down()
        renewal_thread.stop()
        if outbox_thread is not None:
            outbox_thread.stop()
        cleanup.unwind()

    return outcome


def _default_now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _poll_loop(
    *,
    runtime_config: WorkerRuntimeConfig,
    terminal_session: TerminalSession,
    verified,
    poll_live: PollLive,
    poll_history: PollHistory,
    renewal_thread: LeaseRenewalThread,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    stop_requested: threading.Event,
    max_poll_cycles: int | None,
    parent_pid_check: Callable[[], int] | None,
    initial_parent_pid: int | None,
) -> WorkerOutcome:
    ttl_s = runtime_config.lease_ttl_ms / 1000
    cycle = 0
    live_error_count = 0
    while True:
        if stop_requested.is_set():
            return WorkerOutcome(WorkerExitCode.CLEAN_SHUTDOWN, "stop requested")

        if parent_pid_check is not None and initial_parent_pid is not None:
            if parent_pid_check() != initial_parent_pid:
                # §1 defense in depth: orphaned (parent PID changed) is
                # treated as a shutdown signal, not a fatal error.
                return WorkerOutcome(WorkerExitCode.CLEAN_SHUTDOWN, "orphaned: parent changed")

        # §3/§4: lease-loss check happens BEFORE any MT5 touch this cycle --
        # a lost lease must stop MT5 work entirely, not merely skip publish.
        if renewal_thread.lease_lost.is_set():
            return WorkerOutcome(WorkerExitCode.LEASE_LOST, "lease lost (renewal thread)")
        if is_lease_stale(
            last_success_at=renewal_thread.get_last_success_at(),
            now=clock(),
            ttl_s=ttl_s,
            margin_s=runtime_config.lease_watchdog_margin_s,
        ):
            return WorkerOutcome(WorkerExitCode.LEASE_LOST, "lease renewal watchdog bound exceeded")

        if cycle % max(runtime_config.revalidate_every_n_polls, 1) == 0:
            try:
                terminal_session.revalidate(verified)
            except TerminalNotReadyError as error:
                return WorkerOutcome(WorkerExitCode.TERMINAL_NOT_READY, str(error))
            except TerminalIdentityViolation as error:
                return WorkerOutcome(WorkerExitCode.IDENTITY_VIOLATION, str(error))

        try:
            live_outcome = poll_live()
            # poll_live() (bridge/session_wiring.py) already raises
            # LeaseUnavailable for a fence-rejected outcome -- a FAILED
            # LiveOutcomeState (message_type "live.error": a required MT5
            # read failed, or identity/serialization validation raised) is
            # the only case that returns without raising, and previously had
            # zero observability -- discarded here with no log, no counter,
            # no Redis trace (stream:live, the former mirror, is retired).
            # Duck-typed via getattr, not an import of LiveOutcomeState, to
            # keep this module's existing decoupling from bridge.live's
            # concrete types; StrEnum members compare equal to their string
            # value so the plain "failed" literal is correct and stable.
            if getattr(live_outcome, "state", None) == "failed":
                live_error_count += 1
                print(
                    "live_error "
                    f"login={verified.profile.expected_login} "
                    f"reason={getattr(live_outcome, 'reason', None)} "
                    f"live_error_count={live_error_count}",
                    file=sys.stderr,
                )
            poll_history()
        except TerminalNotReadyError as error:
            return WorkerOutcome(WorkerExitCode.TERMINAL_NOT_READY, str(error))
        except TerminalIdentityViolation as error:
            return WorkerOutcome(WorkerExitCode.IDENTITY_VIOLATION, str(error))
        except LeaseUnavailable as error:
            return WorkerOutcome(WorkerExitCode.LEASE_LOST, str(error))

        cycle += 1
        if max_poll_cycles is not None and cycle >= max_poll_cycles:
            return WorkerOutcome(WorkerExitCode.CLEAN_SHUTDOWN, "max_poll_cycles reached (test bound)")

        sleep(runtime_config.live_poll_s)


# ---------------------------------------------------------------------------
# CLI entrypoint: `python -m bridge.worker <account-config-path>`
# ---------------------------------------------------------------------------


def install_stop_signal_handlers(stop_requested: threading.Event) -> None:
    """Wire OS shutdown signals to stop_requested. The supervisor's shutdown
    ladder (bridge/supervisor.py) sends CTRL_BREAK_EVENT to this process to
    ask it to stop cleanly before escalating to terminate/kill; without a
    handler, Windows' default action for an unhandled CTRL_BREAK is to end
    the process immediately -- _poll_loop never sees a stop request,
    cleanup.unwind() never runs, and local_lock/lease/journal/outbox-thread
    are all left unreleased. SIGTERM/SIGINT are also wired for portability
    (e.g. running the worker directly outside the supervisor)."""

    def _handle(signum: int, frame: object) -> None:
        stop_requested.set()

    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle)
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)


def _write_last_exit(
    state_dir, login_key: str, exit_code: int, detail: str, *, worker_pid: int
) -> None:
    """Best-effort record of why this worker process exited, keyed by the
    account login (derivable from the config filename even when the config
    itself never parsed) -- the supervisor reads this back to persist a
    human-readable reason alongside the bare exit-code classification in
    the quarantine record. Exit code alone can't distinguish a truly
    invalid config from a missing REDIS_URL or a stale local lock; all
    three currently share CONFIG_INVALID."""
    try:
        atomic_write_json(
            state_dir / "last_exit" / f"{login_key}.json",
            {"exit_code": exit_code, "detail": detail, "worker_pid": worker_pid},
        )
    except OSError:
        pass  # diagnostic-only; never let this mask the real exit code


def _log_worker_exit(
    *,
    outcome: WorkerOutcome,
    login: str,
    profile_path: str,
    terminal_path: str,
    terminal_pid: int | None,
) -> None:
    print(
        "worker exit: "
        f"login={login} profile_path={profile_path} terminal_path={terminal_path} "
        f"terminal_pid={terminal_pid if terminal_pid is not None else 'unavailable'} "
        f"worker_pid={os.getpid()} classification={outcome.exit_code.name} "
        f"reason={outcome.detail}",
        file=sys.stderr,
    )


def main(argv: list[str] | None = None) -> int:
    """Real (non-test-fake) process entrypoint for one account, spawned by
    the supervisor (`bridge/supervisor.py`) once per resolved account,
    never invoked with per-account flags -- the config path is the single
    positional argument the supervisor itself generates."""
    import socket
    import uuid as uuid_module
    from pathlib import Path

    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        _log_worker_exit(
            outcome=WorkerOutcome(
                WorkerExitCode.CONFIG_INVALID,
                "usage: python -m bridge.worker <account-config-path>",
            ),
            login="unavailable",
            profile_path="unavailable",
            terminal_path="unavailable",
            terminal_pid=None,
        )
        return int(WorkerExitCode.CONFIG_INVALID)

    config_path = Path(argv[0])
    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR", "bridge/state"))
    login_key = config_path.stem
    profile_path = "unavailable"
    terminal_path = "unavailable"
    try:
        log_account = load_account_file(
            config_path,
            now_s=time.time(),
            max_history_skew_s=int(
                os.environ.get("BRIDGE_HISTORY_LOWER_BOUND_MAX_SKEW_S", "86400")
            ),
        )
        login_key = str(log_account.profile.expected_login)
        profile_path = log_account.profile.expected_data_path
        terminal_path = log_account.profile.executable_path
    except ConfigLoadError:
        pass

    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        detail = "REDIS_URL is required"
        outcome = WorkerOutcome(WorkerExitCode.CONFIG_INVALID, detail)
        _log_worker_exit(
            outcome=outcome,
            login=login_key,
            profile_path=profile_path,
            terminal_path=terminal_path,
            terminal_pid=None,
        )
        _write_last_exit(
            state_dir,
            login_key,
            int(WorkerExitCode.CONFIG_INVALID),
            detail,
            worker_pid=os.getpid(),
        )
        return int(WorkerExitCode.CONFIG_INVALID)

    import redis as redis_module

    from bridge.adapters.mt5_real import RealMt5Port
    from bridge.adapters.process_probe_psutil import RealProcessProbe
    from bridge.history import HistoryPolicy
    from bridge.session_wiring import build_poll_callables, build_wired_session

    owner_id = f"{socket.gethostname()}:{os.getpid()}"
    producer_epoch_id = str(uuid_module.uuid4())
    lease = RedisLease(redis_module.Redis.from_url(redis_url))
    terminal_session = TerminalSession(RealProcessProbe(), RealMt5Port())

    stop_requested = threading.Event()
    install_stop_signal_handlers(stop_requested)

    runtime_config = WorkerRuntimeConfig(
        owner_id=owner_id,
        lease_ttl_ms=int(os.environ.get("BRIDGE_LEASE_TTL_MS", "15000")),
        lease_renew_interval_ms=int(
            os.environ.get("BRIDGE_LEASE_RENEW_INTERVAL_MS", str(15000 // 3))
        ),
        lease_watchdog_margin_s=float(os.environ.get("BRIDGE_LEASE_WATCHDOG_MARGIN_S", "2")),
        revalidate_every_n_polls=int(os.environ.get("BRIDGE_REVALIDATE_EVERY_N_POLLS", "1")),
        live_poll_s=int(os.environ.get("BRIDGE_LIVE_POLL_MS", "1000")) / 1000,
        history_poll_s=int(os.environ.get("BRIDGE_HISTORY_POLL_MS", "30000")) / 1000,
    )

    def poll_callables_factory(
        verified: VerifiedSession, credential: FenceCredential
    ) -> tuple[PollLive, PollHistory]:
        session = build_wired_session(
            verified=verified, credential=credential, producer_id=owner_id
        )
        repository = JournalRepository(journal.connection)
        now_utc = _default_now_utc()
        config_digest = sha256_hex(
            canonical_json_bytes(verified.profile.model_dump(mode="json"))
        )
        # Every live_sequences.reserve() call needs both FKs already
        # satisfied; register once here, at session setup, rather than on
        # every reserve() call. register_profile() may reconcile against a
        # pre-existing row for this login under a different profile_id
        # (config drift since the login was last seen) -- register_epoch
        # must use whatever it returns, not session.profile.profile_id
        # blindly, or it FK-references a profile_id that was never written.
        registered_profile_id = repository.register_profile(
            profile_id=session.profile.profile_id,
            login=session.profile.expected_login,
            server=session.profile.expected_server,
            terminal_id=session.terminal.terminal_id,
            config_digest=config_digest,
            now_utc=now_utc,
        )
        if registered_profile_id != session.journal_profile_id:
            session = build_wired_session(
                verified=verified,
                credential=credential,
                producer_id=owner_id,
                journal_profile_id=registered_profile_id,
            )
        repository.register_epoch(
            epoch_id=credential.producer_epoch_id,
            profile_id=registered_profile_id,
            fence_token=credential.fencing_token,
            started_at_utc=now_utc,
            start_reason="lease_acquired",
        )
        return build_poll_callables(
            terminal_session=terminal_session,
            session=session,
            credential=credential,
            lease=lease,
            repository=repository,
            history_policy=HistoryPolicy(
                maximum_window_raw=int(os.environ.get("BRIDGE_HISTORY_WINDOW_RAW", "86400")),
                overlap_raw=int(os.environ.get("BRIDGE_HISTORY_OVERLAP_RAW", "60")),
                policy_version=1,
                empty_window_raw=int(
                    os.environ.get("BRIDGE_HISTORY_EMPTY_WINDOW_RAW", "2592000")
                ),
            ),
            now_utc=_default_now_utc,
            now_s=time.time,
            history_grace_s=int(os.environ.get("BRIDGE_HISTORY_SYNC_GRACE_S", "60")),
        )

    journal: Journal | None = None

    def journal_open(journal_config: object) -> Journal:
        nonlocal journal
        journal = Journal.open(journal_config)
        return journal

    outcome = run_worker(
        config_path=config_path,
        runtime_config=runtime_config,
        local_lock=LocalLoginLock(state_dir / "locks"),
        journal_open=journal_open,
        lease=lease,
        terminal_session=terminal_session,
        poll_callables_factory=poll_callables_factory,
        now_s=time.time(),
        max_history_skew_s=int(os.environ.get("BRIDGE_HISTORY_LOWER_BOUND_MAX_SKEW_S", "86400")),
        producer_epoch_id=producer_epoch_id,
        stop_requested=stop_requested,
        outbox_enabled=True,
        outbox_config=OutboxDispatchConfig(
            batch_size=int(os.environ.get("BRIDGE_OUTBOX_DISPATCH_BATCH_SIZE", "50")),
            dispatch_interval_s=int(os.environ.get("BRIDGE_OUTBOX_DISPATCH_INTERVAL_MS", "2000"))
            / 1000,
            claim_lease_s=int(os.environ.get("BRIDGE_OUTBOX_CLAIM_LEASE_S", "30")),
            max_attempts=int(os.environ.get("BRIDGE_OUTBOX_MAX_ATTEMPTS", "8")),
            cleanup_interval_s=3600.0,
            retention_s=int(os.environ.get("BRIDGE_OUTBOX_RETENTION_DAYS", "7")) * 86400.0,
        ),
    )
    _log_worker_exit(
        outcome=outcome,
        login=login_key,
        profile_path=profile_path,
        terminal_path=terminal_path,
        terminal_pid=terminal_session.terminal_pid,
    )
    _write_last_exit(
        state_dir,
        login_key,
        int(outcome.exit_code),
        outcome.detail,
        worker_pid=os.getpid(),
    )
    return int(outcome.exit_code)


if __name__ == "__main__":
    sys.exit(main())
