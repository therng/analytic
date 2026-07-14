from types import SimpleNamespace

from bridge_v2.terminal_discovery import discover_terminal_paths, discover_terminals, main


def _touch_shortcuts(startup_dir, names: list[str]) -> None:
    startup_dir.mkdir(parents=True, exist_ok=True)
    for name in names:
        (startup_dir / name).write_text("", encoding="utf-8")


def test_discover_terminals_filters_to_absolute_portable_terminal64_targets(tmp_path):
    _touch_shortcuts(
        tmp_path,
        [
            "mt1.lnk",
            "not-terminal.lnk",
            "substring-terminal.lnk",
            "missing-portable.lnk",
            "relative.lnk",
            "unapproved.lnk",
        ],
    )
    shortcuts = {
        "mt1.lnk": SimpleNamespace(
            path="C:\\MT1\\terminal64.exe",
            arguments="/portable",
        ),
        "not-terminal.lnk": SimpleNamespace(
            path="C:\\MT2\\terminal.exe",
            arguments="/portable",
        ),
        "substring-terminal.lnk": SimpleNamespace(
            path="C:\\MT3\\not-terminal64.exe",
            arguments="/portable",
        ),
        "missing-portable.lnk": SimpleNamespace(
            path="C:\\MT4\\terminal64.exe",
            arguments="/notportable",
        ),
        "relative.lnk": SimpleNamespace(
            path="MT5\\terminal64.exe",
            arguments="/portable",
        ),
        "unapproved.lnk": SimpleNamespace(
            path="C:\\MT5\\terminal64.exe",
            arguments="/portable",
        ),
    }

    result = discover_terminals(
        startup_dir=tmp_path,
        shortcut_reader=lambda path: shortcuts[path.replace("\\", "/").rsplit("/", 1)[-1]],
        rejected_shortcut_names={
            "terminal64.lnk",
            "unapproved.lnk",
        },
    )

    assert [terminal.path for terminal in result.terminals] == ["C:\\MT1\\terminal64.exe"]
    assert [skipped.reason for skipped in result.skipped] == [
        "missing /portable argument",
        "target is not terminal64.exe: C:\\MT2\\terminal.exe",
        "target is not absolute: MT5\\terminal64.exe",
        "target is not terminal64.exe: C:\\MT3\\not-terminal64.exe",
        "shortcut name rejected",
    ]


def test_discover_terminals_deduplicates_targets_case_insensitively(tmp_path):
    _touch_shortcuts(tmp_path, ["mt1.lnk", "mt3.lnk"])
    shortcuts = {
        "mt1.lnk": SimpleNamespace(
            path="C:\\MT1\\terminal64.exe",
            arguments="/portable",
        ),
        "mt3.lnk": SimpleNamespace(
            path="c:\\mt1\\TERMINAL64.EXE",
            arguments="/portable",
        ),
    }

    result = discover_terminals(
        startup_dir=tmp_path,
        shortcut_reader=lambda path: shortcuts[path.replace("\\", "/").rsplit("/", 1)[-1]],
    )

    assert [terminal.path for terminal in result.terminals] == ["C:\\MT1\\terminal64.exe"]
    assert result.skipped[0].reason == "duplicate terminal target: c:\\mt1\\TERMINAL64.EXE"


def test_discover_terminals_records_unreadable_shortcuts(tmp_path):
    _touch_shortcuts(tmp_path, ["mt1.lnk"])

    def broken_reader(_path):
        raise OSError("corrupt lnk")

    result = discover_terminals(startup_dir=tmp_path, shortcut_reader=broken_reader)

    assert result.terminals == []
    assert result.skipped[0].reason == "unreadable shortcut: corrupt lnk"


def test_discover_terminal_paths_preserves_supervisor_api(tmp_path):
    _touch_shortcuts(tmp_path, ["mt1.lnk"])

    paths = discover_terminal_paths(
        startup_dir=tmp_path,
        shortcut_reader=lambda _path: SimpleNamespace(
            path="C:\\MT1\\terminal64.exe",
            arguments="/portable",
        ),
    )

    assert paths == ["C:\\MT1\\terminal64.exe"]


def test_discover_terminal_paths_scans_multiple_startup_dirs(tmp_path):
    user_startup = tmp_path / "user"
    common_startup = tmp_path / "common"
    _touch_shortcuts(user_startup, ["mt1.lnk"])
    _touch_shortcuts(common_startup, ["mt3.lnk"])
    shortcuts = {
        "mt1.lnk": SimpleNamespace(
            path="C:\\MT1\\terminal64.exe",
            arguments="/portable",
        ),
        "mt3.lnk": SimpleNamespace(
            path="C:\\MT2\\terminal64.exe",
            arguments="/portable",
        ),
    }

    paths = discover_terminal_paths(
        startup_dirs=[user_startup, common_startup],
        shortcut_reader=lambda path: shortcuts[path.replace("\\", "/").rsplit("/", 1)[-1]],
    )

    assert paths == ["C:\\MT1\\terminal64.exe", "C:\\MT2\\terminal64.exe"]


def test_cli_returns_failure_when_no_terminals_found(tmp_path, capsys):
    missing_startup_dir = tmp_path / "Startup"

    exit_code = main(["--startup-dir", str(missing_startup_dir), "--verbose"])

    assert exit_code == 1
    assert "Found 0 portable MT5 terminal(s)" in capsys.readouterr().out


def test_default_startup_dirs_fallback_when_systemprofile(tmp_path, monkeypatch):
    # Mock APPDATA to simulate a system profile
    monkeypatch.setenv("APPDATA", "C:\\Windows\\system32\\config\\systemprofile\\AppData\\Roaming")

    # Mock SystemDrive to point to our tmp_path
    monkeypatch.setenv("SystemDrive", str(tmp_path))

    # Clear other override variables to ensure we trigger fallback
    monkeypatch.delenv("MT5_STARTUP_DIR", raising=False)
    monkeypatch.delenv("MT5_STARTUP_USER", raising=False)

    # Create the Users/username/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup folder structure
    startup_dir = tmp_path / "Users" / "john" / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    startup_dir.mkdir(parents=True, exist_ok=True)
    (startup_dir / "mt1.lnk").write_text("", encoding="utf-8")

    # Also create a system profile directory to ensure it is skipped
    system_dir = tmp_path / "Users" / "systemprofile" / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
    system_dir.mkdir(parents=True, exist_ok=True)
    (system_dir / "mt2.lnk").write_text("", encoding="utf-8")

    shortcuts = {
        "mt1.lnk": SimpleNamespace(
            path="C:\\MT1\\terminal64.exe",
            arguments="/portable",
        ),
        "mt2.lnk": SimpleNamespace(
            path="C:\\MT2\\terminal64.exe",
            arguments="/portable",
        ),
    }

    # Call discover_terminal_paths without specifying directories, so it uses _default_startup_dirs() fallback
    paths = discover_terminal_paths(
        shortcut_reader=lambda path: shortcuts[path.replace("\\", "/").rsplit("/", 1)[-1]]
    )

    # It should find mt1 from 'john' user and skip mt2 from 'systemprofile'
    assert paths == ["C:\\MT1\\terminal64.exe"]
