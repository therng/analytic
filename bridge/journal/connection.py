from __future__ import annotations

import os
import sqlite3
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from bridge.config import JournalConfig
from bridge.journal.backup import (
    JournalCheckState,
    JournalRecoveryError,
    check_journal,
)
from bridge.journal.migrations import apply_migrations


class WindowsSecurity(Protocol):
    def owner_is_current_service(self, path: Path) -> bool: ...

    def dacl_allows_only_current_service(self, path: Path) -> bool: ...


class _NativeWindowsSecurity:
    """Minimal Win32 token/DACL verifier, loaded only on Windows."""

    @staticmethod
    def _dll(name: str) -> Any:
        import ctypes

        factory = getattr(ctypes, "WinDLL", None)
        if factory is None:
            raise OSError("Win32 security APIs are unavailable")
        library = factory(name, use_last_error=True)
        _NativeWindowsSecurity._bind_prototypes(name, library)
        return library

    @staticmethod
    def _bind_prototypes(name: str, library: Any) -> None:
        # Every function here returns/consumes pointer-sized values (HANDLE,
        # PSID, PACL, PSECURITY_DESCRIPTOR). Without explicit argtypes/restype,
        # ctypes assumes a 32-bit C int, which truncates pointers on 64-bit
        # Windows and can silently corrupt the handles/addresses below.
        import ctypes
        from ctypes import wintypes

        pvoid = ctypes.c_void_p
        if name == "kernel32":
            library.GetCurrentProcess.argtypes = []
            library.GetCurrentProcess.restype = wintypes.HANDLE
            library.CloseHandle.argtypes = [wintypes.HANDLE]
            library.CloseHandle.restype = wintypes.BOOL
            library.LocalFree.argtypes = [pvoid]
            library.LocalFree.restype = pvoid
        elif name == "advapi32":
            library.OpenProcessToken.argtypes = [
                wintypes.HANDLE,
                wintypes.DWORD,
                ctypes.POINTER(wintypes.HANDLE),
            ]
            library.OpenProcessToken.restype = wintypes.BOOL
            library.GetTokenInformation.argtypes = [
                wintypes.HANDLE,
                wintypes.DWORD,
                pvoid,
                wintypes.DWORD,
                ctypes.POINTER(wintypes.DWORD),
            ]
            library.GetTokenInformation.restype = wintypes.BOOL
            library.GetNamedSecurityInfoW.argtypes = [
                ctypes.c_wchar_p,
                wintypes.DWORD,
                wintypes.DWORD,
                ctypes.POINTER(pvoid),
                ctypes.POINTER(pvoid),
                ctypes.POINTER(pvoid),
                ctypes.POINTER(pvoid),
                ctypes.POINTER(pvoid),
            ]
            library.GetNamedSecurityInfoW.restype = wintypes.DWORD
            library.EqualSid.argtypes = [pvoid, pvoid]
            library.EqualSid.restype = wintypes.BOOL
            library.GetSecurityDescriptorControl.argtypes = [
                pvoid,
                ctypes.POINTER(wintypes.WORD),
                ctypes.POINTER(wintypes.DWORD),
            ]
            library.GetSecurityDescriptorControl.restype = wintypes.BOOL
            library.GetAclInformation.argtypes = [
                pvoid,
                pvoid,
                wintypes.DWORD,
                wintypes.DWORD,
            ]
            library.GetAclInformation.restype = wintypes.BOOL
            library.GetAce.argtypes = [pvoid, wintypes.DWORD, ctypes.POINTER(pvoid)]
            library.GetAce.restype = wintypes.BOOL
            library.GetLengthSid.argtypes = [pvoid]
            library.GetLengthSid.restype = wintypes.DWORD
            library.CopySid.argtypes = [wintypes.DWORD, pvoid, pvoid]
            library.CopySid.restype = wintypes.BOOL

    @staticmethod
    def _last_error() -> int:
        import ctypes

        return int(getattr(ctypes, "get_last_error", lambda: 0)())

    def _token_sid(self) -> bytes:
        import ctypes
        from ctypes import wintypes

        kernel32 = self._dll("kernel32")
        advapi32 = self._dll("advapi32")
        token = wintypes.HANDLE()
        if not advapi32.OpenProcessToken(
            kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)
        ):
            raise OSError(self._last_error(), "OpenProcessToken failed")
        try:
            required = wintypes.DWORD()
            advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(required))
            if required.value == 0:
                raise OSError(self._last_error(), "GetTokenInformation failed")
            info_buffer = ctypes.create_string_buffer(required.value)
            if not advapi32.GetTokenInformation(
                token, 1, info_buffer, required, ctypes.byref(required)
            ):
                raise OSError(self._last_error(), "GetTokenInformation failed")
            # TOKEN_USER.User.Sid is the struct's first pointer-sized field,
            # and it points *into* info_buffer -- it is not a separately
            # allocated SID. info_buffer goes out of scope (and can be
            # reused by the very next ctypes call) once this function
            # returns, so the SID must be copied into memory this object
            # owns (via CopySid) before that happens; returning the raw
            # pointer here previously handed callers a dangling address.
            sid_ptr = ctypes.cast(info_buffer, ctypes.POINTER(ctypes.c_void_p))[0]
            if not sid_ptr:
                raise OSError("TokenUser did not return a SID")
            length = advapi32.GetLengthSid(sid_ptr)
            if length <= 0:
                raise OSError(self._last_error(), "GetLengthSid failed")
            owned = ctypes.create_string_buffer(length)
            if not advapi32.CopySid(length, owned, sid_ptr):
                raise OSError(self._last_error(), "CopySid failed")
            return owned.raw[:length]
        finally:
            kernel32.CloseHandle(token)

    def _security_descriptor(self, path: Path) -> tuple[int, int, int]:
        import ctypes

        advapi32 = self._dll("advapi32")
        owner = ctypes.c_void_p()
        dacl = ctypes.c_void_p()
        descriptor = ctypes.c_void_p()
        status = advapi32.GetNamedSecurityInfoW(
            str(path),
            1,
            0x00000001 | 0x00000004,
            ctypes.byref(owner),
            None,
            ctypes.byref(dacl),
            None,
            ctypes.byref(descriptor),
        )
        if status != 0 or not descriptor.value or not owner.value or not dacl.value:
            raise OSError(status, "GetNamedSecurityInfoW failed")
        return owner.value, dacl.value, descriptor.value

    @staticmethod
    def _equal_sid(first: int | bytes, second: int | bytes) -> bool:
        import ctypes

        advapi32 = _NativeWindowsSecurity._dll("advapi32")

        def as_pointer(value: int | bytes) -> tuple[Any, ctypes.c_void_p]:
            if isinstance(value, bytes):
                # Own a live buffer for the duration of this call -- SID
                # bytes copied out via CopySid have no natural pointer of
                # their own until placed in ctypes-managed memory.
                buffer = ctypes.create_string_buffer(value, len(value))
                return buffer, ctypes.cast(buffer, ctypes.c_void_p)
            return None, ctypes.c_void_p(value)

        # keep_alive holds the two buffers so they aren't collected before
        # EqualSid runs; unused by name, only by reference.
        keep_alive_first, first_ptr = as_pointer(first)
        keep_alive_second, second_ptr = as_pointer(second)
        return bool(advapi32.EqualSid(first_ptr, second_ptr))

    def owner_is_current_service(self, path: Path) -> bool:
        import ctypes

        owner, _, descriptor = self._security_descriptor(path)
        try:
            return self._equal_sid(owner, self._token_sid())
        finally:
            self._dll("kernel32").LocalFree(ctypes.c_void_p(descriptor))

    def dacl_allows_only_current_service(self, path: Path) -> bool:
        import ctypes
        from ctypes import wintypes

        _owner, dacl, descriptor = self._security_descriptor(path)
        try:
            control = wintypes.WORD()
            revision = wintypes.DWORD()
            advapi32 = self._dll("advapi32")
            if not advapi32.GetSecurityDescriptorControl(
                ctypes.c_void_p(descriptor),
                ctypes.byref(control),
                ctypes.byref(revision),
            ):
                return False
            if not control.value & 0x1000:  # SE_DACL_PROTECTED
                return False

            class AclSizeInformation(ctypes.Structure):
                _fields_ = [
                    ("AceCount", wintypes.DWORD),
                    ("AclBytesInUse", wintypes.DWORD),
                    ("AclBytesFree", wintypes.DWORD),
                ]

            info = AclSizeInformation()
            if not advapi32.GetAclInformation(
                ctypes.c_void_p(dacl), ctypes.byref(info), ctypes.sizeof(info), 2
            ):
                return False
            service_sid = self._token_sid()
            for index in range(info.AceCount):
                ace = ctypes.c_void_p()
                if not advapi32.GetAce(ctypes.c_void_p(dacl), index, ctypes.byref(ace)):
                    return False
                header = ctypes.string_at(ace, 8)
                ace_type = header[0]
                access_mask = int.from_bytes(header[4:8], "little")
                if access_mask == 0:
                    continue
                if ace_type == 1:  # ACCESS_DENIED_ACE_TYPE grants no access.
                    continue
                if ace_type != 0:  # Unknown/object ACE layout is not safe to infer.
                    return False
                if ace.value is None:
                    return False
                sid = int(ace.value) + 8
                if not self._equal_sid(sid, service_sid):
                    return False
            return True
        finally:
            self._dll("kernel32").LocalFree(ctypes.c_void_p(descriptor))


def _is_reparse_point(path: Path) -> bool:
    metadata = path.lstat()
    attributes = getattr(metadata, "st_file_attributes", 0)
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def _reject_linked_component(path: Path) -> None:
    if path.is_symlink() or _is_reparse_point(path):
        raise ValueError("journal path must not contain a symlink or reparse point")


def _validate_posix_acl(path: Path) -> None:
    service_uid = os.geteuid()
    for target in (path.parent, path) if path.exists() else (path.parent,):
        metadata = target.stat()
        mode = stat.S_IMODE(metadata.st_mode)
        if metadata.st_uid != service_uid:
            raise ValueError("journal path must be owned by the service identity")
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise ValueError("journal path must be restricted to the service identity")


def _validate_windows_acl(path: Path, security: WindowsSecurity | None = None) -> None:
    verifier = security if security is not None else _NativeWindowsSecurity()
    for target in (path.parent, path) if path.exists() else (path.parent,):
        try:
            secure = verifier.owner_is_current_service(
                target
            ) and verifier.dacl_allows_only_current_service(target)
        except (AttributeError, OSError):
            secure = False
        if not secure:
            raise ValueError("journal path must be restricted to the service identity")


def _validate_acl(path: Path) -> None:
    if os.name == "posix":
        _validate_posix_acl(path)
        return
    if os.name == "nt":
        _validate_windows_acl(path)
        return
    raise ValueError("journal ACL evidence is unavailable on this platform")


def _validate_journal_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("journal path must be absolute")
    for component in (path, *path.parents):
        if component.exists() or component.is_symlink():
            _reject_linked_component(component)
    parent = path.parent
    if not parent.is_dir():
        raise ValueError("journal parent must be a real directory")
    canonical_parent = parent.resolve(strict=True)
    canonical_path = canonical_parent / path.name
    if path.exists() and not path.is_file():
        raise ValueError("journal path must be a regular file")
    _validate_acl(canonical_path)
    return canonical_path


def _configure_connection(connection: sqlite3.Connection, busy_timeout_ms: int) -> None:
    effective_mode = str(connection.execute("PRAGMA journal_mode = WAL").fetchone()[0])
    connection.execute("PRAGMA synchronous = FULL")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
    connection.execute("PRAGMA trusted_schema = OFF")
    effective = {
        "journal_mode": effective_mode.casefold(),
        "synchronous": int(connection.execute("PRAGMA synchronous").fetchone()[0]),
        "foreign_keys": int(connection.execute("PRAGMA foreign_keys").fetchone()[0]),
        "busy_timeout": int(connection.execute("PRAGMA busy_timeout").fetchone()[0]),
        "trusted_schema": int(
            connection.execute("PRAGMA trusted_schema").fetchone()[0]
        ),
    }
    required = {
        "journal_mode": "wal",
        "synchronous": 2,
        "foreign_keys": 1,
        "busy_timeout": busy_timeout_ms,
        "trusted_schema": 0,
    }
    if effective != required:
        raise RuntimeError("journal durability pragmas were not accepted")


@dataclass
class Journal:
    connection: sqlite3.Connection
    path: Path
    _busy_timeout_ms: int = 5_000

    @classmethod
    def open(cls, config: JournalConfig) -> Journal:
        path = _validate_journal_path(config.path)
        recovery = check_journal(path, config.expected_host)
        if recovery.state not in {
            JournalCheckState.MISSING_NEW,
            JournalCheckState.READY,
        }:
            raise JournalRecoveryError(
                f"journal recovery state is {recovery.state}"
            )
        connection = sqlite3.connect(path, isolation_level=None)
        try:
            _configure_connection(connection, config.busy_timeout_ms)
            apply_migrations(connection)
            return cls(
                connection=connection,
                path=path,
                _busy_timeout_ms=config.busy_timeout_ms,
            )
        except BaseException:
            connection.close()
            raise

    def close(self) -> None:
        self.connection.close()

    def open_secondary_connection(self) -> sqlite3.Connection:
        """Open a dispatcher-owned connection to this journal file.

        The worker creates this connection before starting the outbox
        dispatcher, then transfers it to that single dispatcher thread.
        ``check_same_thread=False`` is intentional for that handoff; no
        other thread may use this connection.
        """
        connection = sqlite3.connect(
            self.path, isolation_level=None, check_same_thread=False
        )
        try:
            _configure_connection(connection, self._busy_timeout_ms)
            return connection
        except BaseException:
            connection.close()
            raise
