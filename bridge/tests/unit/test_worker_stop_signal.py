from __future__ import annotations

import os
import signal
import threading

from bridge.worker import install_stop_signal_handlers


def _run_with_restored_handlers(signum: int, fn) -> None:
    previous = signal.signal(signum, signal.SIG_DFL)
    try:
        fn()
    finally:
        signal.signal(signum, previous)


def test_sigterm_sets_stop_requested() -> None:
    stop_requested = threading.Event()

    def body() -> None:
        install_stop_signal_handlers(stop_requested)
        os.kill(os.getpid(), signal.SIGTERM)
        assert stop_requested.is_set()

    _run_with_restored_handlers(signal.SIGTERM, body)


def test_sigint_sets_stop_requested() -> None:
    stop_requested = threading.Event()

    def body() -> None:
        install_stop_signal_handlers(stop_requested)
        os.kill(os.getpid(), signal.SIGINT)
        assert stop_requested.is_set()

    _run_with_restored_handlers(signal.SIGINT, body)


def test_sigbreak_sets_stop_requested_when_available() -> None:
    """SIGBREAK only exists on Windows -- the platform the supervisor's
    CTRL_BREAK_EVENT shutdown ladder actually targets."""
    if not hasattr(signal, "SIGBREAK"):
        return
    stop_requested = threading.Event()

    def body() -> None:
        install_stop_signal_handlers(stop_requested)
        os.kill(os.getpid(), signal.SIGBREAK)
        assert stop_requested.is_set()

    _run_with_restored_handlers(signal.SIGBREAK, body)
