from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

from bridge.replay_published_outbox import (
    FencedReplayTarget,
    PublishedOutboxReplay,
    PublishedOutboxReplayError,
)
from bridge.redis_transport import RedisLease


CONFIRMATION = "REPLAY_PUBLISHED_OUTBOX"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Replay immutable PUBLISHED history envelopes from one native journal."
    )
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--login", type=int, required=True)
    parser.add_argument("--target-id", required=True)
    parser.add_argument("--confirm")
    args = parser.parse_args(argv)
    if args.confirm != CONFIRMATION:
        print(f"--confirm {CONFIRMATION} is required", file=sys.stderr)
        return 2
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        print("REDIS_URL is required", file=sys.stderr)
        return 2
    try:
        import redis

        raw_target = redis.Redis.from_url(redis_url)
        lease = RedisLease(raw_target)
        owner_id = f"published-outbox-replay:{uuid.uuid4()}"
        credential = lease.acquire(
            args.login,
            owner_id,
            str(uuid.uuid4()),
            ttl_ms=1_800_000,
        )
        try:
            result = PublishedOutboxReplay(args.journal, login=args.login).replay(
                FencedReplayTarget(raw_target, lease, credential), target_id=args.target_id
            )
        finally:
            lease.release(credential)
    except Exception as error:  # no details: a Redis exception can include its URL
        print(f"published outbox replay failed: {type(error).__name__}", file=sys.stderr)
        return 1
    print(f"published outbox replay complete login={args.login} published={result.published_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
