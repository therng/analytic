from __future__ import annotations

from dataclasses import dataclass
from pathlib import PureWindowsPath

from mt5_bridge_native.config import TerminalProfile


class ProcessProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProcessCandidate:
    pid: int
    creation_time: float
    executable_path: str
    command_line: tuple[str, ...]
    process_user: str
    session_id: int
    data_path: str
    evidence_complete: bool


@dataclass(frozen=True)
class ProcessFingerprint:
    pid: int
    creation_time: float
    executable_path: str
    command_line: tuple[str, ...]
    process_user: str
    session_id: int
    data_path: str


def _windows_key(value: str) -> str:
    return str(PureWindowsPath(value)).casefold()


def _portable_mode(command_line: tuple[str, ...]) -> bool:
    return any(
        argument.casefold() in {"/portable", "-portable"} for argument in command_line
    )


def select_process(
    profile: TerminalProfile,
    candidates: list[ProcessCandidate],
) -> ProcessFingerprint:
    executable_key = _windows_key(profile.executable_path)
    matches = [
        candidate
        for candidate in candidates
        if _windows_key(candidate.executable_path) == executable_key
    ]
    if len(matches) != 1:
        raise ProcessProbeError(
            f"expected exactly one terminal process, found {len(matches)}"
        )
    candidate = matches[0]
    if not candidate.evidence_complete:
        raise ProcessProbeError("terminal process evidence is incomplete")
    if _portable_mode(candidate.command_line) is not profile.portable:
        raise ProcessProbeError("terminal portable mode is inconsistent")
    if _windows_key(candidate.data_path) != _windows_key(profile.expected_data_path):
        raise ProcessProbeError("terminal data path is inconsistent")
    if candidate.pid <= 0 or candidate.creation_time <= 0:
        raise ProcessProbeError("terminal process identity is invalid")
    return ProcessFingerprint(
        pid=candidate.pid,
        creation_time=candidate.creation_time,
        executable_path=str(PureWindowsPath(candidate.executable_path)),
        command_line=candidate.command_line,
        process_user=candidate.process_user,
        session_id=candidate.session_id,
        data_path=str(PureWindowsPath(candidate.data_path)),
    )
