from __future__ import annotations

import pytest

from mt5_bridge_native.redis_transport import (
    LeaseUnavailable,
    RedisLease,
)


class FakeRedis:
    def __init__(self) -> None:
        self.lease: dict[str, tuple[str, str, str, int]] = {}
        self.epochs: dict[str, str] = {}
        self.counters: dict[str, int] = {}
        self.live: dict[str, bytes] = {}
        self.streams: dict[str, list[tuple[str, bytes]]] = {}

    def eval(self, script: str, numkeys: int, *values: str | bytes) -> list[str]:
        keys = tuple(str(value) for value in values[:numkeys])
        args = values[numkeys:]
        if "mt5n:acquire" in script:
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
        if self.lease.get(lease_key) != (owner, producer, epoch, int(token)):
            return ["REJECTED"]
        if "mt5n:release" in script:
            del self.lease[lease_key]
            return ["RELEASED"]
        if "mt5n:publish-live" in script:
            self.live[keys[1]] = bytes(args[4])
            return ["PUBLISHED"]
        if "mt5n:append-live-stream" in script:
            stream = self.streams.setdefault(keys[1], [])
            stream.append((str(args[4]), bytes(args[5])))
            return ["APPENDED", f"{len(stream)}-0"]
        raise AssertionError("unknown Redis script")


def test_live_error_stream_is_fenced_and_cannot_replace_latest_complete_snapshot() -> (
    None
):
    client = FakeRedis()
    leases = RedisLease(client)
    credential = leases.acquire(1001, "host-a", "producer-a", 10_000)
    leases.publish_live_fenced(credential, b'{"message_type":"live.snapshot"}')
    entry_id = leases.append_live_stream_fenced(
        credential, "error-1", b'{"message_type":"live.error"}'
    )

    assert entry_id == "1-0"
    assert client.live["mt5n:v1:live:{1001}"] == b'{"message_type":"live.snapshot"}'
    assert client.streams["mt5n:v1:stream:live:{1001}"] == [
        ("error-1", b'{"message_type":"live.error"}')
    ]


def test_stale_fence_cannot_append_live_error() -> None:
    client = FakeRedis()
    leases = RedisLease(client)
    credential = leases.acquire(1001, "host-a", "producer-a", 10_000)
    leases.release(credential)

    with pytest.raises(LeaseUnavailable):
        leases.append_live_stream_fenced(credential, "error-1", b"stale")
