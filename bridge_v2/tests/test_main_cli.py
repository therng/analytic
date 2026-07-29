"""CLI contract for bridge_v2.main — Bug A fix requires an explicit, per-login
broker UTC offset rather than guessing (matches the repo's existing
"fail loud, don't guess" convention for brokerUtcOffsetMinutes)."""

import pytest

from bridge_v2.main import main


def test_missing_broker_utc_offset_minutes_is_a_hard_cli_error():
    with pytest.raises(SystemExit):
        main(["--terminal-path", r"C:\MT7\terminal64.exe"])


def test_non_integer_broker_utc_offset_minutes_is_a_hard_cli_error():
    with pytest.raises(SystemExit):
        main([
            "--terminal-path", r"C:\MT7\terminal64.exe",
            "--broker-utc-offset-minutes", "not-a-number",
        ])
