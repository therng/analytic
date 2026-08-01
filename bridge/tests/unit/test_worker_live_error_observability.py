from __future__ import annotations

import threading
from dataclasses import dataclass
from types import SimpleNamespace

from bridge.exit_codes import WorkerExitCode
from bridge.worker import WorkerRuntimeConfig, _poll_loop


class _FakeRenewalThread:
    """Duck-typed stand-in for LeaseRenewalThread -- _poll_loop only ever
    reads .lease_lost and calls .get_last_success_at(), never anything else
    on the real thread class, so a real one (which starts a background
    thread against a real RedisLease) would be pure overhead here."""

    def __init__(self) -> None:
        self.lease_lost = threading.Event()

    def get_last_success_at(self) -> float:
        return 1_000.0


class _FakeTerminalSession:
    def revalidate(self, verified: object) -> None:
        pass


@dataclass
class _LiveOutcome:
    state: str
    reason: str | None = None


def _runtime_config() -> WorkerRuntimeConfig:
    return WorkerRuntimeConfig(
        owner_id="host-a",
        lease_ttl_ms=15_000,
        lease_renew_interval_ms=5_000,
        lease_watchdog_margin_s=2.0,
        revalidate_every_n_polls=1,
        live_poll_s=0.0,
        history_poll_s=0.0,
    )


def test_live_error_outcome_is_logged_and_counted_without_stopping_the_loop(
    capsys,
) -> None:
    verified = SimpleNamespace(profile=SimpleNamespace(expected_login=7998410))
    history_calls = []

    outcome = _poll_loop(
        runtime_config=_runtime_config(),
        terminal_session=_FakeTerminalSession(),
        verified=verified,
        poll_live=lambda: _LiveOutcome(state="failed", reason="required read failed"),
        poll_history=lambda: history_calls.append(1),
        renewal_thread=_FakeRenewalThread(),
        clock=lambda: 1_000.0,
        sleep=lambda _seconds: None,
        stop_requested=threading.Event(),
        max_poll_cycles=1,
        parent_pid_check=None,
        initial_parent_pid=None,
    )

    # Observability must not change the data path: the loop still completes
    # its bounded cycle cleanly, and history polling still runs the same
    # cycle a live.error occurred in.
    assert outcome.exit_code is WorkerExitCode.CLEAN_SHUTDOWN
    assert history_calls == [1]

    err = capsys.readouterr().err
    assert "live_error" in err
    assert "login=7998410" in err
    assert "reason=required read failed" in err
    assert "live_error_count=1" in err


def test_live_error_count_accumulates_across_cycles(capsys) -> None:
    verified = SimpleNamespace(profile=SimpleNamespace(expected_login=7998410))

    _poll_loop(
        runtime_config=_runtime_config(),
        terminal_session=_FakeTerminalSession(),
        verified=verified,
        poll_live=lambda: _LiveOutcome(state="failed"),
        poll_history=lambda: None,
        renewal_thread=_FakeRenewalThread(),
        clock=lambda: 1_000.0,
        sleep=lambda _seconds: None,
        stop_requested=threading.Event(),
        max_poll_cycles=3,
        parent_pid_check=None,
        initial_parent_pid=None,
    )

    err = capsys.readouterr().err
    assert err.count("live_error ") == 3
    assert "live_error_count=3" in err


def test_published_live_outcome_produces_no_log(capsys) -> None:
    verified = SimpleNamespace(profile=SimpleNamespace(expected_login=7998410))

    _poll_loop(
        runtime_config=_runtime_config(),
        terminal_session=_FakeTerminalSession(),
        verified=verified,
        poll_live=lambda: _LiveOutcome(state="published"),
        poll_history=lambda: None,
        renewal_thread=_FakeRenewalThread(),
        clock=lambda: 1_000.0,
        sleep=lambda _seconds: None,
        stop_requested=threading.Event(),
        max_poll_cycles=1,
        parent_pid_check=None,
        initial_parent_pid=None,
    )

    assert capsys.readouterr().err == ""


def test_poll_live_returning_a_plain_object_is_not_treated_as_a_failure(
    capsys,
) -> None:
    """poll_live() in production always returns a LiveOutcome, but
    _poll_loop reaches it via a Protocol typed as `object` -- the
    getattr(..., "state", None) duck-typing must not misfire on something
    that isn't a LiveOutcome at all."""
    verified = SimpleNamespace(profile=SimpleNamespace(expected_login=7998410))

    _poll_loop(
        runtime_config=_runtime_config(),
        terminal_session=_FakeTerminalSession(),
        verified=verified,
        poll_live=lambda: None,
        poll_history=lambda: None,
        renewal_thread=_FakeRenewalThread(),
        clock=lambda: 1_000.0,
        sleep=lambda _seconds: None,
        stop_requested=threading.Event(),
        max_poll_cycles=1,
        parent_pid_check=None,
        initial_parent_pid=None,
    )

    assert capsys.readouterr().err == ""
