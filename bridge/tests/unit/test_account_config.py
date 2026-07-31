from __future__ import annotations

import json
from pathlib import Path

import pytest

from bridge.account_config import (
    ConfigLoadError,
    find_duplicate_identity_groups,
    find_duplicate_journal_groups,
    load_account_file,
    load_accounts_dir,
)

NOW_S = 1_800_000_000.0
MAX_SKEW_S = 86_400


def _valid_payload(**overrides) -> dict:
    payload = {
        "executable_path": r"C:\MT5\Alpha\terminal64.exe",
        "portable": True,
        "expected_data_path": r"C:\MT5\Alpha",
        "expected_login": 123456,
        "expected_server": "Broker-Live01",
        "initialize_timeout_ms": 30000,
        "coordination_domain": "prod",
        "history_lower_bound_raw": 1_735_689_600,
        "journal_path": r"C:\bridge\journal\123456.sqlite",
    }
    payload.update(overrides)
    return payload


def _write(tmp_path: Path, filename: str, payload: dict) -> Path:
    path = tmp_path / filename
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_valid_account_loads(tmp_path: Path):
    path = _write(tmp_path, "123456.json", _valid_payload())
    config = load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)
    assert config.profile.expected_login == 123456
    assert config.journal.path.endswith("123456.sqlite")


def test_missing_file_raises(tmp_path: Path):
    with pytest.raises(ConfigLoadError):
        load_account_file(
            tmp_path / "missing.json", now_s=NOW_S, max_history_skew_s=MAX_SKEW_S
        )


def test_invalid_json_raises(tmp_path: Path):
    path = tmp_path / "123456.json"
    path.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(ConfigLoadError):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_unknown_key_rejected(tmp_path: Path):
    payload = _valid_payload(password="hunter2")  # noqa: S106 - deliberate bad input
    path = _write(tmp_path, "123456.json", payload)
    with pytest.raises(ConfigLoadError, match="unknown config field"):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_non_portable_rejected(tmp_path: Path):
    payload = _valid_payload(portable=False)
    path = _write(tmp_path, "123456.json", payload)
    with pytest.raises(ConfigLoadError, match="portable must be true"):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_filename_login_mismatch_rejected(tmp_path: Path):
    payload = _valid_payload()
    path = _write(tmp_path, "999999.json", payload)
    with pytest.raises(ConfigLoadError, match="filename must be"):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_history_lower_bound_within_skew_ceiling_accepted(tmp_path: Path):
    payload = _valid_payload(history_lower_bound_raw=int(NOW_S) + MAX_SKEW_S - 1)
    path = _write(tmp_path, "123456.json", payload)
    load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_history_lower_bound_beyond_skew_ceiling_rejected(tmp_path: Path):
    payload = _valid_payload(history_lower_bound_raw=int(NOW_S) + MAX_SKEW_S + 1)
    path = _write(tmp_path, "123456.json", payload)
    with pytest.raises(ConfigLoadError, match="implausibly far in the future"):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_missing_journal_path_rejected(tmp_path: Path):
    payload = _valid_payload()
    del payload["journal_path"]
    path = _write(tmp_path, "123456.json", payload)
    with pytest.raises(ConfigLoadError, match="journal_path is required"):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_non_object_json_rejected(tmp_path: Path):
    path = tmp_path / "123456.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(ConfigLoadError, match="must be a JSON object"):
        load_account_file(path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)


def test_load_accounts_dir_collects_errors_without_aborting_other_files(
    tmp_path: Path,
):
    _write(tmp_path, "111111.json", _valid_payload(expected_login=111111))
    bad_payload = _valid_payload(expected_login=222222)
    del bad_payload["journal_path"]
    _write(tmp_path, "222222.json", bad_payload)

    loaded = load_accounts_dir(tmp_path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)

    assert len(loaded.configs) == 1
    assert loaded.configs[0].profile.expected_login == 111111
    assert len(loaded.errors) == 1
    assert loaded.errors[0].filename == "222222.json"


def test_no_duplicate_identity_when_login_differs(tmp_path: Path):
    _write(
        tmp_path,
        "111111.json",
        _valid_payload(
            expected_login=111111,
            journal_path=r"C:\bridge\journal\111111.sqlite",
        ),
    )
    _write(
        tmp_path,
        "222222.json",
        _valid_payload(
            expected_login=222222,
            executable_path=r"C:\MT5\Alpha\terminal64.exe",
            expected_server="Broker-Live01",
            coordination_domain="prod",
            journal_path=r"C:\bridge\journal\222222.sqlite",
        ),
    )
    loaded = load_accounts_dir(tmp_path, now_s=NOW_S, max_history_skew_s=MAX_SKEW_S)
    assert loaded.errors == []
    # Different logins never collide in the (login, server, domain) triple,
    # even with identical executable/server/domain otherwise.
    assert find_duplicate_identity_groups(loaded.configs) == []


def test_duplicate_identity_group_same_login_server_domain(tmp_path: Path):
    # The loader itself enforces filename-stem == expected_login, so two
    # real account files can never legitimately share a login — the
    # collision this check exists for is an operator mistake (e.g. copying
    # one account's JSON to a new filename and forgetting to edit the
    # login). Exercise the pure grouping function directly against two
    # AccountConfig values sharing (login, server, domain), which is the
    # shape load_accounts_dir would produce if that mistake happened.
    from bridge.config import TerminalProfile

    profile_a = TerminalProfile(**_strip_journal(_valid_payload(expected_login=1)))
    profile_b = TerminalProfile(**_strip_journal(_valid_payload(expected_login=1)))
    from bridge.account_config import AccountConfig
    from bridge.config import JournalConfig
    from bridge.paths import canonicalize

    cfg_a = AccountConfig(
        filename="1.json",
        profile=profile_a,
        journal=JournalConfig(path=r"C:\j\a.sqlite"),
        executable_canonical=canonicalize(profile_a.executable_path),
        journal_canonical=canonicalize(r"C:\j\a.sqlite"),
    )
    cfg_b = AccountConfig(
        filename="1-again.json",
        profile=profile_b,
        journal=JournalConfig(path=r"C:\j\b.sqlite"),
        executable_canonical=canonicalize(profile_b.executable_path),
        journal_canonical=canonicalize(r"C:\j\b.sqlite"),
    )
    groups = find_duplicate_identity_groups([cfg_a, cfg_b])
    assert len(groups) == 1
    assert set(groups[0].filenames) == {"1.json", "1-again.json"}


def _strip_journal(payload: dict) -> dict:
    payload = dict(payload)
    payload.pop("journal_path", None)
    return payload


def test_duplicate_journal_path_detected_across_files(tmp_path: Path):
    from bridge.account_config import AccountConfig
    from bridge.config import JournalConfig, TerminalProfile
    from bridge.paths import canonicalize

    profile_a = TerminalProfile(**_strip_journal(_valid_payload(expected_login=1)))
    profile_b = TerminalProfile(
        **_strip_journal(_valid_payload(expected_login=2, expected_server="Other"))
    )
    shared_journal = r"C:\bridge\journal\shared.sqlite"
    cfg_a = AccountConfig(
        filename="1.json",
        profile=profile_a,
        journal=JournalConfig(path=shared_journal),
        executable_canonical=canonicalize(profile_a.executable_path),
        journal_canonical=canonicalize(shared_journal),
    )
    cfg_b = AccountConfig(
        filename="2.json",
        profile=profile_b,
        journal=JournalConfig(path=shared_journal.upper()),
        executable_canonical=canonicalize(profile_b.executable_path),
        journal_canonical=canonicalize(shared_journal.upper()),
    )
    groups = find_duplicate_journal_groups([cfg_a, cfg_b])
    assert len(groups) == 1
    assert set(groups[0].filenames) == {"1.json", "2.json"}


def test_no_duplicate_journal_when_paths_differ(tmp_path: Path):
    from bridge.account_config import AccountConfig
    from bridge.config import JournalConfig, TerminalProfile
    from bridge.paths import canonicalize

    profile_a = TerminalProfile(**_strip_journal(_valid_payload(expected_login=1)))
    profile_b = TerminalProfile(
        **_strip_journal(_valid_payload(expected_login=2, expected_server="Other"))
    )
    cfg_a = AccountConfig(
        filename="1.json",
        profile=profile_a,
        journal=JournalConfig(path=r"C:\j\1.sqlite"),
        executable_canonical=canonicalize(profile_a.executable_path),
        journal_canonical=canonicalize(r"C:\j\1.sqlite"),
    )
    cfg_b = AccountConfig(
        filename="2.json",
        profile=profile_b,
        journal=JournalConfig(path=r"C:\j\2.sqlite"),
        executable_canonical=canonicalize(profile_b.executable_path),
        journal_canonical=canonicalize(r"C:\j\2.sqlite"),
    )
    assert find_duplicate_journal_groups([cfg_a, cfg_b]) == []
