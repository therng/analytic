"""
Discover MT5 portable terminal paths from approved Windows Startup shortcuts.

Only approved .lnk names in the configured Startup folders are considered.
Each accepted shortcut must resolve to terminal64.exe and include /portable
in its arguments.
Returns sorted, deduplicated terminal64.exe absolute paths.
"""

import os
from pathlib import Path


STARTUP_DIRS = [
    Path(r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"),
    Path(r"C:\Users\supachai\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"),
]

ACCEPTED_SHORTCUT_NAMES = {"mt1.lnk", "mt3.lnk", "mt7.lnk", "mt20.lnk"}


def _dedupe_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for path in paths:
        normalized = os.path.abspath(os.path.normpath(path))
        key = os.path.normcase(normalized)
        if key in seen:
            continue
        seen.add(key)
        unique.append(normalized)
    return sorted(unique, key=str.lower)


def _discover_startup_shortcuts(startup_dir: Path) -> list[str]:
    try:
        import winshell  # type: ignore[import]
    except ImportError as e:
        raise ImportError("winshell not installed. Run: pip install winshell") from e

    paths: list[str] = []
    for lnk in startup_dir.glob("*.lnk"):
        if lnk.name.lower() not in ACCEPTED_SHORTCUT_NAMES:
            continue
        try:
            sc = winshell.shortcut(str(lnk))
            exe: str = sc.path or ""
            args: str = sc.arguments or ""
            if Path(exe).name.lower() == "terminal64.exe" and "/portable" in args.lower():
                paths.append(exe)
        except Exception:
            continue

    return paths


def discover_terminal_paths(startup_dir: Path | None = None) -> list[str]:
    paths: list[str] = []
    startup_dirs = [startup_dir] if startup_dir is not None else STARTUP_DIRS

    for directory in startup_dirs:
        try:
            paths.extend(_discover_startup_shortcuts(directory))
        except Exception:
            continue

    return _dedupe_paths(paths)


if __name__ == "__main__":
    found = discover_terminal_paths()
    print(f"Found {len(found)} portable MT5 terminals:")
    for p in found:
        print(f"  {p}")
