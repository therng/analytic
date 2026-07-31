from __future__ import annotations

import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.skipif(
    sys.platform != "win32", reason="Windows Job Objects are Windows-only"
)


def _spawn_sleeper() -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def test_closing_job_handle_kills_assigned_child():
    from bridge.job_object import WindowsJobObject

    job = WindowsJobObject()
    child = _spawn_sleeper()
    try:
        job.assign_process(child.pid)
        assert child.poll() is None  # still running before close

        job.close()

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and child.poll() is None:
            time.sleep(0.1)
        assert child.poll() is not None, "child survived Job Object handle close"
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def test_job_object_is_per_child_not_shared():
    from bridge.job_object import WindowsJobObject

    job_a = WindowsJobObject()
    job_b = WindowsJobObject()
    child_a = _spawn_sleeper()
    child_b = _spawn_sleeper()
    try:
        job_a.assign_process(child_a.pid)
        job_b.assign_process(child_b.pid)

        job_a.close()

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and child_a.poll() is None:
            time.sleep(0.1)
        assert child_a.poll() is not None, "child_a survived its own job close"
        assert child_b.poll() is None, "child_b was killed by an unrelated job close"
    finally:
        for child in (child_a, child_b):
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
        job_b.close()


def test_forced_supervisor_death_via_process_exit_still_kills_child():
    # Simulates "the supervisor process itself terminates for any reason":
    # spawn a throwaway Python process that creates a job, assigns a
    # grandchild to it, and then hard-exits (os._exit) WITHOUT closing
    # anything explicitly -- proving the OS kills the grandchild once the
    # job handle's last reference (held only by the now-dead process) goes
    # away, independent of any Python cleanup code running.
    script = (
        "import subprocess, sys, time\n"
        "sys.path.insert(0, r'%s')\n"
        "from bridge.job_object import WindowsJobObject\n"
        "job = WindowsJobObject()\n"
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'],"
        " creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)\n"
        "job.assign_process(child.pid)\n"
        "print(child.pid, flush=True)\n"
        "import os\n"
        "os._exit(1)\n"
    ) % (__file__.rsplit("bridge", 1)[0].rstrip("/\\"),)

    proc = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, timeout=30
    )
    grandchild_pid = int(proc.stdout.strip())

    import psutil

    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and psutil.pid_exists(grandchild_pid):
        time.sleep(0.1)
    assert not psutil.pid_exists(grandchild_pid), (
        "grandchild survived forced supervisor-process death"
    )
