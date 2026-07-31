from __future__ import annotations

from collections import namedtuple

from bridge.discovery import discover_accounts
from bridge.process_probe import ProcessCandidate

TerminalInfo = namedtuple("TerminalInfo", ["data_path", "connected"])
AccountInfo = namedtuple("AccountInfo", ["login", "server"])


def candidate(
    pid: int,
    *,
    executable_path: str = "C:\\MT5\\terminal64.exe",
    portable: bool = True,
    evidence_complete: bool = True,
) -> ProcessCandidate:
    return ProcessCandidate(
        pid=pid,
        creation_time=1000.0,
        executable_path=executable_path,
        command_line=(executable_path, "/portable") if portable else (executable_path,),
        process_user="svc",
        session_id=0,
        data_path="C:\\MT5\\data" if evidence_complete else "",
        evidence_complete=evidence_complete,
    )


class FakeProcessLister:
    def __init__(self, candidates: list[ProcessCandidate]) -> None:
        self._candidates = candidates

    def build_candidates(self) -> list[ProcessCandidate]:
        return self._candidates


class FakeMt5:
    def __init__(
        self,
        *,
        initialize_ok: bool = True,
        connected: bool = True,
        login: int = 30001,
        server: str = "Broker-Demo",
        data_path: str = "C:\\MT5\\data",
        raise_on_initialize: bool = False,
    ) -> None:
        self._initialize_ok = initialize_ok
        self._connected = connected
        self._login = login
        self._server = server
        self._data_path = data_path
        self._raise_on_initialize = raise_on_initialize
        self.initialize_calls: list[tuple[str, int, bool]] = []
        self.shutdown_called = False

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        self.initialize_calls.append((path, timeout, portable))
        if self._raise_on_initialize:
            raise RuntimeError("IPC failure")
        return self._initialize_ok

    def shutdown(self) -> None:
        self.shutdown_called = True

    def terminal_info(self) -> TerminalInfo:
        return TerminalInfo(data_path=self._data_path, connected=self._connected)

    def account_info(self) -> AccountInfo:
        return AccountInfo(login=self._login, server=self._server)


def test_discovers_single_portable_terminal() -> None:
    fake = FakeMt5(login=30001, server="Broker-Demo", data_path="C:\\MT5\\data")
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert warnings == ()
    assert len(discovered) == 1
    account = discovered[0]
    assert account.source_pid == 1
    assert account.profile.expected_login == 30001
    assert account.profile.expected_server == "Broker-Demo"
    assert account.profile.expected_data_path == "C:\\MT5\\data"
    assert account.profile.executable_path == "C:\\MT5\\terminal64.exe"
    assert account.profile.portable is True
    assert fake.initialize_calls == [("C:\\MT5\\terminal64.exe", 10_000, True)]
    assert fake.shutdown_called is True  # never left attached after discovery


def test_never_calls_initialize_for_non_portable_terminal() -> None:
    fake = FakeMt5()
    lister = FakeProcessLister([candidate(1, portable=False)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert fake.initialize_calls == []  # no window ever opened for a skipped candidate
    assert "portable" in warnings[0]


def test_skips_candidate_with_incomplete_evidence_without_connecting() -> None:
    fake = FakeMt5()
    lister = FakeProcessLister([candidate(1, evidence_complete=False)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert fake.initialize_calls == []
    assert "incomplete" in warnings[0]


def test_initialize_failure_skips_candidate_and_still_shuts_down() -> None:
    fake = FakeMt5(initialize_ok=False)
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert "initialize failed" in warnings[0]
    assert fake.shutdown_called is True


def test_initialize_exception_is_isolated_and_still_shuts_down() -> None:
    fake = FakeMt5(raise_on_initialize=True)
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert "RuntimeError" in warnings[0]
    assert fake.shutdown_called is True


def test_disconnected_terminal_is_skipped() -> None:
    fake = FakeMt5(connected=False)
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert "not connected" in warnings[0]


def test_two_processes_same_login_deduplicate_to_one_account() -> None:
    calls = {"count": 0}

    def factory() -> FakeMt5:
        calls["count"] += 1
        return FakeMt5(login=30001, server="Broker-Demo")

    lister = FakeProcessLister(
        [
            candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
            candidate(2, executable_path="C:\\MT5-B\\terminal64.exe"),
        ]
    )

    discovered, warnings = discover_accounts(process_lister=lister, mt5_factory=factory)

    assert len(discovered) == 1  # one bridge process per unique account, not per terminal
    assert calls["count"] == 2  # both were connected-to before the duplicate was detected
    assert any("already discovered" in warning for warning in warnings)


def test_duplicate_executable_path_candidates_connect_only_once() -> None:
    calls = {"count": 0}

    def factory() -> FakeMt5:
        calls["count"] += 1
        return FakeMt5()

    lister = FakeProcessLister([candidate(1), candidate(1)])  # same path, seen twice

    discover_accounts(process_lister=lister, mt5_factory=factory)

    assert calls["count"] == 1
