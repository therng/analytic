from __future__ import annotations

from bridge.adapters.mt5_real import RealMt5Port


class _FakeMt5Module:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple, dict]] = []
        self._initialize_result = True
        self._last_error_result = (1, "no error")

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        self.calls.append(("initialize", (path,), {"timeout": timeout, "portable": portable}))
        return self._initialize_result

    def shutdown(self) -> None:
        self.calls.append(("shutdown", (), {}))

    def version(self):
        self.calls.append(("version", (), {}))
        return (500, 1234, "30 Jul 2026")

    def terminal_info(self):
        self.calls.append(("terminal_info", (), {}))
        return {"path": r"C:\MT5\Alpha", "connected": True}

    def account_info(self):
        self.calls.append(("account_info", (), {}))
        return {"login": 123, "server": "Broker-Live01"}

    def positions_get(self):
        self.calls.append(("positions_get", (), {}))
        return ()

    def orders_get(self):
        self.calls.append(("orders_get", (), {}))
        return None

    def history_deals_get(self, start: int, end: int):
        self.calls.append(("history_deals_get", (start, end), {}))
        return ("deal-row",)

    def history_orders_get(self, start: int, end: int):
        self.calls.append(("history_orders_get", (start, end), {}))
        return False

    def last_error(self):
        self.calls.append(("last_error", (), {}))
        return self._last_error_result


def test_injected_module_used_instead_of_real_import():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert port._mt5 is fake  # noqa: SLF001 - verifying injection wiring


def test_initialize_forwards_args_and_return_value_unchanged():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    result = port.initialize(r"C:\MT5\terminal64.exe", timeout=30000, portable=True)
    assert result is True
    assert fake.calls[-1] == (
        "initialize",
        (r"C:\MT5\terminal64.exe",),
        {"timeout": 30000, "portable": True},
    )


def test_shutdown_forwards_call():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    port.shutdown()
    assert fake.calls[-1] == ("shutdown", (), {})


def test_version_returns_raw_tuple_unmodified():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert port.version() == (500, 1234, "30 Jul 2026")


def test_terminal_info_and_account_info_returned_unmodified():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert port.terminal_info() == {"path": r"C:\MT5\Alpha", "connected": True}
    assert port.account_info() == {"login": 123, "server": "Broker-Live01"}


def test_positions_and_orders_pass_through_including_falsy_values():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert port.positions_get() == ()  # empty tuple preserved, not coerced
    assert port.orders_get() is None  # None preserved, not coerced to failure here


def test_history_calls_forward_integer_bounds_exactly():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert port.history_deals_get(1000, 2000) == ("deal-row",)
    assert fake.calls[-1] == ("history_deals_get", (1000, 2000), {})
    assert port.history_orders_get(1000, 2000) is False
    assert fake.calls[-1] == ("history_orders_get", (1000, 2000), {})


def test_last_error_forwards_raw_result():
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert port.last_error() == (1, "no error")


def test_no_method_does_any_classification_beyond_passthrough():
    # RealMt5Port must never itself decide SUCCESS/FAILED -- StrictMt5Adapter
    # owns that. Verify by checking every public method returns exactly
    # what the fake module returned, with no wrapping type.
    fake = _FakeMt5Module()
    port = RealMt5Port(fake)
    assert type(port.positions_get()) is tuple
    assert port.orders_get() is None
    assert port.history_orders_get(0, 1) is False
