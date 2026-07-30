from __future__ import annotations

import pytest

from bridge.config import TerminalProfile
from bridge.process_probe import (
    ProcessCandidate,
    ProcessFingerprint,
    ProcessProbeError,
    select_process,
)


def profile() -> TerminalProfile:
    return TerminalProfile(
        executable_path=r"C:\MT5-A\terminal64.exe",
        portable=True,
        expected_data_path=r"C:\MT5-A",
        expected_login=10001,
        expected_server="Broker-Demo",
        initialize_timeout_ms=15_000,
        coordination_domain="test",
        history_lower_bound_raw=100,
    )


def candidate(**overrides: object) -> ProcessCandidate:
    values: dict[str, object] = {
        "pid": 10,
        "creation_time": 100.0,
        "executable_path": r"C:\MT5-A\terminal64.exe",
        "command_line": (r"C:\MT5-A\terminal64.exe", "/portable"),
        "process_user": "bridge-user",
        "session_id": 1,
        "data_path": r"C:\MT5-A",
        "evidence_complete": True,
    }
    values.update(overrides)
    return ProcessCandidate(**values)  # type: ignore[arg-type]


def test_exact_process_match_returns_immutable_fingerprint() -> None:
    result = select_process(profile(), [candidate()])

    assert result == ProcessFingerprint(
        pid=10,
        creation_time=100.0,
        executable_path=r"C:\MT5-A\terminal64.exe",
        command_line=(r"C:\MT5-A\terminal64.exe", "/portable"),
        process_user="bridge-user",
        session_id=1,
        data_path=r"C:\MT5-A",
    )


@pytest.mark.parametrize(
    "candidates",
    [
        [],
        [candidate(), candidate(pid=11)],
        [candidate(evidence_complete=False)],
        [candidate(command_line=(r"C:\MT5-A\terminal64.exe",))],
        [candidate(data_path=r"C:\Other")],
    ],
)
def test_incomplete_ambiguous_or_inconsistent_process_is_rejected(
    candidates: list[ProcessCandidate],
) -> None:
    with pytest.raises(ProcessProbeError):
        select_process(profile(), candidates)
