from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

import bridge.redis_transport as redis_transport
from bridge.redis_transport import (
    LeaseUnavailable,
    RedisLease,
    RedisTransportError,
)


def test_transport_has_no_journal_or_checkpoint_dependency() -> None:
    source = Path(redis_transport.__file__)

    assert "bridge.journal" not in source.read_text(encoding="utf-8")
    assert "Checkpoint" not in source.read_text(encoding="utf-8")


class FakeRedis:
    def __init__(self) -> None:
        self.lease: dict[str, tuple[str, str, str, int]] = {}
        self.epochs: dict[str, str] = {}
        self.counters: dict[str, int] = {}
        self.live: dict[str, bytes] = {}
        self.streams: dict[str, list[tuple[str, bytes]]] = {}

    def reset_coordination(self) -> None:
        self.lease.clear()
        self.epochs.clear()
        self.counters.clear()

    def eval(self, script: str, numkeys: int, *values: str | bytes) -> list[str]:
        keys = tuple(str(value) for value in values[:numkeys])
        args = values[numkeys:]
        if "mt5:acquire" in script:
            lease_key, epoch_key, counter_key = keys
            owner, producer, _ttl, proposed_epoch = (str(value) for value in args)
            if lease_key in self.lease:
                return ["HELD"]
            epoch = self.epochs.setdefault(epoch_key, proposed_epoch)
            token = self.counters.get(counter_key, 0) + 1
            self.counters[counter_key] = token
            self.lease[lease_key] = (owner, producer, epoch, token)
            return ["ACQUIRED", epoch, str(token)]
        lease_key = keys[0]
        owner, producer, epoch, token = (str(value) for value in args[:4])
        current = self.lease.get(lease_key)
        if current != (owner, producer, epoch, int(token)):
            return ["REJECTED"]
        if "mt5:renew" in script:
            return ["RENEWED"]
        if "mt5:release" in script:
            del self.lease[lease_key]
            return ["RELEASED"]
        if "mt5:publish-live" in script:
            self.live[keys[1]] = bytes(args[4])
            return ["PUBLISHED"]
        if "mt5:append-stream" in script:
            stream = self.streams.setdefault(keys[1], [])
            stream.append((str(args[4]), bytes(args[5])))
            return ["APPENDED", f"{len(stream)}-0"]
        raise AssertionError("unknown Redis script")


def test_lease_fences_stale_owner_and_keeps_keys_in_one_cluster_slot() -> None:
    client = FakeRedis()
    leases = RedisLease(client)
    first = leases.acquire(1001, "host-a", "producer-a", 10_000)

    with pytest.raises(LeaseUnavailable):
        leases.acquire(1001, "host-b", "producer-b", 10_000)
    with pytest.raises(LeaseUnavailable):
        leases.renew(first.with_owner("host-b"), 10_000)

    assert leases.renew(first, 10_000)
    assert leases.cluster_keys(1001) == (
        "mt5:account:{1001}:lease",
        "mt5:account:{1001}:lease-epoch",
        "mt5:account:{1001}:fence-counter",
        "mt5:account:{1001}:live",
        "mt5:account:{1001}:stream:history",
    )


def test_fenced_publication_is_atomic_and_lease_loss_blocks_both_paths() -> None:
    client = FakeRedis()
    leases = RedisLease(client)
    credential = leases.acquire(1001, "host-a", "producer-a", 10_000)

    leases.publish_live_fenced(credential, b'{"event":"live"}')
    entry_id = leases.append_stream_fenced(credential, "event-1", b'{"event":"history"}')
    leases.release(credential)

    assert entry_id == "1-0"
    assert client.live["mt5:account:{1001}:live"] == b'{"event":"live"}'
    assert client.streams["mt5:account:{1001}:stream:history"] == [
        ("event-1", b'{"event":"history"}')
    ]
    with pytest.raises(LeaseUnavailable):
        leases.publish_live_fenced(credential, b"stale")
    with pytest.raises(LeaseUnavailable):
        leases.append_stream_fenced(credential, "event-2", b"stale")


def test_coordination_reset_invalidates_old_epoch_and_restarts_token_space() -> None:
    client = FakeRedis()
    leases = RedisLease(client)
    original = leases.acquire(1001, "host-a", "producer-a", 10_000)
    client.reset_coordination()

    replacement = leases.acquire(1001, "host-b", "producer-b", 10_000)

    assert replacement.coordination_epoch != original.coordination_epoch
    assert replacement.fencing_token == 1
    with pytest.raises(LeaseUnavailable):
        leases.publish_live_fenced(original, b"stale")


def test_redis_errors_are_redacted_to_the_exception_class() -> None:
    class BrokenRedis:
        def eval(self, *_args: Any) -> list[str]:
            raise RuntimeError("redis://password@host")

    with pytest.raises(RedisTransportError, match="RuntimeError") as error:
        RedisLease(BrokenRedis()).acquire(1001, "host-a", "producer-a", 10_000)

    assert "password" not in str(error.value)


@pytest.mark.integration
def test_real_redis_fencing_is_opt_in() -> None:
    if os.environ.get("RUN_REDIS_INTEGRATION") != "1":
        pytest.skip("set RUN_REDIS_INTEGRATION=1 with an isolated Redis URL")
    redis = pytest.importorskip("redis")
    client = redis.Redis.from_url(os.environ["MT5_NATIVE_REDIS_TEST_URL"])
    client.flushdb()
    leases = RedisLease(client)
    credential = leases.acquire(1001, "host-a", "producer-a", 10_000)
    leases.publish_live_fenced(credential, b'{"event":"live"}')
    assert client.get("mt5:account:{1001}:live") == b'{"event":"live"}'
