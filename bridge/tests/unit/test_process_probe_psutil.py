from __future__ import annotations

import pytest

from bridge.adapters.process_probe_psutil import RealProcessProbe
from bridge.config import TerminalProfile
from bridge.process_probe import ProcessProbeError


def _profile(**overrides) -> TerminalProfile:
    defaults = dict(
        executable_path=r"C:\MT5\Alpha\terminal64.exe",
        portable=True,
        expected_data_path=r"C:\MT5\Alpha",
        expected_login=123,
        expected_server="Broker-Live01",
        initialize_timeout_ms=30000,
        coordination_domain="prod",
        history_lower_bound_raw=0,
    )
    defaults.update(overrides)
    return TerminalProfile(**defaults)


class _FakeProc:
    def __init__(self, info: dict) -> None:
        self.info = info


def _fake_process_iter(procs: list[dict]):
    def _iter(attrs: list[str]):
        return [_FakeProc(info) for info in procs]

    return _iter


def _fake_session_resolver(mapping: dict[int, int]):
    def _resolve(pid: int) -> int:
        return mapping[pid]

    return _resolve


def _terminal_proc(pid=100, portable=True, exe=r"C:\MT5\Alpha\terminal64.exe"):
    cmdline = [exe]
    if portable:
        cmdline.append("/portable")
    return {
        "pid": pid,
        "name": "terminal64.exe",
        "exe": exe,
        "cmdline": cmdline,
        "create_time": 1000.0,
        "username": "SVC\\bridge",
    }


def test_ignores_processes_with_other_names():
    probe = RealProcessProbe(
        process_iter=_fake_process_iter(
            [{"pid": 1, "name": "notepad.exe", "exe": r"C:\notepad.exe", "cmdline": [], "create_time": 1.0, "username": "u"}]
        ),
        session_id_resolver=_fake_session_resolver({}),
    )
    assert probe.build_candidates() == []


def test_builds_complete_candidate_for_portable_terminal():
    probe = RealProcessProbe(
        process_iter=_fake_process_iter([_terminal_proc(pid=100)]),
        session_id_resolver=_fake_session_resolver({100: 1}),
    )
    candidates = probe.build_candidates()
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.pid == 100
    assert candidate.session_id == 1
    assert candidate.evidence_complete is True
    assert candidate.data_path == r"C:\MT5\Alpha"


def test_non_portable_terminal_has_empty_data_path_and_incomplete_evidence():
    probe = RealProcessProbe(
        process_iter=_fake_process_iter([_terminal_proc(pid=100, portable=False)]),
        session_id_resolver=_fake_session_resolver({100: 1}),
    )
    candidate = probe.build_candidates()[0]
    assert candidate.data_path == ""
    assert candidate.evidence_complete is False


def test_missing_exe_marks_incomplete():
    proc = _terminal_proc(pid=100)
    proc["exe"] = None
    probe = RealProcessProbe(
        process_iter=_fake_process_iter([proc]),
        session_id_resolver=_fake_session_resolver({100: 1}),
    )
    candidate = probe.build_candidates()[0]
    assert candidate.evidence_complete is False


def test_missing_username_marks_incomplete():
    proc = _terminal_proc(pid=100)
    proc["username"] = None
    probe = RealProcessProbe(
        process_iter=_fake_process_iter([proc]),
        session_id_resolver=_fake_session_resolver({100: 1}),
    )
    candidate = probe.build_candidates()[0]
    assert candidate.evidence_complete is False


def test_session_id_resolution_failure_marks_incomplete_not_raises():
    def _raising_resolver(pid: int) -> int:
        raise OSError("access denied")

    probe = RealProcessProbe(
        process_iter=_fake_process_iter([_terminal_proc(pid=100)]),
        session_id_resolver=_raising_resolver,
    )
    candidate = probe.build_candidates()[0]
    assert candidate.evidence_complete is False
    assert candidate.session_id == -1


def test_match_delegates_to_select_process_and_succeeds_for_one_clean_match():
    profile = _profile()
    probe = RealProcessProbe(
        process_iter=_fake_process_iter([_terminal_proc(pid=100)]),
        session_id_resolver=_fake_session_resolver({100: 5}),
    )
    fingerprint = probe.match(profile)
    assert fingerprint.pid == 100
    assert fingerprint.session_id == 5


def test_match_raises_when_no_candidate_matches():
    profile = _profile()
    probe = RealProcessProbe(
        process_iter=_fake_process_iter([]),
        session_id_resolver=_fake_session_resolver({}),
    )
    with pytest.raises(ProcessProbeError):
        probe.match(profile)


def test_match_raises_when_two_candidates_match_same_executable():
    profile = _profile()
    probe = RealProcessProbe(
        process_iter=_fake_process_iter(
            [_terminal_proc(pid=100), _terminal_proc(pid=101)]
        ),
        session_id_resolver=_fake_session_resolver({100: 1, 101: 2}),
    )
    with pytest.raises(ProcessProbeError):
        probe.match(profile)


def test_default_session_id_resolver_raises_off_windows():
    import sys

    from bridge.adapters.process_probe_psutil import _default_session_id_resolver

    if sys.platform == "win32":
        pytest.skip("this asserts the off-Windows guard")
    with pytest.raises(NotImplementedError):
        _default_session_id_resolver(1234)
