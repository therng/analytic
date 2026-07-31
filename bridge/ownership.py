from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


class LocalOwnershipUnavailable(RuntimeError):
    pass


class StaleLocalLockEvidence(RuntimeError):
    pass


@dataclass(frozen=True)
class LocalLock:
    login: int
    owner_id: str
    path: Path

    def release(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise StaleLocalLockEvidence("local lock evidence is unreadable") from error
        if payload != {"login": self.login, "owner_id": self.owner_id}:
            raise LocalOwnershipUnavailable("local lock ownership changed")
        self.path.unlink()


class LocalLoginLock:
    def __init__(self, directory: str | Path) -> None:
        self._directory = Path(directory)

    def path_for(self, login: int) -> Path:
        if login <= 0:
            raise ValueError("login must be positive")
        return self._directory / f"mt5n-login-{login}.lock"

    def acquire(self, login: int, owner_id: str) -> LocalLock:
        if not owner_id:
            raise ValueError("owner_id is required")
        path = self.path_for(login)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError as error:
            try:
                evidence = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as stale_error:
                raise StaleLocalLockEvidence("local lock evidence is unreadable") from stale_error
            if (
                not isinstance(evidence, dict)
                or evidence.get("login") != login
                or not isinstance(evidence.get("owner_id"), str)
            ):
                raise StaleLocalLockEvidence("local lock evidence is malformed") from error
            raise LocalOwnershipUnavailable("login is already locally owned") from error
        try:
            os.write(
                descriptor,
                json.dumps({"login": login, "owner_id": owner_id}, sort_keys=True).encode(),
            )
        finally:
            os.close(descriptor)
        return LocalLock(login=login, owner_id=owner_id, path=path)
