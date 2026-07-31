from __future__ import annotations

import ctypes

import pytest

from bridge.journal.connection import _NativeWindowsSecurity

SERVICE_SID = b"S-1-5-18-SERVICE"  # arbitrary fixed-length fake SID bytes
ADMIN_SID = b"S-1-5-32-ADMINST"  # same length, different identity
SID_LEN = len(SERVICE_SID)
assert len(ADMIN_SID) == SID_LEN

ACCESS_ALLOWED_ACE_TYPE = 0
ACCESS_DENIED_ACE_TYPE = 1
SE_DACL_PROTECTED = 0x1000


def _build_ace(ace_type: int, mask: int, sid: bytes) -> ctypes.Array:
    """header(type,flags,size:2)+mask(4)+sid, matching ACCESS_*_ACE layout."""
    header = bytes([ace_type, 0]) + (8 + len(sid)).to_bytes(2, "little")
    payload = header + mask.to_bytes(4, "little") + sid
    return ctypes.create_string_buffer(payload, len(payload))


class _FakeWin32:
    """Simulates just enough of kernel32/advapi32 for _NativeWindowsSecurity.

    Keeps every buffer it hands out addresses to alive for the object's
    lifetime, so the test's own fakes don't reintroduce the dangling-pointer
    bug being verified against.
    """

    def __init__(self, *, service_sid: bytes, dacl_protected: bool, aces: list) -> None:
        self._keep_alive: list[ctypes.Array] = []
        self._service_sid_buffer = ctypes.create_string_buffer(
            service_sid, len(service_sid)
        )
        self._keep_alive.append(self._service_sid_buffer)
        self._dacl_protected = dacl_protected
        self._ace_buffers = [_build_ace(*ace) for ace in aces]
        self._keep_alive.extend(self._ace_buffers)
        self.owner_addr = ctypes.addressof(self._service_sid_buffer)
        self.dacl_addr = 0xD0000000
        self.descriptor_addr = 0xDE000000

    # kernel32
    def GetCurrentProcess(self) -> int:
        return -1

    def CloseHandle(self, handle: int) -> int:
        return 1

    def LocalFree(self, ptr: int) -> int:
        return 0

    # advapi32
    def OpenProcessToken(self, process, desired_access, token_out) -> int:
        ctypes.cast(token_out, ctypes.POINTER(ctypes.c_void_p))[0] = 1
        return 1

    def GetTokenInformation(self, token, info_class, buf, buf_len, required_out) -> int:
        if not buf:
            required_out_ptr = ctypes.cast(
                required_out, ctypes.POINTER(ctypes.c_uint32)
            )
            required_out_ptr[0] = 8
            return 0
        ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0] = self.owner_addr
        return 1

    def GetLengthSid(self, sid_ptr: int) -> int:
        return SID_LEN

    def CopySid(self, length: int, dest, src: int) -> int:
        ctypes.memmove(dest, src, length)
        return 1

    def EqualSid(self, a, b) -> int:
        addr_a = ctypes.cast(a, ctypes.c_void_p).value
        addr_b = ctypes.cast(b, ctypes.c_void_p).value
        return int(ctypes.string_at(addr_a, SID_LEN) == ctypes.string_at(addr_b, SID_LEN))

    def GetNamedSecurityInfoW(
        self, path, obj_type, info_flags, owner_out, group_out, dacl_out, sacl_out, descriptor_out
    ) -> int:
        ctypes.cast(owner_out, ctypes.POINTER(ctypes.c_void_p))[0] = self.owner_addr
        ctypes.cast(dacl_out, ctypes.POINTER(ctypes.c_void_p))[0] = self.dacl_addr
        ctypes.cast(descriptor_out, ctypes.POINTER(ctypes.c_void_p))[0] = (
            self.descriptor_addr
        )
        return 0

    def GetSecurityDescriptorControl(self, descriptor, control_out, revision_out) -> int:
        value = SE_DACL_PROTECTED if self._dacl_protected else 0
        ctypes.cast(control_out, ctypes.POINTER(ctypes.c_uint16))[0] = value
        return 1

    def GetAclInformation(self, dacl, info_out, info_len, info_class) -> int:
        ctypes.cast(info_out, ctypes.POINTER(ctypes.c_uint32))[0] = len(
            self._ace_buffers
        )
        return 1

    def GetAce(self, dacl, index, ace_out) -> int:
        if index >= len(self._ace_buffers):
            return 0
        ctypes.cast(ace_out, ctypes.POINTER(ctypes.c_void_p))[0] = ctypes.addressof(
            self._ace_buffers[index]
        )
        return 1


@pytest.fixture
def fake_dll(monkeypatch):
    holder: dict[str, _FakeWin32] = {}

    def _dll(name: str):
        return holder["fake"]

    monkeypatch.setattr(_NativeWindowsSecurity, "_dll", staticmethod(_dll))

    def _install(fake: _FakeWin32) -> _FakeWin32:
        holder["fake"] = fake
        return fake

    return _install


def test_protected_system_only_dacl_passes(fake_dll) -> None:
    fake_dll(
        _FakeWin32(
            service_sid=SERVICE_SID,
            dacl_protected=True,
            aces=[(ACCESS_ALLOWED_ACE_TYPE, 0x1F01FF, SERVICE_SID)],
        )
    )
    security = _NativeWindowsSecurity()
    path = __import__("pathlib").Path("C:/analytic/bridge/state")

    assert security.owner_is_current_service(path) is True
    assert security.dacl_allows_only_current_service(path) is True


def test_extra_administrators_allow_ace_fails(fake_dll) -> None:
    fake_dll(
        _FakeWin32(
            service_sid=SERVICE_SID,
            dacl_protected=True,
            aces=[
                (ACCESS_ALLOWED_ACE_TYPE, 0x1F01FF, SERVICE_SID),
                (ACCESS_ALLOWED_ACE_TYPE, 0x1F01FF, ADMIN_SID),
            ],
        )
    )
    security = _NativeWindowsSecurity()
    path = __import__("pathlib").Path("C:/analytic/bridge/state")

    assert security.owner_is_current_service(path) is True
    assert security.dacl_allows_only_current_service(path) is False


def test_unprotected_dacl_fails_closed(fake_dll) -> None:
    fake_dll(
        _FakeWin32(
            service_sid=SERVICE_SID,
            dacl_protected=False,
            aces=[(ACCESS_ALLOWED_ACE_TYPE, 0x1F01FF, SERVICE_SID)],
        )
    )
    security = _NativeWindowsSecurity()
    path = __import__("pathlib").Path("C:/analytic/bridge/state")

    assert security.dacl_allows_only_current_service(path) is False


def test_deny_ace_is_ignored_but_allow_ace_still_required(fake_dll) -> None:
    fake_dll(
        _FakeWin32(
            service_sid=SERVICE_SID,
            dacl_protected=True,
            aces=[
                (ACCESS_DENIED_ACE_TYPE, 0x1F01FF, ADMIN_SID),
                (ACCESS_ALLOWED_ACE_TYPE, 0x1F01FF, SERVICE_SID),
            ],
        )
    )
    security = _NativeWindowsSecurity()
    path = __import__("pathlib").Path("C:/analytic/bridge/state")

    assert security.dacl_allows_only_current_service(path) is True


def test_token_sid_returns_owned_bytes_surviving_further_calls(fake_dll) -> None:
    fake = fake_dll(
        _FakeWin32(service_sid=SERVICE_SID, dacl_protected=True, aces=[])
    )
    security = _NativeWindowsSecurity()

    sid = security._token_sid()
    assert isinstance(sid, bytes)
    assert sid == SERVICE_SID

    # Simulate further ctypes churn (like the real code does between
    # _token_sid() returning and its result being compared) and confirm the
    # returned bytes are unaffected, proving they are an independent copy
    # rather than a view into freed/reused memory.
    churn = [ctypes.create_string_buffer(b"\xff" * 64) for _ in range(50)]
    del churn
    assert sid == SERVICE_SID
