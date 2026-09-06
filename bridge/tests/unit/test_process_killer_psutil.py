from __future__ import annotations

from bridge.adapters.process_killer_psutil import PsutilProcessKiller


class FakeProcess:
    """The psutil.Process surface PsutilProcessKiller touches, faked so the
    ladder is testable without psutil or a real Windows process."""

    def __init__(
        self,
        *,
        creation_time: float = 1000.0,
        wait_raises: list[bool] | None = None,
        fail_terminate: bool = False,
        fail_kill: bool = False,
    ) -> None:
        self._creation_time = creation_time
        self._wait_raises = list(wait_raises or [])
        self._fail_terminate = fail_terminate
        self._fail_kill = fail_kill
        self.terminate_called = False
        self.kill_called = False

    def create_time(self) -> float:
        return self._creation_time

    def terminate(self) -> None:
        if self._fail_terminate:
            raise RuntimeError("terminate refused")
        self.terminate_called = True

    def kill(self) -> None:
        if self._fail_kill:
            raise RuntimeError("kill refused")
        self.kill_called = True

    def wait(self, timeout: float) -> None:
        del timeout
        if self._wait_raises and self._wait_raises.pop(0):
            raise RuntimeError("TimeoutExpired")


def killer_for(process: FakeProcess | Exception) -> PsutilProcessKiller:
    def factory(pid: int) -> FakeProcess:
        factory.pids.append(pid)  # type: ignore[attr-defined]
        if isinstance(process, Exception):
            raise process
        return process

    factory.pids = []  # type: ignore[attr-defined]
    return PsutilProcessKiller(process_factory=factory)


def test_graceful_terminate_succeeds() -> None:
    process = FakeProcess(creation_time=1000.0)
    killer = killer_for(process)

    outcome = killer.kill(7, 1000.0)

    assert outcome == "terminated"
    assert process.terminate_called is True
    assert process.kill_called is False
    assert killer._process_factory.pids == [7]  # the verdict targets the exact pid


def test_small_creation_time_drift_still_kills() -> None:
    # Just inside the tolerance: the same process observed twice can drift
    # by float noise; it must not be mistaken for a recycled PID.
    process = FakeProcess(creation_time=1000.0005)

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "terminated"
    assert process.terminate_called is True


def test_just_outside_tolerance_is_refused() -> None:
    # A process whose create_time differs by more than the tolerance is
    # not the process detection captured -- refuse rather than kill.
    process = FakeProcess(creation_time=1000.5)

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "pid recycled, refused to kill"
    assert process.terminate_called is False
    assert process.kill_called is False


def test_survived_terminate_escalates_to_kill() -> None:
    # First wait times out -> escalate; second wait succeeds.
    process = FakeProcess(creation_time=1000.0, wait_raises=[True])

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "force-killed"
    assert process.terminate_called is True
    assert process.kill_called is True


def test_process_already_gone_reports_without_raising() -> None:
    outcome = killer_for(RuntimeError("NoSuchProcess")).kill(7, 1000.0)

    assert outcome == "already exited before kill"


def test_recycled_pid_is_refused() -> None:
    process = FakeProcess(creation_time=9000.0)  # detection captured 1000.0

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "pid recycled, refused to kill"
    assert process.terminate_called is False
    assert process.kill_called is False


def test_terminate_failure_is_reported_not_raised() -> None:
    process = FakeProcess(creation_time=1000.0, fail_terminate=True)

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "terminate failed"


def test_kill_escalation_failure_is_reported() -> None:
    process = FakeProcess(creation_time=1000.0, wait_raises=[True], fail_kill=True)

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "kill escalation failed"


def test_surviving_both_stages_reports_survival() -> None:
    process = FakeProcess(creation_time=1000.0, wait_raises=[True, True])

    outcome = killer_for(process).kill(7, 1000.0)

    assert outcome == "survived kill escalation"
