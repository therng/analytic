from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable

from bridge.exit_codes import Classification, PolicyKind, restart_policy_for


@dataclass(frozen=True)
class BackoffConfig:
    base_delay_ms: int = 1000
    max_delay_ms: int = 300_000
    stable_s: int = 300
    identity_violation_max_restarts: int = 3
    restart_window_s: int = 600
    duplicate_retry_ms: int = 60_000


@dataclass(frozen=True)
class RestartDecision:
    kind: PolicyKind
    delay_ms: int
    should_quarantine: bool
    next_restart_count: int
    next_window_start_s: float


JitterFn = Callable[[float], float]


def _default_jitter(jitter_upper_ms: float) -> float:
    return random.uniform(0, jitter_upper_ms)


def compute_backoff_delay_ms(
    restart_count: int,
    config: BackoffConfig,
    *,
    jitter_fn: JitterFn | None = None,
) -> int:
    """Exponential backoff: base * 2^(restart_count-1), capped at max_delay,
    plus uniform jitter in [0, 20% of the capped base]. restart_count is
    expected to be >= 1 (the count including the failure just observed)."""
    exponent = max(restart_count - 1, 0)
    base = min(config.base_delay_ms * (2**exponent), config.max_delay_ms)
    jitter = (jitter_fn or _default_jitter)(base * 0.2)
    return int(base + jitter)


def apply_stable_runtime_reset(
    *,
    restart_count: int,
    window_start_s: float,
    uptime_s: float,
    now_s: float,
    config: BackoffConfig,
) -> tuple[int, float]:
    """A child that ran continuously for >= config.stable_s resets its own
    consecutive-failure counter to zero before its next failure is
    considered — a transient blip long ago should not permanently inflate
    backoff for an account that has since been healthy. Call this with the
    just-ended child's uptime immediately before `decide()` for its exit."""
    if uptime_s >= config.stable_s:
        return 0, now_s
    return restart_count, window_start_s


def decide(
    classification: Classification,
    *,
    restart_count: int,
    window_start_s: float,
    now_s: float,
    config: BackoffConfig,
    jitter_fn: JitterFn | None = None,
) -> RestartDecision:
    """Pure restart-policy decision. Callers persist next_restart_count /
    next_window_start_s (bridge/health.py) so the decision resumes correctly
    across a supervisor restart rather than starting from zero."""
    policy = restart_policy_for(classification)

    # A restart-count window that has aged out resets independently of the
    # stable-runtime mechanism -- this bounds how many restarts within
    # BRIDGE_RESTART_WINDOW_MS count toward a quarantine ceiling (currently
    # only identity_violation uses a ceiling), distinct from
    # apply_stable_runtime_reset's continuous-uptime reset.
    if now_s - window_start_s > config.restart_window_s:
        restart_count = 0
        window_start_s = now_s

    if policy.kind is PolicyKind.NO_RESTART_REMOVE:
        return RestartDecision(
            kind=policy.kind,
            delay_ms=0,
            should_quarantine=False,
            next_restart_count=restart_count,
            next_window_start_s=window_start_s,
        )

    next_restart_count = restart_count + 1

    if policy.kind is PolicyKind.QUARANTINE_IMMEDIATE:
        return RestartDecision(
            kind=policy.kind,
            delay_ms=0,
            should_quarantine=True,
            next_restart_count=next_restart_count,
            next_window_start_s=window_start_s,
        )

    if policy.kind is PolicyKind.FIXED_DELAY_RESTART:
        return RestartDecision(
            kind=policy.kind,
            delay_ms=config.duplicate_retry_ms,
            should_quarantine=False,
            next_restart_count=next_restart_count,
            next_window_start_s=window_start_s,
        )

    # BACKOFF_RESTART
    should_quarantine = (
        classification is Classification.IDENTITY_VIOLATION
        and next_restart_count > config.identity_violation_max_restarts
    )
    delay_ms = compute_backoff_delay_ms(next_restart_count, config, jitter_fn=jitter_fn)
    return RestartDecision(
        kind=policy.kind,
        delay_ms=delay_ms,
        should_quarantine=should_quarantine,
        next_restart_count=next_restart_count,
        next_window_start_s=window_start_s,
    )
