from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from typing import Any

CanonicalValue = (
    None
    | bool
    | int
    | float
    | str
    | Mapping[str, "CanonicalValue"]
    | Sequence["CanonicalValue"]
)


def _validate(value: Any) -> None:
    if value is None or isinstance(value, (bool, int, str)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("canonical floats must be finite")
        return
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if not isinstance(key, str):
                raise TypeError("canonical mapping keys must be strings")
            _validate(nested)
        return
    if isinstance(value, (list, tuple)):
        for nested in value:
            _validate(nested)
        return
    raise TypeError(f"unsupported canonical value: {type(value).__name__}")


def canonical_json_bytes(value: CanonicalValue) -> bytes:
    _validate(value)
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def record_event_id(
    *,
    namespace: str,
    schema_version: str,
    resource: str,
    natural_identity: str,
    payload_digest: str,
) -> str:
    return sha256_hex(
        canonical_json_bytes(
            {
                "namespace": namespace,
                "natural_identity": natural_identity,
                "payload_digest": payload_digest,
                "resource": resource,
                "schema_version": schema_version,
            }
        )
    )


def history_window_id(
    *,
    profile_id: str,
    generation: int,
    start_raw: int,
    end_raw: int,
    policy_version: int,
    window_revision: int,
) -> str:
    return sha256_hex(
        canonical_json_bytes(
            {
                "end_raw": end_raw,
                "generation": generation,
                "policy_version": policy_version,
                "profile_id": profile_id,
                "start_raw": start_raw,
                "window_revision": window_revision,
            }
        )
    )
