#!/usr/bin/env bash
# Pre-push guard (lean): no push may carry a hardcoded secret or a stray .env
# file. The domain review-evidence gate was retired — reviews are invoked via
# .claude/skills/analytic-harness/ at the operator's discretion, not enforced
# per-push.
#
# Usage:
#   scripts/check-harness-review.sh                 # as a git pre-push hook (reads stdin)
#   scripts/check-harness-review.sh <base> <head>    # manual/CI: explicit range
set -euo pipefail

ZERO=0000000000000000000000000000000000000000
SECRET_RE='(REDIS_PASSWORD|DATABASE_URL|DUCKDNS_TOKEN)[[:space:]]*[:=][[:space:]]*[^[:space:]$][^[:space:]]*'
# "${VAR}" interpolation (incl. quoted docker-compose form) is a reference, not a literal
# KNOWN GAP: only the brace form is exempt — a quoted bare ref (KEY: "$VAR")
# still trips SECRET_RE. Use ${VAR} everywhere (current repo convention).
SECRET_INTERP_RE='(REDIS_PASSWORD|DATABASE_URL|DUCKDNS_TOKEN)[[:space:]]*[:=][[:space:]]*["'\'']?[$]\{'

fail=0

check_range() {
  local base="$1" head="$2"
  if [ "$base" = "$ZERO" ]; then
    base="$(git merge-base origin/main "$head" 2>/dev/null || true)"
    if [ -z "$base" ]; then
      echo "BLOCKED: cannot determine push range (no origin/main to merge-base against); refusing to narrow the check to the last commit."
      fail=1
      return 0
    fi
  fi
  [ "$base" = "$head" ] && return 0

  local files
  files="$(git diff --name-only "$base" "$head")"
  [ -z "$files" ] && return 0

  # stray .env files
  local env_hits
  env_hits="$(echo "$files" | grep -E '(^|/)\.env(\..+)?$' | grep -vE '\.env\.(test\.example|example)$' || true)"
  if [ -n "$env_hits" ]; then
    echo "BLOCKED: committed .env file(s) not allowed:"
    echo "$env_hits" | sed 's/^/  /'
    fail=1
  fi
  if git diff "$base" "$head" | grep -E '^\+' | grep -vE "$SECRET_INTERP_RE" | grep -qE "$SECRET_RE"; then
    echo "BLOCKED: added line matches a credential pattern (REDIS_PASSWORD/DATABASE_URL/DUCKDNS_TOKEN)."
    echo "  Remove the literal and use an env var reference instead."
    fail=1
  fi
}

if [ "$#" -eq 2 ]; then
  check_range "$1" "$2"
else
  while read -r local_ref local_sha remote_ref remote_sha; do
    [ "$local_sha" = "$ZERO" ] && continue
    check_range "$remote_sha" "$local_sha"
  done
fi

exit $fail
