from __future__ import annotations

import sys
from pathlib import PureWindowsPath
from typing import Any, Callable, Iterable, Protocol

from bridge.config import TerminalProfile
from bridge.process_probe import ProcessCandidate, ProcessFingerprint, select_process
from bridge.process_probe import _portable_mode  # reuse the one true detector

ProcessInfo = dict[str, Any]


class ProcessEnumerator(Protocol):
    def __call__(self, attrs: list[str]) -> Iterable[Any]: ...


SessionIdResolver = Callable[[int], int]


def _default_process_iter(attrs: list[str]) -> Iterable[Any]:
    import psutil

    return psutil.process_iter(attrs=attrs)


def _default_session_id_resolver(pid: int) -> int:
    """Windows Terminal Services session ID for `pid`. NOT available from
    psutil.Process at all -- psutil exposes no session_id attribute. Must
    come from a raw ProcessIdToSessionId Win32 call, same ctypes-FFI style
    already used by bridge/journal/connection.py's _NativeWindowsSecurity
    for ACL checks."""
    if sys.platform != "win32":
        raise NotImplementedError(
            "session_id resolution requires ProcessIdToSessionId, Windows only"
        )
    import ctypes

    session_id = ctypes.c_ulong()
    ok = ctypes.windll.kernel32.ProcessIdToSessionId(  # type: ignore[attr-defined]
        ctypes.c_ulong(pid), ctypes.byref(session_id)
    )
    if not ok:
        raise OSError(ctypes.get_last_error(), "ProcessIdToSessionId failed")
    return session_id.value


def _derive_portable_data_path(executable_path: str, command_line: tuple[str, ...]) -> str:
    """Best-effort preflight data_path: MT5's real data folder is only
    knowable at connect time from terminal_info().data_path (an MT5 API
    field, not an OS-level process property) -- RealProcessProbe cannot
    populate an authoritative value here. Under the portable-mode
    convention (data path == the terminal's own install directory when
    /portable is present in argv), the install directory is a reasonable
    preflight estimate; the authoritative check remains
    TerminalSession._verify_api_identity's post-connect comparison against
    terminal_info().data_path."""
    if _portable_mode(command_line):
        return str(PureWindowsPath(executable_path).parent)
    return ""


class RealProcessProbe:
    """Enumerates terminal64.exe processes via psutil and resolves exactly
    one verified candidate against a TerminalProfile using the existing,
    already-tested select_process(). Both psutil enumeration and Windows
    session-ID resolution are injectable so this class's candidate-building
    logic is unit-testable on any platform; only the *default* resolvers
    require a real Windows host.
    """

    def __init__(
        self,
        *,
        process_iter: ProcessEnumerator | None = None,
        session_id_resolver: SessionIdResolver | None = None,
    ) -> None:
        self._process_iter = process_iter or _default_process_iter
        self._session_id_resolver = session_id_resolver or _default_session_id_resolver

    def match(self, profile: TerminalProfile) -> ProcessFingerprint:
        candidates = self.build_candidates()
        return select_process(profile, candidates)

    def build_candidates(self) -> list[ProcessCandidate]:
        candidates: list[ProcessCandidate] = []
        for proc in self._process_iter(
            attrs=["pid", "name", "exe", "cmdline", "create_time", "username"]
        ):
            info: ProcessInfo = getattr(proc, "info", proc)
            name = info.get("name") or ""
            if name.casefold() != "terminal64.exe":
                continue
            candidates.append(self._candidate_from_info(info))
        return candidates

    def _candidate_from_info(self, info: ProcessInfo) -> ProcessCandidate:
        pid = info.get("pid") or 0
        creation_time = info.get("create_time") or 0.0
        executable_path = info.get("exe")
        command_line = tuple(info.get("cmdline") or ())
        process_user = info.get("username")

        if not executable_path or not process_user:
            return ProcessCandidate(
                pid=pid,
                creation_time=creation_time,
                executable_path=executable_path or "",
                command_line=command_line,
                process_user=process_user or "",
                session_id=-1,
                data_path="",
                evidence_complete=False,
            )

        try:
            session_id = self._session_id_resolver(pid)
        except (OSError, NotImplementedError):
            return ProcessCandidate(
                pid=pid,
                creation_time=creation_time,
                executable_path=executable_path,
                command_line=command_line,
                process_user=process_user,
                session_id=-1,
                data_path="",
                evidence_complete=False,
            )

        data_path = _derive_portable_data_path(executable_path, command_line)
        return ProcessCandidate(
            pid=pid,
            creation_time=creation_time,
            executable_path=executable_path,
            command_line=command_line,
            process_user=process_user,
            session_id=session_id,
            data_path=data_path,
            evidence_complete=bool(data_path),
        )
