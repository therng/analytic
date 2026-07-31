from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any


def atomic_write_json(path: str | Path, data: dict[str, Any]) -> None:
    """Write `data` to `path` as JSON with no partial-write ever observable
    by a concurrent reader: build in memory, write to a sibling temp file,
    fsync it, then os.replace onto the final path (an atomic rename on the
    same filesystem). A reader opening `path` at any point either sees the
    fully-prior content or the fully-new content, never a truncated mix."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2)
    temp_path = target.parent / f"{target.name}.tmp-{uuid.uuid4().hex}"
    descriptor = os.open(temp_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, target)
    finally:
        temp_path.unlink(missing_ok=True)


def read_json(path: str | Path) -> dict[str, Any] | None:
    """Read and parse a JSON file, returning None if it does not exist."""
    target = Path(path)
    try:
        raw = target.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    return json.loads(raw)
