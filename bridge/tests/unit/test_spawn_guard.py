from __future__ import annotations

from bridge.process_probe import ProcessCandidate
from bridge.spawn_guard import (
    PROCESS_EXITED_SLUG,
    PROCESS_REPLACED_SLUG,
    UNEXPECTED_LAUNCH_SLUG,
    candidates_at_path,
    classify,
    respond,
)


def candidate(
    pid: int,
    *,
    creation_time: float = 1000.0,
    executable_path: str = "C:\\MT5\\terminal64.exe",
) -> ProcessCandidate:
    return ProcessCandidate(
        pid=pid,
        creation_time=creation_time,
        executable_path=executable_path,
        command_line=(executable_path, "/portable"),
        process_user="svc",
        session_id=0,
        data_path="C:\\MT5",
        evidence_complete=True,
    )


class FakeKiller:
    def __init__(self, outcome: str = "terminated") -> None:
        self.outcome = outcome
        self.killed: list[tuple[int, float]] = []

    def kill(self, pid: int, creation_time: float) -> str:
        self.killed.append((pid, creation_time))
        return self.outcome


def test_candidates_at_path_matches_case_insensitively_and_excludes_other_paths() -> None:
    same = candidate(1, executable_path="C:\\MT5\\terminal64.exe")
    other = candidate(2, executable_path="C:\\MT5-OTHER\\terminal64.exe")

    matched = candidates_at_path("c:\\mt5\\TERMINAL64.EXE", [same, other])

    assert matched == [same]


def test_classify_clean_when_process_set_unchanged() -> None:
    probed = candidate(1)

    verdict = classify(candidate=probed, before=[probed], after=[probed])

    assert verdict.spawned == ()
    assert verdict.original_gone is False


def test_classify_detects_new_process_while_original_runs() -> None:
    probed = candidate(1)
    spawned = candidate(2, creation_time=2000.0)

    verdict = classify(candidate=probed, before=[probed], after=[probed, spawned])

    assert verdict.spawned == (spawned,)
    assert verdict.original_gone is False


def test_classify_replacement_when_original_gone_and_new_present() -> None:
    probed = candidate(1)
    replacement = candidate(2, creation_time=2000.0)

    verdict = classify(candidate=probed, before=[probed], after=[replacement])

    assert verdict.spawned == (replacement,)
    assert verdict.original_gone is True


def test_classify_exit_only_when_original_gone_and_nothing_new() -> None:
    probed = candidate(1)

    verdict = classify(candidate=probed, before=[probed], after=[])

    assert verdict.spawned == ()
    assert verdict.original_gone is True


def test_classify_pid_reuse_counts_as_replacement_not_clean_original() -> None:
    probed = candidate(7)
    recycled = candidate(7, creation_time=9000.0)  # same pid, new process

    verdict = classify(candidate=probed, before=[probed], after=[recycled])

    assert verdict.spawned == (recycled,)
    assert verdict.original_gone is True


def test_respond_returns_none_when_clean() -> None:
    killer = FakeKiller()
    probed = candidate(1)

    response = respond(
        label="pid=1",
        verdict=classify(candidate=probed, before=[probed], after=[probed]),
        killer=killer,
    )

    assert response.warning is None
    assert response.kill_targets == ()
    assert killer.killed == []


def test_respond_kills_spawned_duplicate_with_captured_creation_time() -> None:
    killer = FakeKiller(outcome="terminated")
    probed = candidate(1)
    spawned = candidate(2, creation_time=2000.0)

    response = respond(
        label="pid=1",
        verdict=classify(candidate=probed, before=[probed], after=[probed, spawned]),
        killer=killer,
    )

    assert response.warning is not None
    assert UNEXPECTED_LAUNCH_SLUG in response.warning
    assert "terminated" in response.warning
    assert response.kill_targets == (spawned,)
    assert killer.killed == [(2, 2000.0)]


def test_respond_kills_every_spawned_duplicate() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    first = candidate(2, creation_time=2000.0)
    second = candidate(3, creation_time=3000.0)

    response = respond(
        label="pid=1",
        verdict=classify(
            candidate=probed, before=[probed], after=[probed, first, second]
        ),
        killer=killer,
    )

    assert response.warning is not None
    assert response.kill_targets == (first, second)
    assert killer.killed == [(2, 2000.0), (3, 3000.0)]


def test_respond_never_kills_a_replacement() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    replacement = candidate(2, creation_time=2000.0)

    response = respond(
        label="pid=1",
        verdict=classify(candidate=probed, before=[probed], after=[replacement]),
        killer=killer,
    )

    assert response.warning is not None
    assert PROCESS_REPLACED_SLUG in response.warning
    assert response.kill_targets == ()
    assert killer.killed == []


def test_respond_never_kills_when_original_just_exited() -> None:
    killer = FakeKiller()
    probed = candidate(1)

    response = respond(
        label="pid=1",
        verdict=classify(candidate=probed, before=[probed], after=[]),
        killer=killer,
    )

    assert response.warning is not None
    assert PROCESS_EXITED_SLUG in response.warning
    assert response.kill_targets == ()
    assert killer.killed == []
