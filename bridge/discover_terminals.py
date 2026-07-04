"""
Discover MT5 portable terminal paths.

Startup-folder .lnk shortcuts remain the primary source; each shortcut must
have /portable in its arguments to be included. When NSSM or another service
context cannot see those shortcuts, discovery also checks explicit glob
patterns from MT5_TERMINAL_GLOB and known portable MT5 install locations.
Returns sorted, deduplicated terminal64.exe absolute paths.
"""

import glob
import os
from pathlib import Path


FALLBACK_TERMINAL_GLOBS = [
    r"C:\MT*\terminal64.exe",
    r"C:\MetaTrader*\terminal64.exe",
    r"C:\Users\*\Desktop\MT*\terminal64.exe",
]


def _default_startup_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise RuntimeError("APPDATA environment variable not set")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


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


def _env_terminal_globs() -> list[str]:
    raw = os.environ.get("MT5_TERMINAL_GLOB", "")
    return [pattern.strip() for pattern in raw.split(";") if pattern.strip()]


def _discover_startup_shortcuts(startup_dir: Path) -> list[str]:
    try:
        import winshell  # type: ignore[import]
    except ImportError as e:
        raise ImportError("winshell not installed. Run: pip install winshell") from e

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

    return paths


def _discover_glob_paths(patterns: list[str]) -> list[str]:
    paths: list[str] = []
    for pattern in patterns:
        paths.extend(glob.glob(pattern))
    return [path for path in paths if Path(path).name.lower() == "terminal64.exe"]


def discover_terminal_paths(startup_dir: Path | None = None) -> list[str]:
    paths: list[str] = []

    try:
        paths.extend(_discover_startup_shortcuts(startup_dir or _default_startup_dir()))
    except Exception:
        pass

    paths.extend(_discover_glob_paths(_env_terminal_globs()))
    paths.extend(_discover_glob_paths(FALLBACK_TERMINAL_GLOBS))

    return _dedupe_paths(paths)


if __name__ == "__main__":
    found = discover_terminal_paths()
    print(f"Found {len(found)} portable MT5 terminals:")
    for p in found:
        print(f"  {p}")
