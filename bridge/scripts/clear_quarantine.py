"""Operator CLI to unquarantine bridge accounts after a fix that made the
prior quarantine reason moot (e.g. journal ACL repaired). Restarting the
bridge service does NOT clear quarantine by design (quarantine.py) --
this is the sanctioned way.

Usage (from repo root or bridge/):
    python -m bridge.scripts.clear_quarantine --state-dir <state_dir> --all --operator <you>
    python -m bridge.scripts.clear_quarantine --state-dir <state_dir> --profile-id <id> --operator <you>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from bridge.quarantine import QuarantineStore


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--operator", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="clear every active quarantine")
    group.add_argument("--profile-id", help="clear one account by profile_id")
    args = parser.parse_args()

    store = QuarantineStore(args.state_dir)

    if args.profile_id:
        targets = [args.profile_id]
    else:
        targets = [r.profile_id for r in store.list_active()]

    if not targets:
        print("no active quarantines found")
        return 0

    for profile_id in targets:
        cleared = store.clear(profile_id, operator=args.operator)
        print(f"cleared {profile_id} (login={cleared.login}, was: {cleared.quarantine_reason})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
