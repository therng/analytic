from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bridge.canonical import canonical_json_bytes
from bridge.models import CallState


@dataclass(frozen=True)
class Mt5CallError:
    code: int | None
    description: str


@dataclass(frozen=True)
class CallResult:
    state: CallState
    rows: tuple[dict[str, Any], ...] = ()
    value: dict[str, Any] | tuple[Any, ...] | None = None
    error: Mt5CallError | None = None


class StrictMt5Adapter:
    def __init__(self, mt5: Any) -> None:
        self._mt5 = mt5

    def positions(self) -> CallResult:
        return self._collection_call(self._mt5.positions_get)

    def orders(self) -> CallResult:
        return self._collection_call(self._mt5.orders_get)

    def history_deals(self, start_raw: int, end_raw: int) -> CallResult:
        self._validate_raw_bounds(start_raw, end_raw)
        return self._collection_call(
            lambda: self._mt5.history_deals_get(start_raw, end_raw)
        )

    def history_orders(self, start_raw: int, end_raw: int) -> CallResult:
        self._validate_raw_bounds(start_raw, end_raw)
        return self._collection_call(
            lambda: self._mt5.history_orders_get(start_raw, end_raw)
        )

    def account(self) -> CallResult:
        return self._value_call(self._mt5.account_info)

    def terminal(self) -> CallResult:
        return self._value_call(self._mt5.terminal_info)

    def version(self) -> CallResult:
        try:
            result = self._mt5.version()
        except Exception as error:
            return self._exception_failure(error)
        if result is None or result is False:
            return self._mt5_failure()
        if not isinstance(result, tuple):
            return self._local_failure("invalid version result")
        return CallResult(state=CallState.SUCCESS_NONEMPTY, value=result)

    @staticmethod
    def _validate_raw_bounds(start_raw: int, end_raw: int) -> None:
        if (
            isinstance(start_raw, bool)
            or isinstance(end_raw, bool)
            or not isinstance(start_raw, int)
            or not isinstance(end_raw, int)
        ):
            raise TypeError("history boundaries must be raw integers")

    def _collection_call(self, operation: Any) -> CallResult:
        try:
            result = operation()
        except Exception as error:
            return self._exception_failure(error)
        if result is None or result is False:
            return self._mt5_failure()
        if not isinstance(result, tuple):
            return self._local_failure("invalid collection result")
        if not result:
            return CallResult(state=CallState.SUCCESS_EMPTY)
        rows: list[dict[str, Any]] = []
        for item in result:
            raw = self._named_tuple_dict(item)
            if raw is None:
                return self._local_failure("invalid named-tuple row")
            rows.append(raw)
        return CallResult(
            state=CallState.SUCCESS_NONEMPTY,
            rows=tuple(rows),
        )

    def _value_call(self, operation: Any) -> CallResult:
        try:
            result = operation()
        except Exception as error:
            return self._exception_failure(error)
        if result is None or result is False:
            return self._mt5_failure()
        raw = self._named_tuple_dict(result)
        if raw is None:
            return self._local_failure("invalid named-tuple value")
        return CallResult(state=CallState.SUCCESS_NONEMPTY, value=raw)

    @staticmethod
    def _named_tuple_dict(value: Any) -> dict[str, Any] | None:
        converter = getattr(value, "_asdict", None)
        if not callable(converter):
            return None
        try:
            raw = dict(converter())
            canonical_json_bytes(raw)
        except (TypeError, ValueError):
            return None
        return raw

    def _mt5_failure(self) -> CallResult:
        try:
            code, description = self._mt5.last_error()
        except Exception as error:
            return self._exception_failure(error)
        return CallResult(
            state=CallState.FAILED,
            error=Mt5CallError(code=code, description=str(description)),
        )

    @staticmethod
    def _local_failure(description: str) -> CallResult:
        return CallResult(
            state=CallState.FAILED,
            error=Mt5CallError(code=None, description=description),
        )

    @staticmethod
    def _exception_failure(error: Exception) -> CallResult:
        return CallResult(
            state=CallState.FAILED,
            error=Mt5CallError(code=None, description=type(error).__name__),
        )
