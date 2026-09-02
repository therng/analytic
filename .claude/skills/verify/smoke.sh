#!/usr/bin/env bash
# analytic dashboard smoke test: launch the app on a spare port if none is
# running, probe the APIs, screenshot the dashboard with the Playwright driver,
# then stop only a server this script started itself.
#
# Usage:
#   bash .claude/skills/verify/smoke.sh
#   bash .claude/skills/verify/smoke.sh --viewport landscape --click-first --heatmap
#
# Extra args pass straight through to driver.mjs (--viewport, --click-first,
# --heatmap, --settle-ms, --out). Exit codes come from driver.mjs:
# 0 rendered (cards or clean empty), 2 accounts-error, 3 no-root, 1 driver failure.
#
# PRODUCTION GUARD: production web (analytic-web NSSM) owns 127.0.0.1:3000.
# This script never starts or kills anything on port 3000. To verify a fresh
# deploy, set ANALYTIC_URL=http://localhost:3000 — the script then only probes
# and screenshots, leaving the running services untouched.
set -uo pipefail

URL="${ANALYTIC_URL:-http://localhost:3100}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
NODE_BIN="${NODE_BIN:-C:/nvm4w/nodejs/node.exe}"
cd "$REPO_ROOT"

TMPD="${TMPDIR:-/tmp}"
LOG="$TMPD/analytic-smoke-server.log"

url_port() { printf '%s' "$URL" | sed -E 's|.*[:/]([0-9]+).*|\1|'; }
PORT="$(url_port)"; PORT="${PORT:-3100}"
IS_PROD=0
[ "$PORT" = "3000" ] && IS_PROD=1

health() { curl -sf -o /dev/null "$URL/api/health"; }
accounts_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/accounts")" = "200" ]; }

port_pid() { netstat -ano | grep "[:.]$PORT " | grep -i LISTENING | awk '{print $NF}' | head -1; }

STARTED=0
if health; then
  echo "[smoke] server already running at $URL — will leave it running"
else
  if [ "$IS_PROD" = "1" ]; then
    echo "[smoke] REFUSING to start a server on port 3000 (production analytic-web)."
    echo "[smoke] If production is down, restore it via: nssm start analytic-web"
    exit 4
  fi
  echo "[smoke] no server at $URL — starting one (log: $LOG)"
  if [ -f .next/standalone/server.js ]; then
    echo "[smoke] mode: production standalone build on :$PORT"
    ( cd .next/standalone && PORT="$PORT" HOSTNAME=127.0.0.1 NODE_ENV=production TZ=Asia/Bangkok "$NODE_BIN" server.js ) >"$LOG" 2>&1 &
  else
    echo "[smoke] mode: next dev (Turbopack) on :$PORT — honest surface for uncommitted changes"
    PORT="$PORT" npx next dev -p "$PORT" >"$LOG" 2>&1 &
  fi
  STARTED=1
  for _ in $(seq 1 60); do
    health && break
    sleep 1
  done
  if ! health; then
    echo "[smoke] server never became healthy — log tail:"
    tail -5 "$LOG"
    exit 3
  fi
fi

# Liveness alone proves nothing about the data plane (CLAUDE.md) — /api/accounts
# is the real probe (DB + Redis read path). Judge by status code, not JSON shape.
curl -s -o /dev/null -w "[smoke] GET /api/health    -> %{http_code}\n" "$URL/api/health"
curl -s -o /dev/null -w "[smoke] GET /api/accounts  -> %{http_code}\n" "$URL/api/accounts"

"$NODE_BIN" "$SKILL_DIR/driver.mjs" --url "$URL" "$@"
RC=$?

if [ "$STARTED" = "1" ]; then
  # The bash background job wrapper dies without killing the node server on Windows —
  # resolve the real PID from the port and kill that, or the next launch hits EADDRINUSE.
  PID=$(port_pid)
  if [ -n "$PID" ]; then
    taskkill //F //PID "$PID" >/dev/null 2>&1 && echo "[smoke] stopped server it started (pid $PID)"
  fi
fi

exit $RC
