from __future__ import annotations

from collections import namedtuple

import pytest

from bridge.config import TerminalProfile
from bridge.process_probe import ProcessFingerprint
from bridge.terminal_session import (
    TerminalIdentityViolation,
    TerminalNotReadyError,
    TerminalSession,
)

Terminal = namedtuple("Terminal", "path data_path connected")
Account = namedtuple("Account", "login server balance")


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


def fingerprint(*, pid: int = 10, created: float = 100.0) -> ProcessFingerprint:
    return ProcessFingerprint(
        pid=pid,
        creation_time=created,
        executable_path=r"C:\MT5-A\terminal64.exe",
        command_line=(r"C:\MT5-A\terminal64.exe", "/portable"),
        process_user="bridge-user",
        session_id=1,
        data_path=r"C:\MT5-A",
    )


class Probe:
    def __init__(self, results: list[object]) -> None:
        self.results = iter(results)

    def match(self, target: TerminalProfile) -> ProcessFingerprint:
        result = next(self.results)
        if isinstance(result, BaseException):
            raise result
        assert isinstance(result, ProcessFingerprint)
        return result


class Mt5:
    def __init__(self) -> None:
        self.initialized = True
        self.shutdown_count = 0
        self.initialize_calls: list[tuple[str, int, bool]] = []
        self.terminal = Terminal(r"C:\MT5-A", r"C:\MT5-A", True)
        self.account = Account(10001, "Broker-Demo", 10_000.0)

    def initialize(self, path: str, *, timeout: int, portable: bool) -> bool:
        self.initialize_calls.append((path, timeout, portable))
        return self.initialized

    def shutdown(self) -> None:
        self.shutdown_count += 1

    def version(self) -> tuple[int, int, str]:
        return (500, 5000, "2026-01-01")

    def terminal_info(self) -> Terminal:
        return self.terminal

    def account_info(self) -> Account:
        return self.account

    def positions_get(self) -> tuple[object, ...]:
        return ()

    def orders_get(self) -> tuple[object, ...]:
        return ()

    def history_deals_get(self, start: int, end: int) -> tuple[object, ...]:
        return ()

    def history_orders_get(self, start: int, end: int) -> tuple[object, ...]:
        return ()

    def last_error(self) -> tuple[int, str]:
        return (-1, "failed")


def test_successful_connection_requires_three_identical_process_checks() -> None:
    mt5 = Mt5()
    current = fingerprint()
    session = TerminalSession(Probe([current, current, current]), mt5)

    verified = session.connect_verified(profile())

    assert verified.fingerprint == current
    assert session.terminal_pid == current.pid
    assert mt5.initialize_calls == [(r"C:\MT5-A\terminal64.exe", 15_000, True)]
    assert mt5.shutdown_count == 0


@pytest.mark.parametrize(
    ("changed", "reason"),
    [
        (fingerprint(pid=11), "process identity changed"),
        (fingerprint(created=101.0), "process identity changed"),
    ],
)
def test_process_replacement_after_initialize_disconnects_and_quarantines(
    changed: ProcessFingerprint, reason: str
) -> None:
    mt5 = Mt5()
    current = fingerprint()
    session = TerminalSession(Probe([current, current, changed]), mt5)

    with pytest.raises(TerminalIdentityViolation, match=reason):
        session.connect_verified(profile())

    assert mt5.shutdown_count == 1


def test_account_mismatch_disconnects_and_quarantines() -> None:
    mt5 = Mt5()
    mt5.account = Account(99999, "Broker-Demo", 10_000.0)
    current = fingerprint()

    with pytest.raises(TerminalIdentityViolation, match="account identity"):
        TerminalSession(Probe([current, current, current]), mt5).connect_verified(
            profile()
        )

    assert mt5.shutdown_count == 1


def test_terminal_path_mismatch_disconnects_and_quarantines() -> None:
    mt5 = Mt5()
    mt5.terminal = Terminal(r"C:\Wrong", r"C:\MT5-A", True)
    current = fingerprint()

    with pytest.raises(TerminalIdentityViolation, match="terminal path"):
        TerminalSession(Probe([current, current, current]), mt5).connect_verified(
            profile()
        )

    assert mt5.shutdown_count == 1


def test_failed_initialize_never_reads_or_publishes_identity() -> None:
    mt5 = Mt5()
    mt5.initialized = False
    current = fingerprint()

    # Transient (terminal not ready / broker outage), not a genuine
    # identity mismatch -- must not raise TerminalIdentityViolation, or
    # the restart-count quarantine ceiling could permanently strand an
    # account through an outage. See bridge/exit_codes.py TERMINAL_NOT_READY.
    with pytest.raises(TerminalNotReadyError, match="initialize failed"):
        TerminalSession(Probe([current, current]), mt5).connect_verified(profile())

    assert mt5.shutdown_count == 1


def test_terminal_not_connected_is_transient_not_identity_violation() -> None:
    mt5 = Mt5()
    mt5.terminal = Terminal(r"C:\MT5-A", r"C:\MT5-A", False)
    current = fingerprint()

    with pytest.raises(TerminalNotReadyError, match="not connected"):
        TerminalSession(Probe([current, current, current]), mt5).connect_verified(
            profile()
        )

    assert mt5.shutdown_count == 1


def test_preflight_failure_prevents_initialize() -> None:
    mt5 = Mt5()
    session = TerminalSession(
        Probe([TerminalIdentityViolation("ambiguous process")]), mt5
    )

    with pytest.raises(TerminalIdentityViolation, match="ambiguous process"):
        session.connect_verified(profile())

    assert mt5.initialize_calls == []
    assert mt5.shutdown_count == 0


def test_revalidation_detects_account_change_and_disconnects() -> None:
    mt5 = Mt5()
    current = fingerprint()
    terminal_session = TerminalSession(Probe([current, current, current, current]), mt5)
    verified = terminal_session.connect_verified(profile())
    mt5.account = Account(99999, "Broker-Demo", 10_000.0)

    with pytest.raises(TerminalIdentityViolation, match="account identity"):
        terminal_session.revalidate(verified)

    assert mt5.shutdown_count == 1
