from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from bridge.atomic_io import atomic_write_json, read_json


def test_read_json_missing_file_returns_none(tmp_path: Path):
    assert read_json(tmp_path / "missing.json") is None


def test_write_then_read_round_trips(tmp_path: Path):
    target = tmp_path / "state" / "nested" / "file.json"
    atomic_write_json(target, {"a": 1, "b": "two"})
    assert read_json(target) == {"a": 1, "b": "two"}


def test_no_temp_file_left_behind_after_write(tmp_path: Path):
    target = tmp_path / "file.json"
    atomic_write_json(target, {"x": 1})
    leftovers = list(tmp_path.glob("*.tmp-*"))
    assert leftovers == []


def test_second_write_fully_replaces_first(tmp_path: Path):
    target = tmp_path / "file.json"
    atomic_write_json(target, {"version": 1})
    atomic_write_json(target, {"version": 2})
    assert read_json(target) == {"version": 2}


def test_concurrent_read_never_observes_partial_json(tmp_path: Path):
    target = tmp_path / "file.json"
    atomic_write_json(target, {"n": 0})

    stop = threading.Event()
    errors: list[Exception] = []

    def writer() -> None:
        for n in range(1, 200):
            atomic_write_json(target, {"n": n, "payload": "x" * 500})
        stop.set()

    def reader() -> None:
        while not stop.is_set():
            try:
                raw = target.read_text(encoding="utf-8")
                json.loads(raw)
            except Exception as error:  # noqa: BLE001 - any parse failure is the bug under test
                errors.append(error)

    writer_thread = threading.Thread(target=writer)
    reader_threads = [threading.Thread(target=reader) for _ in range(4)]
    writer_thread.start()
    for thread in reader_threads:
        thread.start()
    writer_thread.join(timeout=30)
    stop.set()
    for thread in reader_threads:
        thread.join(timeout=30)

    assert errors == []


def test_write_survives_missing_parent_directory(tmp_path: Path):
    target = tmp_path / "does" / "not" / "exist" / "file.json"
    atomic_write_json(target, {"ok": True})
    assert read_json(target) == {"ok": True}
