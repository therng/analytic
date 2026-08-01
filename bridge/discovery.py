from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Protocol

from bridge.config import DEFAULT_HISTORY_LOWER_BOUND_RAW, TerminalProfile
from bridge.models import CallState
from bridge.mt5_adapter import StrictMt5Adapter
from bridge.process_probe import ProcessCandidate, _portable_mode

DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000
DEFAULT_COORDINATION_DOMAIN = "default"

_DUPLICATE_LOGIN_WARNING_RE = re.compile(
    r"^pid=(?P<pid>\d+): login (?P<login>\d+) already discovered from "
    r"another process, ignoring this duplicate$"
)


def parse_duplicate_login_warning(warning: str) -> tuple[int, int] | None:
    """Extracts (login, pid) from a discover_accounts() duplicate-login
    warning, or None if `warning` isn't one -- lets a caller (the
    supervisor's discovery-rescan loop) dedupe repeat warnings across
    cycles by identity rather than re-logging the same unchanged
    duplicate on every rescan."""
    match = _DUPLICATE_LOGIN_WARNING_RE.match(warning)
    if match is None:
        return None
    return int(match.group("login")), int(match.group("pid"))


class ProcessLister(Protocol):
    def build_candidates(self) -> list[ProcessCandidate]: ...


class Mt5ConnectPort(Protocol):
    """The narrow shape discovery needs from an MT5 connection -- the same
    Mt5Module protocol RealMt5Port/StrictMt5Adapter already use, injectable
    so discovery is unit-testable without a real MT5 install."""

    def initialize(self, path: str, timeout: int, portable: bool) -> bool: ...

    def shutdown(self) -> None: ...

    def version(self) -> tuple | None: ...

    def terminal_info(self) -> object | None: ...

    def account_info(self) -> object | None: ...

    def positions_get(self) -> tuple | None: ...

    def orders_get(self) -> tuple | None: ...

    def history_deals_get(self, start: int, end: int) -> tuple | None: ...

    def history_orders_get(self, start: int, end: int) -> tuple | None: ...

    def last_error(self) -> tuple: ...


@dataclass(frozen=True)
class DiscoveredAccount:
    profile: TerminalProfile
    source_pid: int


def discover_accounts(
    *,
    process_lister: ProcessLister,
    mt5_factory: Callable[[], Mt5ConnectPort],
    initialize_timeout_ms: int = DEFAULT_INITIALIZE_TIMEOUT_MS,
    coordination_domain: str = DEFAULT_COORDINATION_DOMAIN,
    history_lower_bound_raw: int = DEFAULT_HISTORY_LOWER_BOUND_RAW,
    preferred_executable_paths: dict[int, str] | None = None,
) -> tuple[tuple[DiscoveredAccount, ...], tuple[str, ...]]:
    """Enumerate running, portable-mode MT5 terminals and build one
    TerminalProfile per uniquely logged-in account by attaching to each
    candidate exactly once, reading its currently-connected identity, then
    detaching.

    Never opens a new terminal window: `mt5.initialize()` attaches to an
    already-running process at an exact executable_path instead of
    launching one -- the same guarantee TerminalSession's known-profile
    connect path already relies on (bridge/process_probe.py's
    select_process), applied here before any identity is known rather than
    after. Discovery only ever calls initialize() with a path taken
    directly from an enumerated running process, never a path it invented.

    One candidate's connect/read failure never aborts discovery of the
    rest -- same per-item-isolated-failure philosophy as
    account_config.py's load_accounts_dir. Returns (discovered accounts,
    human-readable warnings for every skipped candidate).
    """
    candidates = sorted(
        process_lister.build_candidates(),
        key=lambda candidate: (candidate.executable_path.casefold(), candidate.pid),
    )
    discovered_by_login: dict[int, list[DiscoveredAccount]] = {}
    warnings: list[str] = []
    seen_paths: set[str] = set()

    for candidate in candidates:
        label = f"pid={candidate.pid}"

        if not candidate.evidence_complete:
            warnings.append(f"{label}: incomplete process evidence, skipped")
            continue
        if not _portable_mode(candidate.command_line):
            warnings.append(f"{label}: not running in portable mode, skipped")
            continue
        if candidate.executable_path in seen_paths:
            continue
        seen_paths.add(candidate.executable_path)

        profile, warning = _discover_one(
            candidate,
            mt5_factory=mt5_factory,
            initialize_timeout_ms=initialize_timeout_ms,
            coordination_domain=coordination_domain,
            history_lower_bound_raw=history_lower_bound_raw,
            label=label,
        )
        if warning is not None:
            warnings.append(warning)
            continue
        assert profile is not None

        discovered_by_login.setdefault(profile.expected_login, []).append(
            DiscoveredAccount(profile=profile, source_pid=candidate.pid)
        )

    discovered: list[DiscoveredAccount] = []
    preferred_executable_paths = preferred_executable_paths or {}
    for login in sorted(discovered_by_login):
        accounts = discovered_by_login[login]
        preferred_path = preferred_executable_paths.get(login, "").casefold()
        owner = next(
            (
                account
                for account in accounts
                if account.profile.executable_path.casefold() == preferred_path
            ),
            accounts[0],
        )
        discovered.append(owner)
        for duplicate in accounts:
            if duplicate is owner:
                continue
            warnings.append(
                f"pid={duplicate.source_pid}: login {login} already discovered from "
                f"another process, ignoring this duplicate"
            )

    return tuple(discovered), tuple(warnings)


def _discover_one(
    candidate: ProcessCandidate,
    *,
    mt5_factory: Callable[[], Mt5ConnectPort],
    initialize_timeout_ms: int,
    coordination_domain: str,
    history_lower_bound_raw: int,
    label: str,
) -> tuple[TerminalProfile | None, str | None]:
    mt5 = mt5_factory()
    try:
        try:
            initialized = mt5.initialize(
                candidate.executable_path, timeout=initialize_timeout_ms, portable=True
            )
        except Exception as error:  # noqa: BLE001 - any IPC-layer failure, not fatal to discovery
            return None, f"{label}: initialize raised {type(error).__name__}, skipped"
        if not initialized:
            return None, f"{label}: initialize failed, skipped"

        adapter = StrictMt5Adapter(mt5)
        terminal = adapter.terminal()
        account = adapter.account()
        if terminal.state is CallState.FAILED or account.state is CallState.FAILED:
            return None, f"{label}: identity read failed, skipped"

        terminal_value = terminal.value
        account_value = account.value
        if not isinstance(terminal_value, dict) or not isinstance(account_value, dict):
            return None, f"{label}: identity shape invalid, skipped"
        if terminal_value.get("connected") is not True:
            return None, f"{label}: terminal not connected, skipped"

        data_path = terminal_value.get("data_path")
        login = account_value.get("login")
        server = account_value.get("server")
        if not isinstance(data_path, str) or not data_path:
            return None, f"{label}: missing data_path, skipped"
        if isinstance(login, bool) or not isinstance(login, int) or login <= 0:
            return None, f"{label}: no logged-in account, skipped"
        if not isinstance(server, str) or not server:
            return None, f"{label}: missing server, skipped"

        try:
            profile = TerminalProfile(
                executable_path=candidate.executable_path,
                portable=True,
                expected_data_path=data_path,
                expected_login=login,
                expected_server=server,
                initialize_timeout_ms=initialize_timeout_ms,
                coordination_domain=coordination_domain,
                history_lower_bound_raw=history_lower_bound_raw,
            )
        except ValueError as error:
            return None, f"{label}: discovered identity failed validation ({error}), skipped"
        return profile, None
    finally:
        try:
            mt5.shutdown()
        except Exception:  # noqa: BLE001 - shutdown is best-effort cleanup, never masks the result above
            pass
