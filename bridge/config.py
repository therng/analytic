from __future__ import annotations

import hashlib
import json
from pathlib import PureWindowsPath
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

DEFAULT_HISTORY_LOWER_BOUND_RAW = 1_735_689_600  # 2025-01-01 00:00:00 MT5 raw time


def _absolute_windows_path(value: str, *, executable: bool = False) -> str:
    path = PureWindowsPath(value)
    if not path.is_absolute():
        raise ValueError("must be an absolute Windows path")
    if executable and path.name.casefold() != "terminal64.exe":
        raise ValueError("executable path must end with terminal64.exe")
    return str(path)


class TerminalProfile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    executable_path: str
    portable: bool
    expected_data_path: str
    expected_login: int = Field(gt=0)
    expected_server: str = Field(min_length=1)
    initialize_timeout_ms: int = Field(gt=0)
    coordination_domain: str = Field(min_length=1)
    history_lower_bound_raw: int = Field(default=DEFAULT_HISTORY_LOWER_BOUND_RAW, ge=0)

    @model_validator(mode="after")
    def validate_identity(self) -> Self:
        executable_path = _absolute_windows_path(self.executable_path, executable=True)
        data_path = _absolute_windows_path(self.expected_data_path)
        object.__setattr__(self, "executable_path", executable_path)
        object.__setattr__(self, "expected_data_path", data_path)
        return self

    @property
    def profile_id(self) -> str:
        identity = {
            "coordination_domain": self.coordination_domain,
            "executable_path": self.executable_path.casefold(),
            "expected_data_path": self.expected_data_path.casefold(),
            "expected_login": self.expected_login,
            "expected_server": self.expected_server,
            "portable": self.portable,
        }
        encoded = json.dumps(
            identity, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


class JournalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    busy_timeout_ms: int = Field(default=5_000, gt=0)
    expected_host: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_path(self) -> Self:
        object.__setattr__(self, "path", _absolute_windows_path(self.path))
        return self


def validate_unique_logins(
    profiles: list[TerminalProfile],
) -> tuple[TerminalProfile, ...]:
    seen: set[int] = set()
    for profile in profiles:
        if profile.expected_login in seen:
            raise ValueError(f"duplicate login {profile.expected_login}")
        seen.add(profile.expected_login)
    return tuple(profiles)
