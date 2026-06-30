"""
Discover MT5 portable terminal paths from Windows Startup folder shortcuts.

Each .lnk shortcut must have /portable in its arguments to be included.
Returns sorted list of terminal64.exe absolute paths.
"""

import os
from pathlib import Path


def _default_startup_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA environment variable not set")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def discover_terminal_paths(startup_dir: Path | None = None) -> list[str]:
    try:
        import winshell  # type: ignore[import]
    except ImportError as e:
        raise ImportError("winshell not installed. Run: pip install winshell") from e

    if startup_dir is None:
        startup_dir = _default_startup_dir()

    paths: list[str] = []
    for lnk in startup_dir.glob("*.lnk"):
        try:
            sc = winshell.shortcut(str(lnk))
            exe: str = sc.path or ""
            args: str = sc.arguments or ""
            if "terminal64.exe" in exe.lower() and "/portable" in args.lower():
                paths.append(exe)
        except Exception:
            continue

    return sorted(paths)


if __name__ == "__main__":
    found = discover_terminal_paths()
    print(f"Found {len(found)} portable MT5 terminals:")
    for p in found:
        print(f"  {p}")
