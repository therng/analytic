from __future__ import annotations

from collections import namedtuple

import pytest

from bridge.models import CallState
from bridge.mt5_adapter import StrictMt5Adapter

Position = namedtuple("Position", "ticket time time_msc symbol profit")
Account = namedtuple("Account", "login server balance")


class FakeMt5:
    def __init__(self) -> None:
        self.results: dict[str, object] = {}
        self.calls: list[tuple[str, tuple[object, ...], dict[str, object]]] = []
        self.error = (-10005, "timeout")

    def _result(self, name: str, *args: object, **kwargs: object) -> object:
        self.calls.append((name, args, kwargs))
        result = self.results[name]
        if isinstance(result, BaseException):
            raise result
        return result

    def positions_get(self) -> object:
        return self._result("positions_get")

    def orders_get(self) -> object:
        return self._result("orders_get")

    def history_deals_get(self, start: int, end: int) -> object:
        return self._result("history_deals_get", start, end)

    def history_orders_get(self, start: int, end: int) -> object:
        return self._result("history_orders_get", start, end)

    def account_info(self) -> object:
        return self._result("account_info")

    def terminal_info(self) -> object:
        return self._result("terminal_info")

    def version(self) -> object:
        return self._result("version")

    def last_error(self) -> tuple[int, str]:
        self.calls.append(("last_error", (), {}))
        return self.error


def test_nonempty_collection_preserves_all_namedtuple_fields() -> None:
    mt5 = FakeMt5()
    mt5.results["positions_get"] = (
        Position(42, 1_735_689_600, 1_735_689_600_123, "EURUSD", 1.25),
    )

    result = StrictMt5Adapter(mt5).positions()

    assert result.state is CallState.SUCCESS_NONEMPTY
    assert result.rows == (
        {
            "ticket": 42,
            "time": 1_735_689_600,
            "time_msc": 1_735_689_600_123,
            "symbol": "EURUSD",
            "profit": 1.25,
        },
    )
    assert not any(call[0] == "last_error" for call in mt5.calls)


def test_empty_tuple_is_successful_empty_collection() -> None:
    mt5 = FakeMt5()
    mt5.results["orders_get"] = ()

    result = StrictMt5Adapter(mt5).orders()

    assert result.state is CallState.SUCCESS_EMPTY
    assert result.rows == ()
    assert result.error is None


@pytest.mark.parametrize("failed_value", [None, False])
def test_none_or_false_is_failure_never_empty(failed_value: object) -> None:
    mt5 = FakeMt5()
    mt5.results["positions_get"] = failed_value

    result = StrictMt5Adapter(mt5).positions()

    assert result.state is CallState.FAILED
    assert result.rows == ()
    assert result.error is not None
    assert result.error.code == -10005


def test_exception_is_failure_with_redacted_exception_type() -> None:
    mt5 = FakeMt5()
    mt5.results["orders_get"] = RuntimeError("credential-shaped detail")

    result = StrictMt5Adapter(mt5).orders()

    assert result.state is CallState.FAILED
    assert result.error is not None
    assert result.error.code is None
    assert result.error.description == "RuntimeError"


def test_malformed_row_is_failure_not_partial_success() -> None:
    mt5 = FakeMt5()
    mt5.results["positions_get"] = ({"ticket": 42},)

    result = StrictMt5Adapter(mt5).positions()

    assert result.state is CallState.FAILED
    assert result.rows == ()
    assert result.error is not None
    assert result.error.description == "invalid named-tuple row"


def test_account_namedtuple_is_classified_as_single_value() -> None:
    mt5 = FakeMt5()
    mt5.results["account_info"] = Account(10001, "Broker-Demo", 10_000.0)

    result = StrictMt5Adapter(mt5).account()

    assert result.state is CallState.SUCCESS_NONEMPTY
    assert result.value == {
        "login": 10001,
        "server": "Broker-Demo",
        "balance": 10_000.0,
    }


def test_history_boundaries_are_passed_as_raw_integers() -> None:
    mt5 = FakeMt5()
    mt5.results["history_deals_get"] = ()

    result = StrictMt5Adapter(mt5).history_deals(100, 200)

    assert result.state is CallState.SUCCESS_EMPTY
    assert mt5.calls[0] == ("history_deals_get", (100, 200), {})


def test_boolean_and_non_integer_history_boundaries_are_rejected() -> None:
    mt5 = FakeMt5()
    adapter = StrictMt5Adapter(mt5)

    with pytest.raises(TypeError, match="raw integer"):
        adapter.history_orders(True, 200)

    with pytest.raises(TypeError, match="raw integer"):
        adapter.history_orders(100.0, 200)  # type: ignore[arg-type]
