from __future__ import annotations

import sys
from collections import defaultdict
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PureWindowsPath
from typing import Protocol


class PathValidationError(ValueError):
    pass


class PathNotFoundError(ValueError):
    pass


_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_FORBIDDEN_CHARS = set('<>"|?*')


def _validate_component(component: str) -> None:
    if not component:
        return
    stem = component.split(".", 1)[0].upper()
    if stem in _RESERVED_NAMES:
        raise PathValidationError(
            f"reserved Windows device name in path component: {component!r}"
        )
    if component != component.rstrip(" ."):
        raise PathValidationError(
            f"path component has a trailing dot or space: {component!r}"
        )
    if any(char in _FORBIDDEN_CHARS for char in component):
        raise PathValidationError(
            f"path component contains a forbidden character: {component!r}"
        )


class PathResolution(StrEnum):
    RESOLVED = "resolved"
    UNRESOLVED_ACL_RESTRICTED = "unresolved-acl-restricted"
    UNRESOLVED_NOT_WINDOWS = "unresolved-not-windows"


@dataclass(frozen=True)
class CanonicalPath:
    raw: str
    normalized: str
    casefold_key: str
    resolution: PathResolution
    resolved_path: str | None


class FinalPathResolver(Protocol):
    def __call__(self, normalized: str) -> tuple[str | None, PathResolution]: ...


def _win32_final_path(normalized: str) -> str:
    # Deferred import: ctypes.windll only exists on Windows. Same FFI style
    # already used by bridge/journal/connection.py's _NativeWindowsSecurity.
    import ctypes

    FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    OPEN_EXISTING = 3
    GENERIC_READ = 0x80000000
    FILE_SHARE_READ = 0x00000001
    FILE_SHARE_WRITE = 0x00000002
    FILE_SHARE_DELETE = 0x00000004
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    handle = kernel32.CreateFileW(
        normalized,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        None,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
        None,
    )
    if handle in (0, INVALID_HANDLE_VALUE):
        raise OSError(ctypes.get_last_error(), "CreateFileW failed")
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        length = kernel32.GetFinalPathNameByHandleW(handle, buffer, 32768, 0)
        if length == 0:
            raise OSError(ctypes.get_last_error(), "GetFinalPathNameByHandleW failed")
        return buffer.value
    finally:
        kernel32.CloseHandle(handle)


def _default_resolve_final_path(normalized: str) -> tuple[str | None, PathResolution]:
    if sys.platform != "win32":
        return None, PathResolution.UNRESOLVED_NOT_WINDOWS
    try:
        return _win32_final_path(normalized), PathResolution.RESOLVED
    except OSError:
        return None, PathResolution.UNRESOLVED_ACL_RESTRICTED


def canonicalize(
    raw: str, *, resolve_final_path: FinalPathResolver | None = None
) -> CanonicalPath:
    """Validate and canonicalize a configured Windows path.

    Resolves junctions/symlinks/substituted drives via
    GetFinalPathNameByHandleW where possible (Windows only, and only when the
    caller can open a handle to the path at all — an ACL-restricted path
    falls back to the non-resolved casefolded form rather than failing hard,
    since ARCHITECTURE.md already expects some paths to be ACL-restricted to
    the service identity by design).
    """
    path = PureWindowsPath(raw)
    if not path.is_absolute():
        raise PathValidationError(f"path must be absolute: {raw!r}")
    for part in path.parts[1:]:
        _validate_component(part)

    normalized = str(path)
    resolver = resolve_final_path or _default_resolve_final_path
    resolved_path, resolution = resolver(normalized)
    casefold_key = (resolved_path or normalized).casefold()
    return CanonicalPath(
        raw=raw,
        normalized=normalized,
        casefold_key=casefold_key,
        resolution=resolution,
        resolved_path=resolved_path,
    )


class PathKind(StrEnum):
    FILE = "file"
    DIRECTORY = "directory"
    PARENT_DIRECTORY = "parent_directory"


class PathOps(Protocol):
    def exists(self, path: str) -> bool: ...

    def is_file(self, path: str) -> bool: ...

    def is_dir(self, path: str) -> bool: ...


class _DefaultPathOps:
    @staticmethod
    def exists(path: str) -> bool:
        from pathlib import Path

        return Path(path).exists()

    @staticmethod
    def is_file(path: str) -> bool:
        from pathlib import Path

        return Path(path).is_file()

    @staticmethod
    def is_dir(path: str) -> bool:
        from pathlib import Path

        return Path(path).is_dir()


def check_path_exists(
    canonical: CanonicalPath, kind: PathKind, *, path_ops: PathOps | None = None
) -> None:
    ops = path_ops or _DefaultPathOps()
    check_target = canonical.resolved_path or canonical.normalized
    if kind is PathKind.FILE:
        if not ops.exists(check_target):
            raise PathNotFoundError(f"required file does not exist: {canonical.raw!r}")
        if not ops.is_file(check_target):
            raise PathNotFoundError(f"required path is not a file: {canonical.raw!r}")
    elif kind is PathKind.DIRECTORY:
        if not ops.exists(check_target):
            raise PathNotFoundError(
                f"required directory does not exist: {canonical.raw!r}"
            )
        if not ops.is_dir(check_target):
            raise PathNotFoundError(
                f"required path is not a directory: {canonical.raw!r}"
            )
    elif kind is PathKind.PARENT_DIRECTORY:
        parent = str(PureWindowsPath(canonical.normalized).parent)
        if not ops.exists(parent) or not ops.is_dir(parent):
            raise PathNotFoundError(
                f"parent directory does not exist: {canonical.raw!r}"
            )


def find_duplicate_groups(paths: list[CanonicalPath]) -> list[list[int]]:
    """Group indices of `paths` whose canonical casefold_key collides.
    Returns only groups with 2+ members; singletons are omitted."""
    buckets: dict[str, list[int]] = defaultdict(list)
    for index, canonical in enumerate(paths):
        buckets[canonical.casefold_key].append(index)
    return [indices for indices in buckets.values() if len(indices) > 1]
