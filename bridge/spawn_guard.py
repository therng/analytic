from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from bridge.process_probe import ProcessCandidate, _windows_key

# Warning slugs embedded in discovery warnings -- `unexpected_terminal_launch`
# matches bridge/errors.py's FailureClass.UNEXPECTED_TERMINAL_LAUNCH so one
# grep finds every surface that names this condition.
UNEXPECTED_LAUNCH_SLUG = "unexpected_terminal_launch"
PROCESS_REPLACED_SLUG = "terminal_process_replaced"
PROCESS_EXITED_SLUG = "terminal_process_exited_during_initialize"


class ProcessKiller(Protocol):
    def kill(self, pid: int, creation_time: float) -> str: ...


def candidates_at_path(
    executable_path: str, candidates: list[ProcessCandidate]
) -> list[ProcessCandidate]:
    """Every candidate whose executable path matches `executable_path`
    under the same case-insensitive Windows-key normalization select_process
    applies -- a before/after pair of these lists around one
    mt5.initialize() call is exactly the evidence the spawn guard
    classifies."""
    key = _windows_key(executable_path)
    return [
        candidate
        for candidate in candidates
        if _windows_key(candidate.executable_path) == key
    ]


@dataclass(frozen=True)
class SpawnVerdict:
    """How the terminal64.exe process set at one executable path changed
    across an initialize() the bridge performed: `spawned` holds every
    process whose (pid, creation_time) was not present before, and
    `original_gone` says the exact process discovery probed is no longer
    among them (exited, or its PID was reused by a newer process)."""

    spawned: tuple[ProcessCandidate, ...]
    original_gone: bool


@dataclass(frozen=True)
class GuardResponse:
    """The outcome of applying the guard policy: `warning` is None when the
    process set is unchanged and discovery should proceed as before, and
    `kill_targets` holds the exact processes the kill branch tried to
    terminate -- the caller re-watches the process set to verify they
    actually left it (a kill that failed silently must be visible)."""

    warning: str | None
    kill_targets: tuple[ProcessCandidate, ...]


def classify(
    *,
    candidate: ProcessCandidate,
    before: list[ProcessCandidate],
    after: list[ProcessCandidate],
) -> SpawnVerdict:
    before_ids = {(c.pid, c.creation_time) for c in before}
    after_ids = {(c.pid, c.creation_time) for c in after}
    spawned = tuple(
        c for c in after if (c.pid, c.creation_time) not in before_ids
    )
    original_gone = (candidate.pid, candidate.creation_time) not in after_ids
    return SpawnVerdict(spawned=spawned, original_gone=original_gone)


def respond(
    *,
    label: str,
    verdict: SpawnVerdict,
    killer: ProcessKiller,
) -> GuardResponse:
    """Apply the guard policy to a verdict.

    The policy mirrors the operator decision recorded with this guard:

    - New process(es) while the probed terminal still runs -- the
      MetaTrader5 package launched a duplicate from initialize() (elevated
      whenever the bridge task itself is elevated). Kill every spawned
      PID; the Startup-folder .lnk terminal we probed is the legitimate
      one and stays untouched.
    - New process(es) but the probed one is gone -- the terminal was
      replaced underneath initialize(), the signature of an MT5 liveupdate
      relaunch or crash-restart (both observed on the forexvps host).
      Never kill: the replacement is the legitimate terminal. Skip; the
      next discovery rescan attaches to it fresh.
    - Probed process gone, nothing new -- the terminal exited mid-
      initialize. Skip until the next rescan; no kill either way.
    """
    if verdict.spawned and not verdict.original_gone:
        outcomes = [
            f"pid={process.pid}: {killer.kill(process.pid, process.creation_time)}"
            for process in verdict.spawned
        ]
        return GuardResponse(
            warning=(
                f"{label}: {UNEXPECTED_LAUNCH_SLUG}: {len(verdict.spawned)} new "
                f"process(es) appeared at the path while the probed terminal "
                f"still runs; killed [{'; '.join(outcomes)}]"
            ),
            kill_targets=verdict.spawned,
        )
    if verdict.spawned and verdict.original_gone:
        new_pids = ", ".join(str(process.pid) for process in verdict.spawned)
        return GuardResponse(
            warning=(
                f"{label}: {PROCESS_REPLACED_SLUG}: probed process gone, new at "
                f"path: {new_pids}; skipped until next rescan, not killed "
                f"(liveupdate/crash-restart replacement is the legitimate terminal)"
            ),
            kill_targets=(),
        )
    if verdict.original_gone:
        return GuardResponse(
            warning=(
                f"{label}: {PROCESS_EXITED_SLUG}: probed process gone before "
                f"identity could be read; skipped until next rescan"
            ),
            kill_targets=(),
        )
    return GuardResponse(warning=None, kill_targets=())
