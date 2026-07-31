from __future__ import annotations

from typing import Protocol


class Mt5Module(Protocol):
    """The narrow shape of the real `MetaTrader5` module this bridge uses.
    Matches StrictMt5Adapter's/TerminalSession's expectations exactly — no
    `login`, `order_check`, `order_send`, or any other trading/lifecycle
    method is part of this Protocol, so a conforming injected fake cannot
    accidentally expose one to RealMt5Port's callers.
    """

    def initialize(self, path: str, timeout: int, portable: bool) -> bool: ...

    def shutdown(self) -> None: ...

    def version(self) -> tuple | None: ...

    def terminal_info(self) -> object | None: ...

    def account_info(self) -> object | None: ...

    def positions_get(self) -> tuple | None: ...

    def orders_get(self) -> tuple | None: ...

    def history_deals_get(self, start: int, end: int) -> tuple | None: ...

    def history_orders_get(self, start: int, end: int) -> tuple | None: ...

    def last_error(self) -> tuple: ...


class RealMt5Port:
    """Thin one-line-per-method passthrough over the real `MetaTrader5`
    module. Deliberately does no None/exception/tuple classification —
    StrictMt5Adapter (bridge/mt5_adapter.py) already owns that, on top of
    this port. Accepting an injected `mt5_module` (rather than importing
    `MetaTrader5` unconditionally at module scope) is what makes this class
    importable and its passthrough behavior unit-testable on non-Windows
    dev machines, where the real `MetaTrader5` package does not exist at
    all.
    """

    def __init__(self, mt5_module: Mt5Module | None = None) -> None:
        if mt5_module is None:
            import MetaTrader5 as mt5_module  # type: ignore[import-not-found]
        self._mt5 = mt5_module

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        return self._mt5.initialize(path, timeout=timeout, portable=portable)

    def shutdown(self) -> None:
        self._mt5.shutdown()

    def version(self) -> tuple | None:
        return self._mt5.version()

    def terminal_info(self) -> object | None:
        return self._mt5.terminal_info()

    def account_info(self) -> object | None:
        return self._mt5.account_info()

    def positions_get(self) -> tuple | None:
        return self._mt5.positions_get()

    def orders_get(self) -> tuple | None:
        return self._mt5.orders_get()

    def history_deals_get(self, start: int, end: int) -> tuple | None:
        return self._mt5.history_deals_get(start, end)

    def history_orders_get(self, start: int, end: int) -> tuple | None:
        return self._mt5.history_orders_get(start, end)

    def last_error(self) -> tuple:
        return self._mt5.last_error()
