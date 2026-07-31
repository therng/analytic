from __future__ import annotations

import sys

import pytest

from bridge.job_object import WindowsJobObject


def test_raises_off_windows():
    if sys.platform == "win32":
        pytest.skip("this asserts the off-Windows guard; real behavior is Windows-only")
    with pytest.raises(NotImplementedError):
        WindowsJobObject()
