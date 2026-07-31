from __future__ import annotations

import pytest

from bridge.paths import (
    CanonicalPath,
    PathKind,
    PathNotFoundError,
    PathResolution,
    PathValidationError,
    canonicalize,
    check_path_exists,
    find_duplicate_groups,
)


def _no_resolution(normalized: str) -> tuple[str | None, PathResolution]:
    return None, PathResolution.UNRESOLVED_NOT_WINDOWS


def _resolve_to(target: str):
    def _resolver(normalized: str) -> tuple[str | None, PathResolution]:
        return target, PathResolution.RESOLVED

    return _resolver


def test_relative_path_rejected():
    with pytest.raises(PathValidationError):
        canonicalize(r"relative\path", resolve_final_path=_no_resolution)


@pytest.mark.parametrize("reserved", ["CON", "con.txt", "PRN", "COM1", "lpt9.log"])
def test_reserved_device_name_rejected(reserved: str):
    with pytest.raises(PathValidationError):
        canonicalize(rf"C:\accounts\{reserved}", resolve_final_path=_no_resolution)


@pytest.mark.parametrize("bad_component", ["trailing. ", "trailing.", "trailing "])
def test_trailing_dot_or_space_rejected(bad_component: str):
    with pytest.raises(PathValidationError):
        canonicalize(rf"C:\accounts\{bad_component}", resolve_final_path=_no_resolution)


@pytest.mark.parametrize("char", ['"', "<", ">", "|", "?", "*"])
def test_forbidden_character_rejected(char: str):
    with pytest.raises(PathValidationError):
        canonicalize(rf"C:\accounts\bad{char}name", resolve_final_path=_no_resolution)


def test_valid_path_canonicalizes_without_resolution_off_windows():
    result = canonicalize(r"C:\MT5\terminal64.exe", resolve_final_path=_no_resolution)
    assert isinstance(result, CanonicalPath)
    assert result.resolution is PathResolution.UNRESOLVED_NOT_WINDOWS
    assert result.resolved_path is None
    assert result.casefold_key == r"c:\mt5\terminal64.exe"


def test_case_insensitive_casefold_key():
    a = canonicalize(r"C:\MT5\Terminal64.exe", resolve_final_path=_no_resolution)
    b = canonicalize(r"c:\mt5\terminal64.exe", resolve_final_path=_no_resolution)
    assert a.casefold_key == b.casefold_key


def test_resolved_path_used_for_casefold_key_when_available():
    result = canonicalize(
        r"C:\Junction\terminal64.exe",
        resolve_final_path=_resolve_to(r"\\?\C:\Real\terminal64.exe"),
    )
    assert result.resolution is PathResolution.RESOLVED
    assert result.casefold_key == r"\\?\c:\real\terminal64.exe"


def test_two_paths_resolving_to_same_target_are_duplicates_via_junction():
    a = canonicalize(
        r"C:\Junction\terminal64.exe",
        resolve_final_path=_resolve_to(r"\\?\C:\Real\terminal64.exe"),
    )
    b = canonicalize(
        r"C:\Real\terminal64.exe",
        resolve_final_path=_resolve_to(r"\\?\C:\Real\terminal64.exe"),
    )
    groups = find_duplicate_groups([a, b])
    assert groups == [[0, 1]]


def test_raw_string_duplicate_but_not_resolved_is_not_flagged_without_resolution():
    # Without a resolver able to see through indirection, two genuinely
    # different raw strings pointing at the same real file are NOT caught —
    # this documents the resolver's necessity rather than papering over it.
    a = canonicalize(r"C:\Junction\terminal64.exe", resolve_final_path=_no_resolution)
    b = canonicalize(r"C:\Real\terminal64.exe", resolve_final_path=_no_resolution)
    assert find_duplicate_groups([a, b]) == []


def test_find_duplicate_groups_ignores_singletons():
    a = canonicalize(r"C:\One\terminal64.exe", resolve_final_path=_no_resolution)
    b = canonicalize(r"C:\Two\terminal64.exe", resolve_final_path=_no_resolution)
    assert find_duplicate_groups([a, b]) == []


class _FakePathOps:
    def __init__(self, files: set[str], dirs: set[str]) -> None:
        self._files = {f.casefold() for f in files}
        self._dirs = {d.casefold() for d in dirs}

    def exists(self, path: str) -> bool:
        key = path.casefold()
        return key in self._files or key in self._dirs

    def is_file(self, path: str) -> bool:
        return path.casefold() in self._files

    def is_dir(self, path: str) -> bool:
        return path.casefold() in self._dirs


def test_check_path_exists_file_present():
    canonical = canonicalize(r"C:\MT5\terminal64.exe", resolve_final_path=_no_resolution)
    ops = _FakePathOps(files={r"C:\MT5\terminal64.exe"}, dirs=set())
    check_path_exists(canonical, PathKind.FILE, path_ops=ops)


def test_check_path_exists_file_missing_raises():
    canonical = canonicalize(r"C:\MT5\terminal64.exe", resolve_final_path=_no_resolution)
    ops = _FakePathOps(files=set(), dirs=set())
    with pytest.raises(PathNotFoundError):
        check_path_exists(canonical, PathKind.FILE, path_ops=ops)


def test_check_path_exists_file_that_is_actually_a_directory_raises():
    canonical = canonicalize(r"C:\MT5\terminal64.exe", resolve_final_path=_no_resolution)
    ops = _FakePathOps(files=set(), dirs={r"C:\MT5\terminal64.exe"})
    with pytest.raises(PathNotFoundError):
        check_path_exists(canonical, PathKind.FILE, path_ops=ops)


def test_check_path_exists_directory_present():
    canonical = canonicalize(r"C:\MT5\Data", resolve_final_path=_no_resolution)
    ops = _FakePathOps(files=set(), dirs={r"C:\MT5\Data"})
    check_path_exists(canonical, PathKind.DIRECTORY, path_ops=ops)


def test_check_path_exists_parent_directory_present():
    canonical = canonicalize(
        r"C:\Journal\account.sqlite", resolve_final_path=_no_resolution
    )
    ops = _FakePathOps(files=set(), dirs={r"C:\Journal"})
    check_path_exists(canonical, PathKind.PARENT_DIRECTORY, path_ops=ops)


def test_check_path_exists_parent_directory_missing_raises():
    canonical = canonicalize(
        r"C:\Journal\account.sqlite", resolve_final_path=_no_resolution
    )
    ops = _FakePathOps(files=set(), dirs=set())
    with pytest.raises(PathNotFoundError):
        check_path_exists(canonical, PathKind.PARENT_DIRECTORY, path_ops=ops)
