from __future__ import annotations

from bridge.__main__ import main


def test_main_fails_fast_without_redis_url(monkeypatch, capsys) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)

    exit_code = main()

    assert exit_code == 1
    assert "REDIS_URL is required" in capsys.readouterr().err
