from __future__ import annotations

from enum import IntEnum, StrEnum


class WorkerExitCode(IntEnum):
    """Layer 1 — codes the worker process itself chooses via sys.exit().

    Only reachable while the worker's own Python code is still running to
    choose one; a forcibly terminated child never reaches this layer at all
    (see ForcedTermination).
    """

    CLEAN_SHUTDOWN = 0
    CONFIG_INVALID = 10
    DUPLICATE_OWNERSHIP = 11
    IDENTITY_VIOLATION = 12
    LEASE_LOST = 13
    MT5_IPC_FAILURE = 14
    JOURNAL_FAILURE = 15
    UNEXPECTED_FATAL = 20


class ForcedTermination(StrEnum):
    """Layer 2 — how the supervisor observed a child ending when *it* ended
    the child via the shutdown/unresponsive-child ladder, rather than the
    child choosing its own exit. No WorkerExitCode is observable in either
    case: the worker's own code never ran a sys.exit call.
    """

    FORCED_TERMINATE = "forced_terminate"
    FORCED_JOB_KILL = "forced_job_kill"


class Classification(StrEnum):
    """Layer 3 — what the supervisor actually records as
    last_transition_reason / quarantine_reason. Every WorkerExitCode maps to
    exactly one classification of the same shape; both ForcedTermination
    values collapse into the single `forced_termination` classification,
    since the supervisor cannot know which Layer-1 reason a forcibly
    terminated child "would have" reported.
    """

    CLEAN_SHUTDOWN = "clean_shutdown"
    CONFIG_INVALID = "config_invalid"
    DUPLICATE_OWNERSHIP = "duplicate_ownership"
    IDENTITY_VIOLATION = "identity_violation"
    LEASE_LOST = "lease_lost"
    MT5_IPC_FAILURE = "mt5_ipc_failure"
    JOURNAL_FAILURE = "journal_failure"
    UNEXPECTED_FATAL = "unexpected_fatal"
    FORCED_TERMINATION = "forced_termination"


_EXIT_CODE_TO_CLASSIFICATION: dict[WorkerExitCode, Classification] = {
    WorkerExitCode.CLEAN_SHUTDOWN: Classification.CLEAN_SHUTDOWN,
    WorkerExitCode.CONFIG_INVALID: Classification.CONFIG_INVALID,
    WorkerExitCode.DUPLICATE_OWNERSHIP: Classification.DUPLICATE_OWNERSHIP,
    WorkerExitCode.IDENTITY_VIOLATION: Classification.IDENTITY_VIOLATION,
    WorkerExitCode.LEASE_LOST: Classification.LEASE_LOST,
    WorkerExitCode.MT5_IPC_FAILURE: Classification.MT5_IPC_FAILURE,
    WorkerExitCode.JOURNAL_FAILURE: Classification.JOURNAL_FAILURE,
    WorkerExitCode.UNEXPECTED_FATAL: Classification.UNEXPECTED_FATAL,
}

_FORCED_TERMINATION_TO_CLASSIFICATION: dict[ForcedTermination, Classification] = {
    ForcedTermination.FORCED_TERMINATE: Classification.FORCED_TERMINATION,
    ForcedTermination.FORCED_JOB_KILL: Classification.FORCED_TERMINATION,
}


def classify_exit_code(code: WorkerExitCode) -> Classification:
    return _EXIT_CODE_TO_CLASSIFICATION[code]


def classify_forced_termination(outcome: ForcedTermination) -> Classification:
    return _FORCED_TERMINATION_TO_CLASSIFICATION[outcome]


def classify_raw_exit_code(raw_code: int) -> Classification:
    """Classify an OS-observed exit code that may or may not be one of the
    worker's own WorkerExitCode values (a raw code outside that set — e.g.
    from a Python-level unhandled crash before exit_codes.py's own exit path
    ran — is treated as UNEXPECTED_FATAL, never silently coerced into a
    named code it doesn't actually match)."""
    try:
        return _EXIT_CODE_TO_CLASSIFICATION[WorkerExitCode(raw_code)]
    except ValueError:
        return Classification.UNEXPECTED_FATAL


class PolicyKind(StrEnum):
    NO_RESTART_REMOVE = "no_restart_remove"
    QUARANTINE_IMMEDIATE = "quarantine_immediate"
    FIXED_DELAY_RESTART = "fixed_delay_restart"
    BACKOFF_RESTART = "backoff_restart"


class RestartPolicy:
    __slots__ = ("kind", "alert_on_first_occurrence")

    def __init__(self, kind: PolicyKind, *, alert_on_first_occurrence: bool) -> None:
        self.kind = kind
        self.alert_on_first_occurrence = alert_on_first_occurrence


# Layer 4 — restart-policy mapping, keyed by Layer-3 classification.
RESTART_POLICY: dict[Classification, RestartPolicy] = {
    Classification.CLEAN_SHUTDOWN: RestartPolicy(
        PolicyKind.NO_RESTART_REMOVE, alert_on_first_occurrence=False
    ),
    Classification.CONFIG_INVALID: RestartPolicy(
        PolicyKind.QUARANTINE_IMMEDIATE, alert_on_first_occurrence=True
    ),
    Classification.DUPLICATE_OWNERSHIP: RestartPolicy(
        PolicyKind.FIXED_DELAY_RESTART, alert_on_first_occurrence=False
    ),
    Classification.IDENTITY_VIOLATION: RestartPolicy(
        PolicyKind.BACKOFF_RESTART, alert_on_first_occurrence=False
    ),
    Classification.LEASE_LOST: RestartPolicy(
        PolicyKind.BACKOFF_RESTART, alert_on_first_occurrence=False
    ),
    Classification.MT5_IPC_FAILURE: RestartPolicy(
        PolicyKind.BACKOFF_RESTART, alert_on_first_occurrence=False
    ),
    Classification.JOURNAL_FAILURE: RestartPolicy(
        PolicyKind.QUARANTINE_IMMEDIATE, alert_on_first_occurrence=True
    ),
    Classification.UNEXPECTED_FATAL: RestartPolicy(
        PolicyKind.BACKOFF_RESTART, alert_on_first_occurrence=True
    ),
    Classification.FORCED_TERMINATION: RestartPolicy(
        PolicyKind.BACKOFF_RESTART, alert_on_first_occurrence=True
    ),
}


def restart_policy_for(classification: Classification) -> RestartPolicy:
    return RESTART_POLICY[classification]
