from __future__ import annotations

import json
from pathlib import Path

from bridge import worker
from bridge.exit_codes import WorkerExitCode


def test_write_last_exit_creates_file(tmp_path: Path) -> None:
    worker._write_last_exit(tmp_path, "40001", 10, "REDIS_URL is required")
    data = json.loads((tmp_path / "last_exit" / "40001.json").read_text())
    assert data == {"exit_code": 10, "detail": "REDIS_URL is required"}


def test_main_missing_redis_url_writes_last_exit_keyed_by_config_stem(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("BRIDGE_STATE_DIR", str(tmp_path))
    config_path = tmp_path / "40001.json"
    config_path.write_text("{}", encoding="utf-8")

    exit_code = worker.main([str(config_path)])

    assert exit_code == int(WorkerExitCode.CONFIG_INVALID)
    data = json.loads((tmp_path / "last_exit" / "40001.json").read_text())
    assert data["exit_code"] == int(WorkerExitCode.CONFIG_INVALID)
    assert data["detail"] == "REDIS_URL is required"
