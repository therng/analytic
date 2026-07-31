from __future__ import annotations

import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable, Protocol

from bridge.account_resolution import ResolvedAccounts, resolve_accounts
from bridge.discovery import Mt5ConnectPort, ProcessLister
from bridge.exit_codes import Classification, classify_raw_exit_code
from bridge.health import HealthStore
from bridge.job_object import WindowsJobObject
from bridge.quarantine import QuarantineStore
from bridge.restart_policy import (
    BackoffConfig,
    PolicyKind,
    apply_stable_runtime_reset,
    decide,
)


def _now_utc() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


class ProcessHandle(Protocol):
    @property
    def pid(self) -> int: ...

    def poll(self) -> int | None: ...

    def send_ctrl_break(self) -> None: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


class JobObjectLike(Protocol):
    def assign_process(self, pid: int) -> None: ...

    def close(self) -> None: ...


def default_spawn(config_path: Path) -> ProcessHandle:
    import subprocess

    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    popen = subprocess.Popen(  # noqa: S603 - fixed argv, no shell, no untrusted input
        [sys.executable, "-m", "bridge.worker", str(config_path)],
        creationflags=creationflags,
    )
    return _PopenHandle(popen)


class _PopenHandle:
    def __init__(self, popen: object) -> None:
        self._popen = popen

    @property
    def pid(self) -> int:
        return self._popen.pid  # type: ignore[attr-defined]

    def poll(self) -> int | None:
        return self._popen.poll()  # type: ignore[attr-defined]

    def send_ctrl_break(self) -> None:
        if sys.platform != "win32":
            return
        import signal

        self._popen.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]

    def terminate(self) -> None:
        self._popen.terminate()  # type: ignore[attr-defined]

    def kill(self) -> None:
        self._popen.kill()  # type: ignore[attr-defined]


@dataclass(frozen=True)
class SupervisorConfig:
    overrides_dir: Path
    generated_dir: Path
    state_dir: Path
    state_dir_windows: str
    tick_interval_s: float = 5.0
    discovery_rescan_s: float = 30.0
    ctrl_break_wait_s: float = 2.0
    shutdown_grace_s: float = 15.0
    shutdown_kill_grace_s: float = 5.0
    max_history_skew_s: int = 86400
    backoff: BackoffConfig = field(default_factory=BackoffConfig)


@dataclass
class _Child:
    profile_id: str
    login: int
    config_path: Path
    handle: ProcessHandle
    job_object: JobObjectLike | None
    started_at_s: float


@dataclass
class _PendingRespawn:
    login: int
    config_path: Path
    due_at_s: float


class Supervisor:
    """Composes every already-built piece the entrypoint design specified
    but never wired together: account resolution (auto-discovery, §12),
    Job Object lifecycle (§1), restart policy (§10 Layer 4) and durable
    quarantine (§7), and the CTRL_BREAK/terminate/kill/job-close shutdown
    ladder (§2) -- one process per unique account, tracked, restarted, or
    quarantined per the account's own exit classification.
    """

    def __init__(
        self,
        *,
        config: SupervisorConfig,
        process_lister: ProcessLister,
        mt5_factory: Callable[[], Mt5ConnectPort],
        spawn: Callable[[Path], ProcessHandle] = default_spawn,
        job_object_factory: Callable[[], JobObjectLike] | None = WindowsJobObject,
        clock: Callable[[], float] = time.monotonic,
        now_s: Callable[[], float] = time.time,
        now_utc: Callable[[], str] = _now_utc,
        sleep: Callable[[float], None] | None = None,
        log: Callable[[str], None] = lambda message: print(message, file=sys.stderr),  # noqa: T201
    ) -> None:
        self._config = config
        self._process_lister = process_lister
        self._mt5_factory = mt5_factory
        self._spawn = spawn
        self._job_object_factory = job_object_factory
        self._job_objects_disabled_off_windows = False
        self._clock = clock
        self._now_s = now_s
        self._now_utc = now_utc
        self._log = log
        self._instance_id = str(uuid.uuid4())
        self._health = HealthStore(config.state_dir)
        self._quarantine = QuarantineStore(config.state_dir)
        self._children: dict[str, _Child] = {}
        self._pending: dict[str, _PendingRespawn] = {}
        self._stop_event = threading.Event()
        self._stop_requested = threading.Event()
        self._sleep_wait: Callable[[float], bool] = (
            self._stop_requested.wait if sleep is None else lambda s: (sleep(s), False)[1]
        )

    def request_stop(self) -> None:
        self._stop_requested.set()

    def run(self, *, max_ticks: int | None = None) -> None:
        """Runs the tick loop until `request_stop()` is called or
        `max_ticks` is reached. Deliberately does NOT shut down tracked
        children on return -- `max_ticks` exists so a test can bound the
        loop and then inspect supervisor state (including still-tracked
        children) without every bounded run wiping it. Shutdown is the
        caller's explicit responsibility (`bridge/__main__.py` calls
        `shutdown()` after `run()` returns following a real stop signal)."""
        last_discovery_at: float | None = None
        ticks = 0
        while not self._stop_requested.is_set():
            if (
                last_discovery_at is None
                or self._clock() - last_discovery_at >= self._config.discovery_rescan_s
            ):
                self._rescan_and_spawn()
                last_discovery_at = self._clock()
            self._reap_exited_children()
            self._dispatch_due_respawns()
            ticks += 1
            if max_ticks is not None and ticks >= max_ticks:
                break
            self._sleep_wait(self._config.tick_interval_s)

    # -- discovery / spawn ---------------------------------------------

    def _rescan_and_spawn(self) -> None:
        result: ResolvedAccounts = resolve_accounts(
            process_lister=self._process_lister,
            mt5_factory=self._mt5_factory,
            overrides_dir=self._config.overrides_dir,
            generated_dir=self._config.generated_dir,
            now_s=self._now_s(),
            max_history_skew_s=self._config.max_history_skew_s,
            state_dir_windows=self._config.state_dir_windows,
        )
        for warning in result.warnings:
            self._log(f"[supervisor] discovery: {warning}")
        for error in result.errors:
            self._log(f"[supervisor] account config invalid: {error}")

        for account_config in result.configs:
            profile_id = account_config.profile.profile_id
            login = account_config.profile.expected_login
            if profile_id in self._children or profile_id in self._pending:
                continue
            if self._quarantine.is_quarantined(profile_id):
                continue
            config_path = self._config_path_for(login)
            self._spawn_account(profile_id=profile_id, login=login, config_path=config_path)

    def _config_path_for(self, login: int) -> Path:
        override_path = self._config.overrides_dir / f"{login}.json"
        if override_path.exists():
            return override_path
        return self._config.generated_dir / f"{login}.json"

    def _spawn_account(self, *, profile_id: str, login: int, config_path: Path) -> None:
        handle = self._spawn(config_path)
        job_object = self._assign_job_object(handle.pid)
        self._children[profile_id] = _Child(
            profile_id=profile_id,
            login=login,
            config_path=config_path,
            handle=handle,
            job_object=job_object,
            started_at_s=self._clock(),
        )
        self._pending.pop(profile_id, None)
        restart_count, window_start_utc = self._health.get_restart_state(profile_id)
        self._health.record_transition(
            profile_id=profile_id,
            login=login,
            supervisor_instance_id=self._instance_id,
            state="running",
            last_transition_reason="startup",
            last_transition_at_utc=self._now_utc(),
            restart_count=restart_count,
            restart_count_window_start_utc=window_start_utc or self._now_utc(),
        )

    def _assign_job_object(self, pid: int) -> JobObjectLike | None:
        if self._job_object_factory is None or self._job_objects_disabled_off_windows:
            return None
        try:
            job_object = self._job_object_factory()
        except NotImplementedError:
            if sys.platform == "win32":
                raise  # real failure on the platform this design requires it on
            # Off-Windows (local dev/test only): disable for the rest of
            # this run rather than fail every spawn -- never masks a real
            # Windows failure, since the raise above already covers win32.
            self._job_objects_disabled_off_windows = True
            self._log("[supervisor] Job Objects unavailable off-Windows, disabled for this run")
            return None
        job_object.assign_process(pid)
        return job_object

    # -- exit handling ----------------------------------------------------

    def _reap_exited_children(self) -> None:
        for profile_id, child in list(self._children.items()):
            code = child.handle.poll()
            if code is None:
                continue
            del self._children[profile_id]
            if child.job_object is not None:
                child.job_object.close()
            self._handle_exit(child, code)

    def _handle_exit(self, child: _Child, code: int) -> None:
        classification = classify_raw_exit_code(code)
        restart_count, window_start_utc = self._health.get_restart_state(child.profile_id)
        window_start_s = self._parse_utc_s(window_start_utc) if window_start_utc else self._now_s()
        uptime_s = max(self._clock() - child.started_at_s, 0.0)
        restart_count, window_start_s = apply_stable_runtime_reset(
            restart_count=restart_count,
            window_start_s=window_start_s,
            uptime_s=uptime_s,
            now_s=self._now_s(),
            config=self._config.backoff,
        )
        decision = decide(
            classification,
            restart_count=restart_count,
            window_start_s=window_start_s,
            now_s=self._now_s(),
            config=self._config.backoff,
        )

        if decision.should_quarantine:
            self._quarantine.quarantine(
                profile_id=child.profile_id,
                login=child.login,
                reason=classification.value,
                triggering_exit_code=code,
                restart_count_at_quarantine=decision.next_restart_count,
            )
            state = "quarantined"
        elif classification is Classification.DUPLICATE_OWNERSHIP:
            state = "standby_duplicate"
        elif decision.kind is PolicyKind.NO_RESTART_REMOVE:
            state = "stopped"
        else:
            state = "starting"

        self._health.record_transition(
            profile_id=child.profile_id,
            login=child.login,
            supervisor_instance_id=self._instance_id,
            state=state,
            last_transition_reason=classification.value,
            last_transition_at_utc=self._now_utc(),
            restart_count=decision.next_restart_count,
            restart_count_window_start_utc=self._iso_from_s(window_start_s),
        )

        if decision.should_quarantine or decision.kind is PolicyKind.NO_RESTART_REMOVE:
            return
        self._pending[child.profile_id] = _PendingRespawn(
            login=child.login,
            config_path=child.config_path,
            due_at_s=self._clock() + decision.delay_ms / 1000,
        )

    def _dispatch_due_respawns(self) -> None:
        now = self._clock()
        for profile_id, pending in list(self._pending.items()):
            if pending.due_at_s > now:
                continue
            if self._quarantine.is_quarantined(profile_id):
                del self._pending[profile_id]
                continue
            del self._pending[profile_id]
            self._spawn_account(
                profile_id=profile_id, login=pending.login, config_path=pending.config_path
            )

    @staticmethod
    def _parse_utc_s(value: str) -> float:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC).timestamp()

    def _iso_from_s(self, value: float) -> str:
        del self
        return datetime.fromtimestamp(value, tz=UTC).isoformat().replace("+00:00", "Z")

    # -- shutdown -----------------------------------------------------------

    def shutdown(self) -> None:
        """§2's CTRL_BREAK -> terminate -> kill -> Job-Object-close ladder,
        applied to every still-tracked child. CTRL_BREAK delivery is
        best-effort and commonly a no-op under NSSM/Session 0 (§2) -- the
        deterministic contract is the fallback steps, not this first one.
        """
        children = list(self._children.values())
        self._children.clear()
        for child in children:
            child.handle.send_ctrl_break()
        if not children:
            return
        self._wait_or_escalate(children, self._config.ctrl_break_wait_s, escalate="terminate")
        still_alive = [child for child in children if child.handle.poll() is None]
        if still_alive:
            self._wait_or_escalate(still_alive, self._config.shutdown_grace_s, escalate="kill")
        still_alive = [child for child in still_alive if child.handle.poll() is None]
        if still_alive:
            self._wait_or_escalate(still_alive, self._config.shutdown_kill_grace_s, escalate=None)
        for child in children:
            if child.job_object is not None:
                child.job_object.close()  # unconditional backstop (§2 step 4)

    def _wait_or_escalate(
        self, children: list[_Child], wait_s: float, *, escalate: str | None
    ) -> None:
        self._sleep_wait(wait_s)
        for child in children:
            if child.handle.poll() is not None:
                continue
            if escalate == "terminate":
                child.handle.terminate()
            elif escalate == "kill":
                child.handle.kill()
