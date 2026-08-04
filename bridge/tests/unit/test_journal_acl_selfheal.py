from __future__ import annotations

from pathlib import Path

from bridge.__main__ import _ensure_windows_journal_acl


def test_noop_on_posix(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("os.name", "posix")
    _ensure_windows_journal_acl(tmp_path)
    assert not (tmp_path / "journal").exists()


def test_reapplies_icacls_on_windows(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("os.name", "nt")
    monkeypatch.setenv("USERNAME", "supachai")
    calls = []
    monkeypatch.setattr(
        "subprocess.run",
        lambda args, **kwargs: calls.append(args),
    )

    _ensure_windows_journal_acl(tmp_path)

    journal_dir = tmp_path / "journal"
    assert journal_dir.is_dir()
    assert calls[0] == [
        "icacls",
        str(journal_dir),
        "/inheritance:r",
        "/grant:r",
        "supachai:(OI)(CI)F",
    ]
    assert calls[1] == ["icacls", str(journal_dir), "/setowner", "supachai"]


def test_missing_username_skips_icacls(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("os.name", "nt")
    monkeypatch.delenv("USERNAME", raising=False)
    called = []
    monkeypatch.setattr("subprocess.run", lambda *a, **k: called.append(a))

    _ensure_windows_journal_acl(tmp_path)

    assert called == []
