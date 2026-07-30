from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from typing import Protocol


class RedisScriptClient(Protocol):
    def eval(self, script: str, numkeys: int, *values: str | bytes) -> object: ...


class RedisTransportError(RuntimeError):
    pass


class LeaseUnavailable(RedisTransportError):
    pass


@dataclass(frozen=True)
class FenceCredential:
    login: int
    owner_id: str
    producer_epoch_id: str
    coordination_epoch: str
    fencing_token: int

    def with_owner(self, owner_id: str) -> FenceCredential:
        return replace(self, owner_id=owner_id)


ACQUIRE_LUA = """
-- mt5n:acquire
if redis.call('GET', KEYS[1]) then return {'HELD'} end
local epoch = redis.call('GET', KEYS[2])
if not epoch then epoch = ARGV[4]; redis.call('SET', KEYS[2], epoch) end
local token = redis.call('INCR', KEYS[3])
redis.call('SET', KEYS[1], cjson.encode({owner=ARGV[1], producer=ARGV[2], epoch=epoch, token=token}), 'PX', ARGV[3])
return {'ACQUIRED', epoch, tostring(token)}
"""

RENEW_LUA = """
-- mt5n:renew
local value = redis.call('GET', KEYS[1])
if not value then return {'REJECTED'} end
local lease = cjson.decode(value)
if lease.owner ~= ARGV[1] or lease.producer ~= ARGV[2] or lease.epoch ~= ARGV[3] or lease.token ~= tonumber(ARGV[4]) then return {'REJECTED'} end
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return {'RENEWED'}
"""

RELEASE_LUA = """
-- mt5n:release
local value = redis.call('GET', KEYS[1])
if not value then return {'REJECTED'} end
local lease = cjson.decode(value)
if lease.owner ~= ARGV[1] or lease.producer ~= ARGV[2] or lease.epoch ~= ARGV[3] or lease.token ~= tonumber(ARGV[4]) then return {'REJECTED'} end
redis.call('DEL', KEYS[1])
return {'RELEASED'}
"""

PUBLISH_LIVE_LUA = """
-- mt5n:publish-live
local value = redis.call('GET', KEYS[1])
if not value then return {'REJECTED'} end
local lease = cjson.decode(value)
if lease.owner ~= ARGV[1] or lease.producer ~= ARGV[2] or lease.epoch ~= ARGV[3] or lease.token ~= tonumber(ARGV[4]) then return {'REJECTED'} end
redis.call('SET', KEYS[2], ARGV[5])
return {'PUBLISHED'}
"""

APPEND_STREAM_LUA = """
-- mt5n:append-stream
local value = redis.call('GET', KEYS[1])
if not value then return {'REJECTED'} end
local lease = cjson.decode(value)
if lease.owner ~= ARGV[1] or lease.producer ~= ARGV[2] or lease.epoch ~= ARGV[3] or lease.token ~= tonumber(ARGV[4]) then return {'REJECTED'} end
local id = redis.call('XADD', KEYS[2], '*', 'event_id', ARGV[5], 'envelope', ARGV[6])
return {'APPENDED', id}
"""

APPEND_LIVE_STREAM_LUA = """
-- mt5n:append-live-stream
local value = redis.call('GET', KEYS[1])
if not value then return {'REJECTED'} end
local lease = cjson.decode(value)
if lease.owner ~= ARGV[1] or lease.producer ~= ARGV[2] or lease.epoch ~= ARGV[3] or lease.token ~= tonumber(ARGV[4]) then return {'REJECTED'} end
local id = redis.call('XADD', KEYS[2], '*', 'event_id', ARGV[5], 'envelope', ARGV[6])
return {'APPENDED', id}
"""


class RedisLease:
    def __init__(self, client: RedisScriptClient) -> None:
        self._client = client

    @staticmethod
    def cluster_keys(login: int) -> tuple[str, str, str, str, str, str]:
        if login <= 0:
            raise ValueError("login must be positive")
        slot = f"{{{login}}}"
        return (
            f"mt5n:v1:lease:{slot}", f"mt5n:v1:lease-epoch:{slot}",
            f"mt5n:v1:fence-counter:{slot}", f"mt5n:v1:live:{slot}",
            f"mt5n:v1:stream:live:{slot}", f"mt5n:v1:stream:history:{slot}",
        )

    def _eval(self, script: str, keys: tuple[str, ...], *args: str | bytes) -> list[str]:
        try:
            raw = self._client.eval(script, len(keys), *keys, *args)
        except Exception as error:
            raise RedisTransportError(type(error).__name__) from error
        if not isinstance(raw, (list, tuple)):
            raise RedisTransportError("invalid Redis script result")
        return [item.decode() if isinstance(item, bytes) else str(item) for item in raw]

    def acquire(self, login: int, owner_id: str, producer_epoch_id: str, ttl_ms: int) -> FenceCredential:
        if not owner_id or not producer_epoch_id or ttl_ms <= 0:
            raise ValueError("owner_id, producer_epoch_id, and positive ttl_ms are required")
        lease, epoch, counter, *_rest = self.cluster_keys(login)
        result = self._eval(ACQUIRE_LUA, (lease, epoch, counter), owner_id, producer_epoch_id, str(ttl_ms), str(uuid.uuid4()))
        if len(result) != 3 or result[0] != "ACQUIRED":
            raise LeaseUnavailable("distributed lease is unavailable")
        return FenceCredential(login, owner_id, producer_epoch_id, result[1], int(result[2]))

    def renew(self, credential: FenceCredential, ttl_ms: int) -> bool:
        if ttl_ms <= 0:
            raise ValueError("ttl_ms must be positive")
        result = self._fenced(RENEW_LUA, credential, str(ttl_ms))
        if result == ["RENEWED"]:
            return True
        raise LeaseUnavailable("distributed lease renewal was rejected")

    def release(self, credential: FenceCredential) -> None:
        result = self._fenced(RELEASE_LUA, credential)
        if result != ["RELEASED"]:
            raise LeaseUnavailable("distributed lease release was rejected")

    def publish_live_fenced(self, credential: FenceCredential, envelope: bytes) -> None:
        *_head, live, _stream_live, _stream_history = self.cluster_keys(credential.login)
        result = self._fenced(PUBLISH_LIVE_LUA, credential, envelope, extra_keys=(live,))
        if result != ["PUBLISHED"]:
            raise LeaseUnavailable("fenced live publication was rejected")

    def append_stream_fenced(self, credential: FenceCredential, event_id: str, envelope: bytes) -> str:
        if not event_id:
            raise ValueError("event_id is required")
        *_head, _live, _stream_live, stream_history = self.cluster_keys(credential.login)
        result = self._fenced(APPEND_STREAM_LUA, credential, event_id, envelope, extra_keys=(stream_history,))
        if len(result) != 2 or result[0] != "APPENDED":
            raise LeaseUnavailable("fenced stream append was rejected")
        return result[1]

    def append_live_stream_fenced(
        self, credential: FenceCredential, event_id: str, envelope: bytes
    ) -> str:
        if not event_id:
            raise ValueError("event_id is required")
        *_head, _live, stream_live, _stream_history = self.cluster_keys(
            credential.login
        )
        result = self._fenced(
            APPEND_LIVE_STREAM_LUA,
            credential,
            event_id,
            envelope,
            extra_keys=(stream_live,),
        )
        if len(result) != 2 or result[0] != "APPENDED":
            raise LeaseUnavailable("fenced live stream append was rejected")
        return result[1]

    def _fenced(self, script: str, credential: FenceCredential, *tail: str | bytes, extra_keys: tuple[str, ...] = ()) -> list[str]:
        lease = self.cluster_keys(credential.login)[0]
        return self._eval(script, (lease, *extra_keys), credential.owner_id, credential.producer_epoch_id, credential.coordination_epoch, str(credential.fencing_token), *tail)
