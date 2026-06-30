"""
Discover MT5 portable terminal paths from Windows Startup folder shortcuts.

Each .lnk shortcut must have /portable in its arguments to be included.
Returns sorted list of terminal64.exe absolute paths.
"""

from pathlib import Path


STARTUP_DIR = Path(
    r"C:\Users\supachai\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
)


def discover_terminal_paths(startup_dir: Path = STARTUP_DIR) -> list[str]:
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

    return sorted(paths)


if __name__ == "__main__":
    found = discover_terminal_paths()
    print(f"Found {len(found)} portable MT5 terminals:")
    for p in found:
        print(f"  {p}")
