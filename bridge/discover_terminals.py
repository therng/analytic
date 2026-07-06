r"""
Discover MT5 portable terminal paths from approved Windows Startup shortcuts.

By default, discovery scans only the current user's Startup folder under
AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup.
All .lnk names are considered except explicitly rejected shortcut names, and each
accepted shortcut must resolve to an absolute terminal64.exe path with /portable
in its shortcut arguments.
"""

import argparse
import json
import logging
import ntpath
import os
import re
import sys
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

log = logging.getLogger(__name__)

REJECTED_SHORTCUT_NAMES = {"terminal64.lnk"}
_PORTABLE_ARG_RE = re.compile(r"(^|\s)/portable(?=\s|$)", re.IGNORECASE)
_TERMINAL_EXE = "terminal64.exe"
_USER_STARTUP_PARTS = (
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
)


@dataclass(frozen=True)
class DiscoveredTerminal:
    shortcut: str
    path: str
    arguments: str


@dataclass(frozen=True)
class SkippedShortcut:
    shortcut: str
    reason: str


@dataclass(frozen=True)
class DiscoveryResult:
    startup_dirs: list[str]
    terminals: list[DiscoveredTerminal]
    skipped: list[SkippedShortcut]


def _user_startup_dir() -> Path | None:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    return Path(appdata).joinpath(*_USER_STARTUP_PARTS)




def _default_startup_dirs() -> list[Path]:
    user_startup = _user_startup_dir()
    if user_startup is None:
        return []
    return [user_startup]


def _dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    unique_paths: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = ntpath.normcase(ntpath.normpath(str(path)))
        if key in seen:
            continue
        seen.add(key)
        unique_paths.append(path)
    return unique_paths


def _load_winshell_shortcut_reader() -> Callable[[str], object]:
    try:
        import winshell  # type: ignore[import]
    except ImportError as e:
        raise ImportError("winshell not installed. Run: pip install winshell") from e

    return winshell.shortcut


def _is_terminal64_path(path: str) -> bool:
    return ntpath.basename(path).lower() == _TERMINAL_EXE


def _has_portable_arg(arguments: str) -> bool:
    return bool(_PORTABLE_ARG_RE.search(arguments))


def _dedupe_terminal_key(path: str) -> str:
    return ntpath.normcase(ntpath.normpath(path.strip()))


def discover_terminals(
    startup_dir: Path | None = None,
    startup_dirs: Iterable[Path] | None = None,
    shortcut_reader: Callable[[str], object] | None = None,
    rejected_shortcut_names: Iterable[str] = REJECTED_SHORTCUT_NAMES,
) -> DiscoveryResult:
    if startup_dir is not None and startup_dirs is not None:
        raise ValueError("Pass either startup_dir or startup_dirs, not both")

    if startup_dir is not None:
        resolved_startup_dirs = [startup_dir]
    elif startup_dirs is not None:
        resolved_startup_dirs = _dedupe_paths(startup_dirs)
    else:
        resolved_startup_dirs = _default_startup_dirs()

    existing_startup_dirs = _existing_startup_dirs(resolved_startup_dirs)
    if not existing_startup_dirs:
        return DiscoveryResult(
            startup_dirs=[str(path) for path in resolved_startup_dirs],
            terminals=[],
            skipped=[],
        )

    if shortcut_reader is None:
        shortcut_reader = _load_winshell_shortcut_reader()

    rejected_names = {name.lower() for name in rejected_shortcut_names}
    terminals: list[DiscoveredTerminal] = []
    skipped: list[SkippedShortcut] = []
    seen_paths: set[str] = set()

    for lnk in _iter_shortcuts(existing_startup_dirs):
        if lnk.name.lower() in rejected_names:
            skipped.append(
                SkippedShortcut(shortcut=str(lnk), reason="shortcut name rejected")
            )
            continue

        try:
            shortcut = shortcut_reader(str(lnk))
        except Exception as exc:
            reason = f"unreadable shortcut: {exc}"
            skipped.append(SkippedShortcut(shortcut=str(lnk), reason=reason))
            log.warning("Skipping %s: %s", lnk, reason)
            continue

        exe = str(getattr(shortcut, "path", "") or "").strip()
        args = str(getattr(shortcut, "arguments", "") or "").strip()
        skipped_reason = _validate_shortcut_target(exe, args)
        if skipped_reason is not None:
            skipped.append(SkippedShortcut(shortcut=str(lnk), reason=skipped_reason))
            continue

        key = _dedupe_terminal_key(exe)
        if key in seen_paths:
            skipped.append(
                SkippedShortcut(
                    shortcut=str(lnk),
                    reason=f"duplicate terminal target: {exe}",
                )
            )
            continue

        seen_paths.add(key)
        terminals.append(DiscoveredTerminal(shortcut=str(lnk), path=exe, arguments=args))

    terminals.sort(key=lambda terminal: _dedupe_terminal_key(terminal.path))
    return DiscoveryResult(
        startup_dirs=[str(path) for path in resolved_startup_dirs],
        terminals=terminals,
        skipped=skipped,
    )


def _validate_shortcut_target(exe: str, args: str) -> str | None:
    if not exe:
        return "missing shortcut target"
    if not _is_terminal64_path(exe):
        return f"target is not {_TERMINAL_EXE}: {exe}"
    if not ntpath.isabs(exe):
        return f"target is not absolute: {exe}"
    if not _has_portable_arg(args):
        return "missing /portable argument"
    return None


def _iter_shortcuts(startup_dirs: Iterable[Path]) -> Iterable[Path]:
    for startup_dir in startup_dirs:
        yield from sorted(startup_dir.glob("*.lnk"), key=lambda path: path.name.lower())


def _existing_startup_dirs(startup_dirs: Iterable[Path]) -> list[Path]:
    existing: list[Path] = []
    for startup_dir in startup_dirs:
        if startup_dir.exists():
            existing.append(startup_dir)
        else:
            log.warning("Startup folder does not exist: %s", startup_dir)
    return existing


def discover_terminal_paths(
    startup_dir: Path | None = None,
    startup_dirs: Iterable[Path] | None = None,
    shortcut_reader: Callable[[str], object] | None = None,
    rejected_shortcut_names: Iterable[str] = REJECTED_SHORTCUT_NAMES,
) -> list[str]:
    result = discover_terminals(
        startup_dir=startup_dir,
        startup_dirs=startup_dirs,
        shortcut_reader=shortcut_reader,
        rejected_shortcut_names=rejected_shortcut_names,
    )
    return [terminal.path for terminal in result.terminals]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Discover portable MT5 terminal64.exe shortcuts from Startup folders."
    )
    parser.add_argument(
        "--startup-dir",
        type=Path,
        action="append",
        help="Override the Windows Startup folder path. Repeat to scan many.",
    )
    parser.add_argument(
        "--reject-shortcut",
        action="append",
        dest="rejected_shortcut_names",
        help="Rejected .lnk filename. Repeat to override the production reject list.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print structured discovery details as JSON.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print skipped shortcut diagnostics.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s: %(message)s",
    )

    result = discover_terminals(
        startup_dirs=args.startup_dir,
        rejected_shortcut_names=args.rejected_shortcut_names
        or REJECTED_SHORTCUT_NAMES,
    )

    if args.json:
        print(json.dumps(asdict(result), indent=2))
        return 0 if result.terminals else 1

    print("Startup folder(s):")
    for startup_dir in result.startup_dirs:
        print(f"  {startup_dir}")
    print(f"Found {len(result.terminals)} portable MT5 terminal(s):")
    for terminal in result.terminals:
        print(f"  {terminal.path}")

    if args.verbose and result.skipped:
        print(f"\nSkipped {len(result.skipped)} shortcut(s):")
        for skipped in result.skipped:
            print(f"  {skipped.shortcut}: {skipped.reason}")

    return 0 if result.terminals else 1


if __name__ == "__main__":
    sys.exit(main())
