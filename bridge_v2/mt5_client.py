"""Thin, honest MT5 wrapper.

The ONLY job: connect to one explicit portable terminal and make raw calls,
distinguishing three outcomes that the old bridge blurred together:

  OK      -> call returned a value (possibly an empty tuple = genuinely zero rows)
  FAILED  -> call returned None (MT5 signals failure via None + last_error())
  ERROR   -> call raised an exception

A FAILED or ERROR result is never silently turned into an empty result. Callers
decide whether to abort; this module refuses to lie about which happened.

MetaTrader5 is imported lazily so the rest of bridge_v2 (serializers, models,
reconcile, validation) imports and unit-tests on any platform.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable


class CallStatus(str, Enum):
    OK = "ok"
    FAILED = "failed"   # MT5 returned None
    ERROR = "error"     # exception raised


@dataclass
class CallResult:
    status: CallStatus
    value: Any = None
    last_error: Any = None          # mt5.last_error() tuple on FAILED
    exception: BaseException | None = None  # on ERROR

    @property
    def ok(self) -> bool:
        return self.status is CallStatus.OK

    def rows(self) -> tuple:
        """Records for an OK call. Raises if not OK — callers must check .ok."""
        if not self.ok:
            raise RuntimeError(f"cannot read rows from {self.status.value} call: {self.describe()}")
        return tuple(self.value or ())

    def describe(self) -> str:
        if self.status is CallStatus.FAILED:
            return f"MT5 returned None (last_error={self.last_error})"
        if self.status is CallStatus.ERROR:
            return f"MT5 raised: {self.exception!r}"
        return "ok"


def login_of(value) -> int:
    """Extract `login` from an account_info() value, namedtuple or dict alike."""
    return int(value.login if not isinstance(value, dict) else value["login"])


def _load_mt5():
    try:
        import MetaTrader5 as mt5  # type: ignore[import]
    except ImportError as exc:
        raise RuntimeError("MetaTrader5 not installed. pip install MetaTrader5") from exc
    return mt5


def terminal_process_is_running(terminal_path: str) -> bool:
    """True only when exactly one terminal64.exe process already runs at this path.

    mt5.initialize(path=...) will happily LAUNCH the terminal itself if it
    isn't already running — bridge_v2 must never do that. This guard is
    checked before every initialize() call so a missing/closed terminal
    fails loudly instead of silently starting one.
    """
    if os.name != "nt":
        return True  # non-Windows dev/test machines can't check; tests inject their own value

    try:
        import psutil
    except ImportError:
        return False  # cannot verify -> must not assume it's safe to proceed

    target = os.path.normcase(os.path.abspath(terminal_path))
    matches = []
    for proc in psutil.process_iter(attrs=["exe", "name"], ad_value=None):
        try:
            if proc.info["name"] and proc.info["name"].lower() == "terminal64.exe":
                proc_path = proc.info["exe"]
                if proc_path and os.path.normcase(os.path.abspath(proc_path)) == target:
                    matches.append(proc.pid)
        except Exception:
            continue
    return len(matches) == 1


class Mt5Client:
    def __init__(self, terminal_path: str, mt5_module=None, process_check=None):
        if not terminal_path:
            raise ValueError("terminal_path is required (explicit portable path)")
        self.terminal_path = terminal_path
        self._mt5 = mt5_module or _load_mt5()
        self._process_check = process_check or terminal_process_is_running

    def initialize(self) -> None:
        """Initialize against the explicit portable terminal path. Always /portable.

        Refuses to proceed — and never calls mt5.initialize() — unless the
        terminal process is already confirmed running.
        """
        if not self._process_check(self.terminal_path):
            raise RuntimeError(
                f"terminal is not already running: {self.terminal_path} "
                "(bridge_v2 never launches terminal64.exe; start it with /portable first)"
            )
        ok = self._mt5.initialize(path=self.terminal_path, portable=True)
        if not ok:
            raise RuntimeError(f"mt5.initialize failed: {self._mt5.last_error()}")

    def shutdown(self) -> None:
        try:
            self._mt5.shutdown()
        except Exception:
            pass

    def call(self, name: str, *args, **kwargs) -> CallResult:
        """Invoke an MT5 function by name, classifying the outcome honestly."""
        fn: Callable = getattr(self._mt5, name)
        try:
            value = fn(*args, **kwargs)
        except Exception as exc:  # ERROR — do NOT convert to empty
            return CallResult(CallStatus.ERROR, exception=exc)
        if value is None:  # FAILED — MT5's failure signal
            return CallResult(CallStatus.FAILED, last_error=self._mt5.last_error())
        return CallResult(CallStatus.OK, value=value)

    # Convenience wrappers — all raw, all classified.
    def account_info(self) -> CallResult:
        return self.call("account_info")

    def terminal_info(self) -> CallResult:
        return self.call("terminal_info")

    def positions_get(self) -> CallResult:
        return self.call("positions_get")

    def history_deals_get(self, date_from, date_to) -> CallResult:
        return self.call("history_deals_get", date_from, date_to)

    def history_orders_get(self, date_from, date_to) -> CallResult:
        return self.call("history_orders_get", date_from, date_to)
