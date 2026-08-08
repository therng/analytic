from __future__ import annotations

from dataclasses import dataclass
from pathlib import PureWindowsPath
from typing import Any

from bridge.config import TerminalProfile
from bridge.models import CallState
from bridge.mt5_adapter import StrictMt5Adapter
from bridge.process_probe import ProcessFingerprint


class TerminalIdentityViolation(RuntimeError):
    """A genuine identity mismatch: the terminal process/account we are
    talking to is provably not the one this profile is configured for
    (wrong path, wrong data path, wrong login/server, or the OS process
    identity changed under us). Always permanent -- must never be retried
    into silently, and is the only case the restart-count ceiling in
    bridge/restart_policy.py quarantines an account for."""


class TerminalNotReadyError(RuntimeError):
    """The terminal/API is not yet in a state we can verify identity
    against -- initialize() failed, terminal.connected is False, or a
    post-connect API read failed -- during broker/terminal startup or a
    connectivity outage. Transient by nature: retried with backoff like
    bridge.mt5_adapter's MT5 IPC failures, never counted toward the
    identity-violation quarantine ceiling. See bridge/worker.py's
    WorkerExitCode.TERMINAL_NOT_READY handling."""


def _windows_key(value: object) -> str:
    return str(PureWindowsPath(str(value))).casefold()


@dataclass(frozen=True)
class VerifiedSession:
    profile: TerminalProfile
    fingerprint: ProcessFingerprint
    adapter: StrictMt5Adapter


class TerminalSession:
    def __init__(self, probe: Any, mt5: Any) -> None:
        self._probe = probe
        self._mt5 = mt5
        self._adapter = StrictMt5Adapter(mt5)
        self._terminal_pid: int | None = None

    @property
    def terminal_pid(self) -> int | None:
        return self._terminal_pid

    def connect_verified(self, profile: TerminalProfile) -> VerifiedSession:
        first = self._probe.match(profile)
        self._terminal_pid = first.pid
        second = self._probe.match(profile)
        if first != second:
            raise TerminalIdentityViolation(
                "process identity changed before initialize"
            )

        try:
            initialized = self._mt5.initialize(
                profile.executable_path,
                timeout=profile.initialize_timeout_ms,
                portable=profile.portable,
            )
            if not initialized:
                raise TerminalNotReadyError("initialize failed")
            self._verify_api_identity(profile)
            third = self._probe.match(profile)
            if third != first:
                raise TerminalIdentityViolation(
                    "process identity changed after initialize"
                )
            return VerifiedSession(
                profile=profile,
                fingerprint=third,
                adapter=self._adapter,
            )
        except Exception:
            self._mt5.shutdown()
            raise

    def revalidate(self, verified: VerifiedSession) -> None:
        try:
            current = self._probe.match(verified.profile)
            if current != verified.fingerprint:
                raise TerminalIdentityViolation("process identity changed")
            self._verify_api_identity(verified.profile)
        except Exception:
            self._mt5.shutdown()
            raise

    def _verify_api_identity(self, profile: TerminalProfile) -> None:
        version = self._adapter.version()
        terminal = self._adapter.terminal()
        account = self._adapter.account()
        if (
            version.state is CallState.FAILED
            or terminal.state is CallState.FAILED
            or account.state is CallState.FAILED
        ):
            raise TerminalNotReadyError("post-connect identity read failed")

        terminal_value = terminal.value
        account_value = account.value
        if not isinstance(terminal_value, dict) or not isinstance(account_value, dict):
            raise TerminalIdentityViolation("post-connect identity shape invalid")
        expected_terminal_path = str(PureWindowsPath(profile.executable_path).parent)
        if _windows_key(terminal_value.get("path")) != _windows_key(
            expected_terminal_path
        ):
            raise TerminalIdentityViolation("terminal path mismatch")
        if _windows_key(terminal_value.get("data_path")) != _windows_key(
            profile.expected_data_path
        ):
            raise TerminalIdentityViolation("terminal data path mismatch")
        if terminal_value.get("connected") is not True:
            raise TerminalNotReadyError("terminal is not connected")
        if (
            account_value.get("login") != profile.expected_login
            or account_value.get("server") != profile.expected_server
        ):
            raise TerminalIdentityViolation("account identity mismatch")
