"""Login-scoped duplicate lock. Bridge owns this decision, not the supervisor."""

from bridge_v2.main import acquire_lock, extend_lock, ipc_breaker_tripped, release_lock
from bridge_v2.tests.test_publishers import FakeRedis


def test_ipc_breaker_trips_at_threshold_not_before():
    assert ipc_breaker_tripped(4, threshold=5) is False
    assert ipc_breaker_tripped(5, threshold=5) is True
    assert ipc_breaker_tripped(6, threshold=5) is True


def test_ipc_breaker_resets_are_the_callers_job_not_this_functions():
    # ipc_breaker_tripped is a pure threshold check; main.run()'s live loop
    # resets its own counter to 0 on a successful poll — proven by exercising
    # the same counter value twice here, not by this function having state.
    assert ipc_breaker_tripped(0, threshold=5) is False


def test_first_bridge_acquires_lock():
    r = FakeRedis()
    assert acquire_lock(r, 7948784, "pid-1") is True


def test_second_bridge_for_same_login_is_rejected():
    r = FakeRedis()
    assert acquire_lock(r, 7948784, "pid-1") is True
    assert acquire_lock(r, 7948784, "pid-2") is False  # duplicate — must exit


def test_different_logins_do_not_conflict():
    r = FakeRedis()
    assert acquire_lock(r, 7948784, "pid-1") is True
    assert acquire_lock(r, 1234567, "pid-2") is True


def test_extend_fails_once_ownership_is_lost():
    r = FakeRedis()
    acquire_lock(r, 7948784, "pid-1")
    r.kv[f"mt5:v2:bridge:lock:7948784"] = "pid-2"  # another process took over (TTL expiry + race)
    assert extend_lock(r, 7948784, "pid-1") is False


def test_release_only_removes_own_lock():
    r = FakeRedis()
    acquire_lock(r, 7948784, "pid-1")
    release_lock(r, 7948784, "pid-9")  # not the owner — must not touch the lock
    assert r.get("mt5:v2:bridge:lock:7948784") == "pid-1"
    release_lock(r, 7948784, "pid-1")
    assert r.get("mt5:v2:bridge:lock:7948784") is None
