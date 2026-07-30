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
        return factory(name, use_last_error=True)

    @staticmethod
    def _last_error() -> int:
        import ctypes

        return int(getattr(ctypes, "get_last_error", lambda: 0)())

    def _token_sid(self) -> int:
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
            buffer = ctypes.create_string_buffer(required.value)
            if not advapi32.GetTokenInformation(
                token, 1, buffer, required, ctypes.byref(required)
            ):
                raise OSError(self._last_error(), "GetTokenInformation failed")
            sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
            if sid is None:
                raise OSError("TokenUser did not return a SID")
            return int(sid)
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
    def _equal_sid(first: int, second: int) -> bool:
        import ctypes

        advapi32 = _NativeWindowsSecurity._dll("advapi32")
        return bool(advapi32.EqualSid(ctypes.c_void_p(first), ctypes.c_void_p(second)))

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
            return cls(connection=connection, path=path)
        except BaseException:
            connection.close()
            raise

    def close(self) -> None:
        self.connection.close()
