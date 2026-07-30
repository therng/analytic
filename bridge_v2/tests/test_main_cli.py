"""CLI contract for bridge_v2.main."""

from unittest.mock import patch

import pytest

from bridge_v2.main import main


def test_missing_broker_utc_offset_minutes_defaults_to_180():
    with patch("bridge_v2.main.run") as run:
        main(["--terminal-path", r"C:\MT7\terminal64.exe"])
    run.assert_called_once_with(
        r"C:\MT7\terminal64.exe",
        "redis://127.0.0.1:6379",
        "2025-01-01T00:00:00",
        180,
    )


def test_non_integer_broker_utc_offset_minutes_is_a_hard_cli_error():
    with pytest.raises(SystemExit):
        main([
            "--terminal-path", r"C:\MT7\terminal64.exe",
            "--broker-utc-offset-minutes", "not-a-number",
        ])
