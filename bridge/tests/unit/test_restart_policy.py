from __future__ import annotations

from bridge.exit_codes import Classification, PolicyKind
from bridge.restart_policy import (
    BackoffConfig,
    apply_stable_runtime_reset,
    compute_backoff_delay_ms,
    decide,
)

ZERO_JITTER = lambda upper: 0.0  # noqa: E731 - deterministic test jitter
MAX_JITTER = lambda upper: upper  # noqa: E731


def test_backoff_grows_exponentially_and_caps():
    config = BackoffConfig(base_delay_ms=1000, max_delay_ms=8000)
    delays = [
        compute_backoff_delay_ms(n, config, jitter_fn=ZERO_JITTER) for n in range(1, 8)
    ]
    assert delays[:4] == [1000, 2000, 4000, 8000]
    # Capped at max_delay_ms once the exponential would exceed it.
    assert delays[4] == 8000
    assert delays[-1] == 8000


def test_jitter_falls_within_twenty_percent_band():
    config = BackoffConfig(base_delay_ms=1000, max_delay_ms=300_000)
    low = compute_backoff_delay_ms(3, config, jitter_fn=ZERO_JITTER)
    high = compute_backoff_delay_ms(3, config, jitter_fn=MAX_JITTER)
    base = 1000 * 2**2
    assert low == base
    assert high == int(base + base * 0.2)


def test_restart_storm_delays_grow_across_repeated_failures():
    config = BackoffConfig(base_delay_ms=500, max_delay_ms=60_000)
    restart_count = 0
    window_start = 0.0
    delays = []
    for i in range(6):
        decision = decide(
            Classification.MT5_IPC_FAILURE,
            restart_count=restart_count,
            window_start_s=window_start,
            now_s=float(i),
            config=config,
            jitter_fn=ZERO_JITTER,
        )
        delays.append(decision.delay_ms)
        restart_count = decision.next_restart_count
        window_start = decision.next_window_start_s
    assert delays == sorted(delays)
    assert delays[-1] <= config.max_delay_ms
    assert delays[0] < delays[-1]


def test_config_invalid_quarantines_on_first_occurrence():
    config = BackoffConfig()
    decision = decide(
        Classification.CONFIG_INVALID,
        restart_count=0,
        window_start_s=0.0,
        now_s=0.0,
        config=config,
    )
    assert decision.kind is PolicyKind.QUARANTINE_IMMEDIATE
    assert decision.should_quarantine is True
    assert decision.delay_ms == 0


def test_journal_failure_quarantines_on_first_occurrence():
    config = BackoffConfig()
    decision = decide(
        Classification.JOURNAL_FAILURE,
        restart_count=0,
        window_start_s=0.0,
        now_s=0.0,
        config=config,
    )
    assert decision.should_quarantine is True


def test_duplicate_ownership_retries_on_a_fixed_delay_and_never_quarantines():
    config = BackoffConfig(duplicate_retry_ms=60_000)
    for restart_count in (0, 5, 50):
        decision = decide(
            Classification.DUPLICATE_OWNERSHIP,
            restart_count=restart_count,
            window_start_s=0.0,
            now_s=float(restart_count),
            config=config,
        )
        assert decision.kind is PolicyKind.FIXED_DELAY_RESTART
        assert decision.delay_ms == 60_000
        assert decision.should_quarantine is False
        assert decision.should_quarantine is False


def test_clean_shutdown_never_restarts():
    config = BackoffConfig()
    decision = decide(
        Classification.CLEAN_SHUTDOWN,
        restart_count=0,
        window_start_s=0.0,
        now_s=0.0,
        config=config,
    )
    assert decision.kind is PolicyKind.NO_RESTART_REMOVE
    assert decision.delay_ms == 0
    assert decision.should_quarantine is False


def test_identity_violation_backs_off_below_threshold():
    config = BackoffConfig(identity_violation_max_restarts=3, restart_window_s=600)
    restart_count = 0
    window_start = 0.0
    for i in range(3):
        decision = decide(
            Classification.IDENTITY_VIOLATION,
            restart_count=restart_count,
            window_start_s=window_start,
            now_s=float(i),
            config=config,
            jitter_fn=ZERO_JITTER,
        )
        assert decision.should_quarantine is False
        restart_count = decision.next_restart_count
        window_start = decision.next_window_start_s
    assert restart_count == 3


def test_identity_violation_quarantines_after_threshold_within_window():
    config = BackoffConfig(identity_violation_max_restarts=3, restart_window_s=600)
    restart_count = 3
    window_start = 0.0
    decision = decide(
        Classification.IDENTITY_VIOLATION,
        restart_count=restart_count,
        window_start_s=window_start,
        now_s=10.0,
        config=config,
        jitter_fn=ZERO_JITTER,
    )
    assert decision.next_restart_count == 4
    assert decision.should_quarantine is True


def test_restart_window_expiry_resets_count_before_deciding():
    config = BackoffConfig(identity_violation_max_restarts=3, restart_window_s=600)
    # restart_count already at the ceiling, but the window has aged out --
    # the next failure should NOT immediately quarantine, since it's
    # effectively a fresh window.
    decision = decide(
        Classification.IDENTITY_VIOLATION,
        restart_count=3,
        window_start_s=0.0,
        now_s=10_000.0,  # far beyond restart_window_s
        config=config,
        jitter_fn=ZERO_JITTER,
    )
    assert decision.next_restart_count == 1
    assert decision.should_quarantine is False
    assert decision.next_window_start_s == 10_000.0


def test_apply_stable_runtime_reset_resets_after_stable_uptime():
    config = BackoffConfig(stable_s=300)
    restart_count, window_start = apply_stable_runtime_reset(
        restart_count=5,
        window_start_s=100.0,
        uptime_s=301.0,
        now_s=10_000.0,
        config=config,
    )
    assert restart_count == 0
    assert window_start == 10_000.0


def test_apply_stable_runtime_reset_no_reset_below_stable_uptime():
    config = BackoffConfig(stable_s=300)
    restart_count, window_start = apply_stable_runtime_reset(
        restart_count=5,
        window_start_s=100.0,
        uptime_s=10.0,
        now_s=10_000.0,
        config=config,
    )
    assert restart_count == 5
    assert window_start == 100.0


def test_stable_reset_then_decide_starts_backoff_from_base_delay():
    config = BackoffConfig(base_delay_ms=1000, max_delay_ms=60_000, stable_s=300)
    restart_count, window_start = apply_stable_runtime_reset(
        restart_count=6,
        window_start_s=0.0,
        uptime_s=400.0,
        now_s=500.0,
        config=config,
    )
    decision = decide(
        Classification.MT5_IPC_FAILURE,
        restart_count=restart_count,
        window_start_s=window_start,
        now_s=500.0,
        config=config,
        jitter_fn=ZERO_JITTER,
    )
    assert decision.delay_ms == 1000  # base delay, not inflated by the prior streak
