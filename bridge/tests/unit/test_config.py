from __future__ import annotations

import pytest
from pydantic import ValidationError

from bridge.config import (
    JournalConfig,
    TerminalProfile,
    validate_unique_logins,
)


def profile_data(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "executable_path": r"C:\MT5-A\terminal64.exe",
        "portable": True,
        "expected_data_path": r"C:\MT5-A",
        "expected_login": 10001,
        "expected_server": "Broker-Demo",
        "initialize_timeout_ms": 15_000,
        "coordination_domain": "prod-vps",
        "history_lower_bound_raw": 1_735_689_600,
    }
    data.update(overrides)
    return data


def test_terminal_profile_requires_absolute_terminal64_path() -> None:
    with pytest.raises(ValidationError, match="absolute Windows path"):
        TerminalProfile.model_validate(
            profile_data(executable_path=r"MT5-A\terminal64.exe")
        )

    with pytest.raises(ValidationError, match=r"terminal64\.exe"):
        TerminalProfile.model_validate(
            profile_data(executable_path=r"C:\MT5-A\other.exe")
        )


def test_terminal_profile_rejects_implicit_or_invalid_identity_fields() -> None:
    with pytest.raises(ValidationError):
        TerminalProfile.model_validate(
            profile_data(portable=None, expected_login=0, expected_server="")
        )


def test_terminal_profile_forbids_secret_and_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="password"):
        TerminalProfile.model_validate(profile_data(password="not-allowed"))


def test_profile_id_is_stable_and_contains_no_raw_path_or_account() -> None:
    first = TerminalProfile.model_validate(profile_data())
    second = TerminalProfile.model_validate(
        dict(reversed(list(profile_data().items())))
    )

    assert first.profile_id == second.profile_id
    assert len(first.profile_id) == 64
    assert "MT5-A" not in first.profile_id
    assert "10001" not in first.profile_id


def test_duplicate_login_is_rejected_even_for_distinct_terminals() -> None:
    first = TerminalProfile.model_validate(profile_data())
    second = TerminalProfile.model_validate(
        profile_data(
            executable_path=r"C:\MT5-B\terminal64.exe",
            expected_data_path=r"C:\MT5-B",
        )
    )

    with pytest.raises(ValueError, match="duplicate login 10001"):
        validate_unique_logins([first, second])


def test_journal_config_requires_local_absolute_path_and_positive_timeout() -> None:
    config = JournalConfig.model_validate(
        {"path": r"C:\ProgramData\mt5n\journal.sqlite3", "busy_timeout_ms": 5_000}
    )
    assert config.busy_timeout_ms == 5_000

    with pytest.raises(ValidationError, match="absolute Windows path"):
        JournalConfig.model_validate({"path": "journal.sqlite3"})

    with pytest.raises(ValidationError):
        JournalConfig.model_validate(
            {"path": r"C:\ProgramData\mt5n\journal.sqlite3", "busy_timeout_ms": 0}
        )
