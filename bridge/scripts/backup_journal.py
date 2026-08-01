from __future__ import annotations

import argparse
import json
from pathlib import Path

from bridge.journal.backup import backup_journal


def main() -> int:
    parser = argparse.ArgumentParser(description="Back up a bridge SQLite journal.")
    parser.add_argument("source")
    parser.add_argument("destination")
    args = parser.parse_args()

    manifest = backup_journal(Path(args.source), Path(args.destination))
    print(json.dumps(manifest.__dict__, default=str, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
