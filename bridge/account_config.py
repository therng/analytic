from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from bridge.config import JournalConfig, TerminalProfile
from bridge.paths import CanonicalPath, canonicalize, find_duplicate_groups

_PROFILE_FIELDS = frozenset(TerminalProfile.model_fields.keys())
_ALLOWED_KEYS = _PROFILE_FIELDS | {"journal_path"}


class ConfigLoadError(ValueError):
    def __init__(self, filename: str, message: str) -> None:
        super().__init__(f"{filename}: {message}")
        self.filename = filename
        self.message = message


@dataclass(frozen=True)
class AccountConfig:
    filename: str
    profile: TerminalProfile
    journal: JournalConfig
    executable_canonical: CanonicalPath
    journal_canonical: CanonicalPath


def load_account_file(
    path: Path,
    *,
    now_s: float,
    max_history_skew_s: int,
) -> AccountConfig:
    """Load one bridge/accounts/<login>.json into a validated AccountConfig.

    Enforces the loader-level operational invariants that Pydantic field
    validation on TerminalProfile cannot express alone: portable must be
    true, the config filename must match expected_login, unknown JSON keys
    are rejected before construction, and history_lower_bound_raw must not
    be implausibly far in the future.
    """
    filename = path.name
    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ConfigLoadError(filename, f"could not read file: {error}") from error

    try:
        data: Any = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ConfigLoadError(filename, f"invalid JSON: {error}") from error

    if not isinstance(data, dict):
        raise ConfigLoadError(filename, "account config must be a JSON object")

    unknown_keys = set(data.keys()) - _ALLOWED_KEYS
    if unknown_keys:
        raise ConfigLoadError(
            filename,
            f"unknown config field(s): {', '.join(sorted(unknown_keys))}",
        )

    if data.get("portable") is not True:
        raise ConfigLoadError(
            filename, "portable must be true; non-portable terminals are not supported"
        )

    if "journal_path" not in data:
        raise ConfigLoadError(filename, "journal_path is required")
    journal_path = data["journal_path"]
    if not isinstance(journal_path, str):
        raise ConfigLoadError(filename, "journal_path must be a string")

    profile_data = {key: value for key, value in data.items() if key in _PROFILE_FIELDS}
    try:
        profile = TerminalProfile(**profile_data)
    except ValidationError as error:
        raise ConfigLoadError(filename, f"invalid profile: {error}") from error

    expected_stem = str(profile.expected_login)
    if path.stem != expected_stem:
        raise ConfigLoadError(
            filename,
            f"filename must be {expected_stem}.json to match expected_login "
            f"{profile.expected_login}, found {path.stem!r}",
        )

    max_history_lower_bound = now_s + max_history_skew_s
    if profile.history_lower_bound_raw > max_history_lower_bound:
        raise ConfigLoadError(
            filename,
            "history_lower_bound_raw is implausibly far in the future "
            f"({profile.history_lower_bound_raw} > {max_history_lower_bound:.0f}); "
            "this is almost always a misconfigured timestamp, not a real "
            "broker-server boundary",
        )

    try:
        journal = JournalConfig(path=journal_path)
    except ValidationError as error:
        raise ConfigLoadError(filename, f"invalid journal_path: {error}") from error

    executable_canonical = canonicalize(profile.executable_path)
    journal_canonical = canonicalize(journal.path)

    return AccountConfig(
        filename=filename,
        profile=profile,
        journal=journal,
        executable_canonical=executable_canonical,
        journal_canonical=journal_canonical,
    )


@dataclass(frozen=True)
class LoadedAccounts:
    configs: list[AccountConfig]
    errors: list[ConfigLoadError]


def load_accounts_dir(
    directory: Path,
    *,
    now_s: float,
    max_history_skew_s: int,
) -> LoadedAccounts:
    """Load every *.json file in `directory` independently — one file's
    parse/validation failure does not prevent the others from loading; each
    failure is collected as a ConfigLoadError for the caller to quarantine
    that single account (ARCHITECTURE-level policy: a bad config for one
    account never blocks the rest)."""
    configs: list[AccountConfig] = []
    errors: list[ConfigLoadError] = []
    for path in sorted(directory.glob("*.json")):
        try:
            configs.append(
                load_account_file(
                    path, now_s=now_s, max_history_skew_s=max_history_skew_s
                )
            )
        except ConfigLoadError as error:
            errors.append(error)
    return LoadedAccounts(configs=configs, errors=errors)


@dataclass(frozen=True)
class DuplicateIdentityGroup:
    key: tuple[int, str, str]
    filenames: list[str]


def find_duplicate_identity_groups(
    configs: list[AccountConfig],
) -> list[DuplicateIdentityGroup]:
    """Group account configs whose (expected_login, expected_server,
    coordination_domain) triple collides — this is a configuration error,
    never a runtime race, and must be caught before any child is spawned."""
    buckets: dict[tuple[int, str, str], list[str]] = {}
    for config in configs:
        key = (
            config.profile.expected_login,
            config.profile.expected_server,
            config.profile.coordination_domain,
        )
        buckets.setdefault(key, []).append(config.filename)
    return [
        DuplicateIdentityGroup(key=key, filenames=filenames)
        for key, filenames in buckets.items()
        if len(filenames) > 1
    ]


@dataclass(frozen=True)
class DuplicateJournalGroup:
    canonical_key: str
    filenames: list[str]


def find_duplicate_journal_groups(
    configs: list[AccountConfig],
) -> list[DuplicateJournalGroup]:
    """Group account configs whose journal path resolves to the same
    canonical filesystem target — using CanonicalPath, not raw strings, so a
    junction/symlink/mapped-drive indirection cannot slip two logins onto
    the same SQLite journal undetected."""
    canonicals = [config.journal_canonical for config in configs]
    groups = find_duplicate_groups(canonicals)
    return [
        DuplicateJournalGroup(
            canonical_key=canonicals[indices[0]].casefold_key,
            filenames=[configs[index].filename for index in indices],
        )
        for indices in groups
    ]
