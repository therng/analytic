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
        "/T",
    ]
    # No sidecar files exist yet in a fresh journal_dir, so no per-file
    # grant calls -- setowner is the next (and last) call.
    assert calls[1] == ["icacls", str(journal_dir), "/setowner", "supachai", "/T"]
    assert len(calls) == 2


def test_grants_existing_sidecar_files_explicitly(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("os.name", "nt")
    monkeypatch.setenv("USERNAME", "supachai")
    journal_dir = tmp_path / "journal"
    journal_dir.mkdir(parents=True)
    wal = journal_dir / "7950622.sqlite3-wal"
    shm = journal_dir / "7950622.sqlite3-shm"
    main_db = journal_dir / "7950622.sqlite3"
    for f in (main_db, wal, shm):
        f.write_bytes(b"")

    calls = []
    monkeypatch.setattr(
        "subprocess.run",
        lambda args, **kwargs: calls.append(args),
    )

    _ensure_windows_journal_acl(tmp_path)

    # directory grant, then one explicit per-file grant per sidecar
    # (sorted), then setowner -- a file-level failure must not skip the
    # remaining files or the final setowner call.
    file_grant_calls = [c for c in calls if c[1] in {str(main_db), str(shm), str(wal)}]
    assert len(file_grant_calls) == 3
    for call in file_grant_calls:
        assert call[0] == "icacls"
        assert call[2:] == ["/inheritance:r", "/grant:r", "supachai:F"]
    assert calls[0][1] == str(journal_dir)
    assert calls[-1] == ["icacls", str(journal_dir), "/setowner", "supachai", "/T"]


def test_file_grant_failure_does_not_block_remaining_files_or_setowner(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr("os.name", "nt")
    monkeypatch.setenv("USERNAME", "supachai")
    journal_dir = tmp_path / "journal"
    journal_dir.mkdir(parents=True)
    wal = journal_dir / "a.sqlite3-wal"
    shm = journal_dir / "a.sqlite3-shm"
    wal.write_bytes(b"")
    shm.write_bytes(b"")

    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[1] == str(wal):
            raise RuntimeError("access denied")
        return None

    monkeypatch.setattr("subprocess.run", fake_run)

    _ensure_windows_journal_acl(tmp_path)

    # shm grant and the final setowner still ran despite the wal failure.
    assert any(c[1] == str(shm) for c in calls)
    assert calls[-1] == ["icacls", str(journal_dir), "/setowner", "supachai", "/T"]


def test_missing_username_skips_icacls(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("os.name", "nt")
    monkeypatch.delenv("USERNAME", raising=False)
    called = []
    monkeypatch.setattr("subprocess.run", lambda *a, **k: called.append(a))

    _ensure_windows_journal_acl(tmp_path)

    assert called == []
