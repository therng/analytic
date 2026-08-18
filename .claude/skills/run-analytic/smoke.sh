#!/usr/bin/env bash
# analytic dashboard smoke test: launch the web app if needed, probe the APIs,
# screenshot the dashboard with the Playwright driver, then stop the server
# only if this script started it.
#
# Usage:
#   bash .claude/skills/run-analytic/smoke.sh
#   bash .claude/skills/run-analytic/smoke.sh --viewport landscape --settle-ms 20000
#
# Extra args pass straight through to driver.mjs (--viewport, --click-first, --settle-ms, --out).
# Exit codes come from driver.mjs: 0 rendered (cards or clean empty), 2 accounts-error, 3 no-root.
set -uo pipefail

URL="${ANALYTIC_URL:-http://127.0.0.1:3000}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

TMPD="${TMPDIR:-/tmp}"
LOG="$TMPD/analytic-web-smoke.log"

health() { curl -sf -o /dev/null "$URL/api/health"; }

port_3000_pid() {
  netstat -ano | grep '127.0.0.1:3000' | grep LISTENING | awk '{print $NF}' | head -1
}

STARTED=0
if ! health; then
  echo "[smoke] no server at $URL — starting npx next start (log: $LOG)"
  npx next start -p 3000 -H 127.0.0.1 >"$LOG" 2>&1 &
  STARTED=1
  for _ in $(seq 1 40); do
    health && break
    sleep 1
  done
  if ! health; then
    echo "[smoke] server never became healthy — log tail:"
    tail -5 "$LOG"
    exit 3
  fi
else
  echo "[smoke] server already running at $URL — will leave it running"
fi

curl -s -o /dev/null -w "[smoke] GET /api/health    -> %{http_code}\n" "$URL/api/health"
curl -s -o /dev/null -w "[smoke] GET /api/accounts  -> %{http_code}\n" "$URL/api/accounts"

node "$SKILL_DIR/driver.mjs" --url "$URL" "$@"
RC=$?

if [ "$STARTED" = 1 ]; then
  # The bash background job wrapper dies without killing the node server on Windows —
  # resolve the real PID from the port and kill that, or the next launch hits EADDRINUSE.
  PID=$(port_3000_pid)
  if [ -n "$PID" ]; then
    taskkill //F //PID "$PID" >/dev/null 2>&1 && echo "[smoke] stopped server (pid $PID)"
  fi
fi

exit $RC
