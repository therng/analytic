#!/usr/bin/env bash
# Enforces the analytic-harness routing table (docs/harness/analytic/team-spec.md):
# pushes touching a reviewed domain must carry evidence a reviewer ran, and no
# push may carry a hardcoded secret or stray .env file.
#
# Usage:
#   scripts/check-harness-review.sh                 # as a git pre-push hook (reads stdin)
#   scripts/check-harness-review.sh <base> <head>    # manual/CI: explicit range
set -euo pipefail

DOMAIN_MARKER_RE='(ingestion|analytics|dashboard)[ _-]review'
SECRET_RE='(REDIS_PASSWORD|DATABASE_URL|DUCKDNS_TOKEN)[[:space:]]*[:=][[:space:]]*[^[:space:]$][^[:space:]]{3,}'

fail=0

check_range() {
  local base="$1" head="$2"
  [ "$base" = "0000000000000000000000000000000000000000" ] && base="$(git merge-base origin/main "$head" 2>/dev/null || echo "$head~1")"
  [ "$base" = "$head" ] && return 0

  local files
  files="$(git diff --name-only "$base" "$head")"
  [ -z "$files" ] && return 0

  local touched_ingestion=0 touched_analytics=0 touched_dashboard=0
  echo "$files" | grep -qE '^(bridge/|src/worker|prisma/)' && touched_ingestion=1
  echo "$files" | grep -qE '^src/lib/trading/|^src/app/api/accounts' && touched_analytics=1
  echo "$files" | grep -qE '^src/components/trading-monitor/|^src/app/globals\.css' && touched_dashboard=1

  # secrets / stray .env files
  local env_hits
  env_hits="$(echo "$files" | grep -E '(^|/)\.env(\..+)?$' | grep -vE '\.env\.(test\.example|example)$' || true)"
  if [ -n "$env_hits" ]; then
    echo "BLOCKED: committed .env file(s) not allowed:"
    echo "$env_hits" | sed 's/^/  /'
    fail=1
  fi
  if git diff "$base" "$head" | grep -E '^\+' | grep -qE "$SECRET_RE"; then
    echo "BLOCKED: added line matches a credential pattern (REDIS_PASSWORD/DATABASE_URL/DUCKDNS_TOKEN)."
    echo "  Remove the literal and use an env var reference instead."
    fail=1
  fi

  # domain review evidence: a commit message in range mentions the domain review,
  # or a durable review artifact for that domain is present in the tree at head.
  local log
  log="$(git log --format=%B "$base..$head" 2>/dev/null || true)"
  for domain in ingestion analytics dashboard; do
    local touched_var="touched_$domain" skill_path=""
    case "$domain" in
      ingestion) skill_path=".agents/skills/bridge-ingestion-review/SKILL.md" ;;
      analytics) skill_path=".agents/skills/trading-analytics-review/SKILL.md" ;;
      dashboard) skill_path=".agents/skills/dashboard-responsive-review/SKILL.md" ;;
    esac
    if [ "${!touched_var}" = "1" ]; then
      if echo "$log" | grep -qiE "${domain}[ _-]review" ; then
        continue
      fi
      if git show "$head:_workspace/02_review_${domain}.md" >/dev/null 2>&1; then
        continue
      fi
      echo "BLOCKED: change touches the ${domain} domain (team-spec.md routing table)"
      echo "  but no commit in range mentions '${domain} review' and no"
      echo "  _workspace/02_review_${domain}.md is present."
      echo "  Run ${skill_path} and note the result"
      echo "  in a commit message (e.g. '${domain} review: pass') before pushing."
      fail=1
    fi
  done
}

if [ "$#" -eq 2 ]; then
  check_range "$1" "$2"
else
  while read -r local_ref local_sha remote_ref remote_sha; do
    [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue
    check_range "$remote_sha" "$local_sha"
  done
fi

exit $fail
