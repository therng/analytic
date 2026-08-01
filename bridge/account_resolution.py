from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Callable

from bridge.account_config import AccountConfig, ConfigLoadError, load_account_file
from bridge.atomic_io import atomic_write_json
from bridge.config import DEFAULT_HISTORY_LOWER_BOUND_RAW
from bridge.discovery import (
    DEFAULT_COORDINATION_DOMAIN,
    DEFAULT_INITIALIZE_TIMEOUT_MS,
    Mt5ConnectPort,
    ProcessLister,
    discover_accounts,
)

DEFAULT_STATE_DIR_WINDOWS = "C:\\analytic\\bridge\\state"


@dataclass(frozen=True)
class ResolvedAccounts:
    configs: tuple[AccountConfig, ...]
    warnings: tuple[str, ...]
    errors: tuple[ConfigLoadError, ...]


def _journal_path_for(login: int, *, state_dir_windows: str) -> str:
    return str(PureWindowsPath(state_dir_windows) / "journal" / f"{login}.sqlite3")


def _profile_to_account_json(profile, *, journal_path: str) -> dict:
    return {
        "executable_path": profile.executable_path,
        "portable": profile.portable,
        "expected_data_path": profile.expected_data_path,
        "expected_login": profile.expected_login,
        "expected_server": profile.expected_server,
        "initialize_timeout_ms": profile.initialize_timeout_ms,
        "coordination_domain": profile.coordination_domain,
        "history_lower_bound_raw": profile.history_lower_bound_raw,
        "journal_path": journal_path,
    }


def resolve_accounts(
    *,
    process_lister: ProcessLister,
    mt5_factory: Callable[[], Mt5ConnectPort],
    overrides_dir: Path,
    generated_dir: Path,
    now_s: float,
    max_history_skew_s: int,
    state_dir_windows: str = DEFAULT_STATE_DIR_WINDOWS,
    initialize_timeout_ms: int = DEFAULT_INITIALIZE_TIMEOUT_MS,
    coordination_domain: str = DEFAULT_COORDINATION_DOMAIN,
    history_lower_bound_raw: int = DEFAULT_HISTORY_LOWER_BOUND_RAW,
    preferred_executable_paths: dict[int, str] | None = None,
) -> ResolvedAccounts:
    """The account source list for the supervisor: auto-discovery is the
    default mechanism, `overrides_dir` (bridge/accounts/*.json, operator
    -authored) is an optional per-account override -- present for a
    discovered login, its file wins verbatim and discovery's own
    auto-generated profile for that login is discarded, never merged
    field-by-field (a partial override inheriting stale discovered fields
    silently would be worse than requiring the operator author a complete
    file, matching account_config.py's existing "unknown keys rejected,
    nothing partially defaulted" posture).

    Every discovered (non-overridden) account is written to
    `generated_dir/<login>.json` via the same atomic_write_json helper
    used throughout this codebase, then loaded back through the existing,
    already-tested `load_account_file` -- discovery never constructs an
    AccountConfig itself, it only ever produces the same JSON shape a
    human-authored override file would, so both paths share one
    validation/canonicalization implementation.
    """
    discovered, discovery_warnings = discover_accounts(
        process_lister=process_lister,
        mt5_factory=mt5_factory,
        initialize_timeout_ms=initialize_timeout_ms,
        coordination_domain=coordination_domain,
        history_lower_bound_raw=history_lower_bound_raw,
        preferred_executable_paths=preferred_executable_paths,
    )

    override_paths = {
        path.stem: path for path in sorted(overrides_dir.glob("*.json"))
    } if overrides_dir.is_dir() else {}

    configs: list[AccountConfig] = []
    errors: list[ConfigLoadError] = []
    warnings: list[str] = list(discovery_warnings)
    resolved_logins: set[str] = set()

    for account in discovered:
        login_key = str(account.profile.expected_login)
        resolved_logins.add(login_key)
        override_path = override_paths.get(login_key)
        if override_path is not None:
            warnings.append(
                f"login {login_key}: override file present, using it instead of "
                f"the auto-discovered profile"
            )
            try:
                configs.append(
                    load_account_file(
                        override_path, now_s=now_s, max_history_skew_s=max_history_skew_s
                    )
                )
            except ConfigLoadError as error:
                errors.append(error)
            continue

        generated_dir.mkdir(parents=True, exist_ok=True)
        generated_path = generated_dir / f"{login_key}.json"
        journal_path = _journal_path_for(account.profile.expected_login, state_dir_windows=state_dir_windows)
        atomic_write_json(
            generated_path,
            _profile_to_account_json(account.profile, journal_path=journal_path),
        )
        try:
            configs.append(
                load_account_file(
                    generated_path, now_s=now_s, max_history_skew_s=max_history_skew_s
                )
            )
        except ConfigLoadError as error:
            errors.append(error)

    # Override files for logins that were NOT discovered this cycle (e.g. a
    # terminal that isn't running right now, or a non-portable/manually
    # managed account) still load -- an override is a standing declaration
    # of intent, not conditioned on discovery having found a live process.
    for login_key, override_path in override_paths.items():
        if login_key in resolved_logins:
            continue
        try:
            configs.append(
                load_account_file(
                    override_path, now_s=now_s, max_history_skew_s=max_history_skew_s
                )
            )
        except ConfigLoadError as error:
            errors.append(error)

    return ResolvedAccounts(
        configs=tuple(configs), warnings=tuple(warnings), errors=tuple(errors)
    )
