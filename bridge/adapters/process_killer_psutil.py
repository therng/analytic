from __future__ import annotations

from typing import Any, Callable

_CREATE_TIME_TOLERANCE_S = 0.001
_TERMINATION_GRACE_S = 2.0
_FORCED_KILL_GRACE_S = 2.0


def _default_process_factory(pid: int) -> Any:
    import psutil

    return psutil.Process(pid)


class PsutilProcessKiller:
    """Terminates exactly the process a SpawnVerdict identified, and only
    that process: a PID whose creation_time no longer matches the value
    captured at detection time is assumed recycled and is never touched.
    Platform truth: on Windows psutil's terminate() is an alias for
    kill() -- an immediate TerminateProcess with no WM_CLOSE grace stage
    -- so every kill on the production host is forceful; that is the
    accepted policy for a seconds-old SDK duplicate with no unsaved
    state, and the terminate-then-kill escalation below is retained for
    platforms where terminate() is genuinely graceful. psutil is imported
    lazily so non-Windows test environments never need it, matching
    process_probe_psutil's posture."""

    def __init__(
        self,
        *,
        process_factory: Callable[[int], Any] | None = None,
        termination_grace_s: float = _TERMINATION_GRACE_S,
        forced_kill_grace_s: float = _FORCED_KILL_GRACE_S,
    ) -> None:
        self._process_factory = process_factory or _default_process_factory
        self._termination_grace_s = termination_grace_s
        self._forced_kill_grace_s = forced_kill_grace_s

    def kill(self, pid: int, creation_time: float) -> str:
        """Best-effort termination, always returning a short human-readable
        outcome for the discovery warning line -- never raises, because the
        warning that reports the spawn must not be masked by the kill
        that answers it."""
        try:
            process = self._process_factory(pid)
            observed_creation_time = process.create_time()
        except Exception:  # noqa: BLE001 - NoSuchProcess/AccessDenied both mean "cannot act"
            return "already exited before kill"

        if abs(observed_creation_time - creation_time) > _CREATE_TIME_TOLERANCE_S:
            return "pid recycled, refused to kill"

        try:
            process.terminate()
        except Exception:  # noqa: BLE001 - terminal refused the graceful close
            return "terminate failed"

        if self._await_exit(process, self._termination_grace_s):
            return "terminated"

        try:
            process.kill()
        except Exception:  # noqa: BLE001 - escalation itself failed
            return "kill escalation failed"

        if self._await_exit(process, self._forced_kill_grace_s):
            return "force-killed"
        return "survived kill escalation"

    def _await_exit(self, process: Any, grace_s: float) -> bool:
        try:
            process.wait(timeout=grace_s)
            return True
        except Exception:  # noqa: BLE001 - TimeoutExpired means still alive, anything else is inert
            return False
