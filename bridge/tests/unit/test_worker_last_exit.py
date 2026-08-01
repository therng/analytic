from __future__ import annotations

import json
from pathlib import Path

from bridge import worker
from bridge.exit_codes import WorkerExitCode


def test_write_last_exit_creates_file(tmp_path: Path) -> None:
    worker._write_last_exit(
        tmp_path, "40001", 10, "REDIS_URL is required", worker_pid=4242
    )
    data = json.loads((tmp_path / "last_exit" / "40001.json").read_text())
    assert data == {
        "exit_code": 10,
        "detail": "REDIS_URL is required",
        "worker_pid": 4242,
    }


def test_main_without_config_logs_unavailable_exit_context(capsys) -> None:
    exit_code = worker.main([])

    assert exit_code == int(WorkerExitCode.CONFIG_INVALID)
    stderr = capsys.readouterr().err
    assert "login=unavailable" in stderr
    assert "profile_path=unavailable" in stderr
    assert "terminal_path=unavailable" in stderr
    assert "terminal_pid=unavailable" in stderr
    assert "classification=CONFIG_INVALID" in stderr
    assert "reason=usage: python -m bridge.worker <account-config-path>" in stderr


def test_main_missing_redis_url_writes_last_exit_keyed_by_config_stem(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("BRIDGE_STATE_DIR", str(tmp_path))
    config_path = tmp_path / "40001.json"
    config_path.write_text(
        json.dumps(
            {
                "executable_path": "C:\\MT5-A\\terminal64.exe",
                "portable": True,
                "expected_data_path": "C:\\MT5-A\\data",
                "expected_login": 40001,
                "expected_server": "Broker-Demo",
                "initialize_timeout_ms": 10000,
                "coordination_domain": "default",
                "history_lower_bound_raw": 0,
                "journal_path": "C:\\bridge\\40001.sqlite3",
            }
        ),
        encoding="utf-8",
    )

    exit_code = worker.main([str(config_path)])

    assert exit_code == int(WorkerExitCode.CONFIG_INVALID)
    data = json.loads((tmp_path / "last_exit" / "40001.json").read_text())
    assert data["exit_code"] == int(WorkerExitCode.CONFIG_INVALID)
    assert data["detail"] == "REDIS_URL is required"
    stderr = capsys.readouterr().err
    assert "login=40001" in stderr
    assert "profile_path=C:\\MT5-A\\data" in stderr
    assert "terminal_path=C:\\MT5-A\\terminal64.exe" in stderr
    assert "terminal_pid=unavailable" in stderr
    assert "classification=CONFIG_INVALID" in stderr
    assert "reason=REDIS_URL is required" in stderr
