"""Failed MT5 calls must stay distinguishable from empty results."""

import pytest

from bridge_v2.mt5_client import CallStatus, Mt5Client


class FakeMt5:
    def __init__(self, result=None, raises=None, error=(-1, "boom")):
        self._result = result
        self._raises = raises
        self._error = error

    def initialize(self, path=None, portable=None):
        self.init_args = {"path": path, "portable": portable}
        return True

    def shutdown(self):
        pass

    def last_error(self):
        return self._error

    def positions_get(self):
        if self._raises:
            raise self._raises
        return self._result


def client(fake):
    return Mt5Client("C:/mt5/terminal64.exe", mt5_module=fake)


def test_empty_tuple_is_ok_not_failure():
    res = client(FakeMt5(result=())).positions_get()
    assert res.status is CallStatus.OK
    assert res.rows() == ()


def test_none_is_failed_and_carries_last_error():
    res = client(FakeMt5(result=None)).positions_get()
    assert res.status is CallStatus.FAILED
    assert res.last_error == (-1, "boom")
    # A failed call must never be readable as an empty result.
    with pytest.raises(RuntimeError):
        res.rows()


def test_exception_is_error_not_failed_and_not_empty():
    res = client(FakeMt5(raises=OSError("ipc down"))).positions_get()
    assert res.status is CallStatus.ERROR
    assert isinstance(res.exception, OSError)
    with pytest.raises(RuntimeError):
        res.rows()


def test_initialize_always_uses_explicit_portable_path():
    fake = FakeMt5(result=())
    client(fake).initialize()
    assert fake.init_args == {"path": "C:/mt5/terminal64.exe", "portable": True}


def test_terminal_path_is_required():
    with pytest.raises(ValueError):
        Mt5Client("", mt5_module=FakeMt5())
