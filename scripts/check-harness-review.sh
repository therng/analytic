#!/usr/bin/env bash
# Enforces the analytic-harness routing table (docs/harness/analytic/team-spec.md):
# pushes touching a reviewed domain must carry evidence a reviewer ran, and no
# push may carry a hardcoded secret or stray .env file.
#
# Evidence accepted for a touched domain (either one):
#   1. a commit IN THE PUSHED RANGE whose diff touches that domain's paths and
#      whose message carries a passing marker — "<domain> review: pass"
#      (skill-name forms like "bridge-ingestion-review: pass" and
#      "dashboard-responsive-review: pass" also match), or
#   2. the canonical artifact _workspace/02_review_<domain>.md added or
#      modified within the pushed range. Stale committed artifacts never
#      satisfy the gate; suffixed/historical review records belong under
#      _workspace/review-log/ and are ignored.
#
# Path triggers approximate the routing table: all of prisma/ counts as
# ingestion (a reviewer may no-op with a note for non-ingestion-only diffs),
# and the multi-reviewer rows (Analytics+Dashboard, Ingestion+Analytics) rely
# on the coordinator invoking the second reviewer — paths alone cannot prove
# a response-shape or analytics impact.
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

INGESTION_PATH_RE='^(bridge/|src/worker|prisma/|src/lib/redis-mt5|src/lib/mt5-redis-keys|scripts/set-broker-utc-offset\.ts)'
ANALYTICS_PATH_RE='^src/lib/trading/|^src/app/api/accounts'
DASHBOARD_PATH_RE='^src/components/trading-monitor/|^src/app/globals\.css|^src/app/(page|layout|loading)\.tsx'

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

  local touched_ingestion=0 touched_analytics=0 touched_dashboard=0
  echo "$files" | grep -qE "$INGESTION_PATH_RE" && touched_ingestion=1
  echo "$files" | grep -qE "$ANALYTICS_PATH_RE" && touched_analytics=1
  echo "$files" | grep -qE "$DASHBOARD_PATH_RE" && touched_dashboard=1

  # secrets / stray .env files
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

  # domain review evidence, scoped to the pushed range
  local domain marker_re path_re skill_path domain_files
  for domain in ingestion analytics dashboard; do
    local touched_var="touched_$domain"
    case "$domain" in
      ingestion)
        path_re="$INGESTION_PATH_RE"
        marker_re='(bridge-)?ingestion[ _-]review'
        skill_path=".claude/skills/bridge-ingestion-review/SKILL.md"
        ;;
      analytics)
        path_re="$ANALYTICS_PATH_RE"
        marker_re='(trading-)?analytics[ _-]review'
        skill_path=".claude/skills/trading-analytics-review/SKILL.md"
        ;;
      dashboard)
        path_re="$DASHBOARD_PATH_RE"
        marker_re='dashboard(-responsive)?[ _-]review'
        skill_path=".claude/skills/dashboard-responsive-review/SKILL.md"
        ;;
    esac
    if [ "${!touched_var}" != "1" ]; then
      continue
    fi

    # evidence 1: a commit touching this domain's paths in range carries a
    # passing marker (a marker in a commit that does not touch the domain is
    # not evidence for it)
    domain_files="$(echo "$files" | grep -E "$path_re" || true)"
    if [ -n "$domain_files" ]; then
      local -a pathspecs=()
      while IFS= read -r f; do
        pathspecs+=(":(literal)$f")
      done <<< "$domain_files"
      if git log --format=%B "$base..$head" -- "${pathspecs[@]}" 2>/dev/null \
        | grep -qiE "${marker_re}[[:space:]]*[:|-]?[[:space:]]*(pass|passed)"; then
        continue
      fi
    fi

    # evidence 2: canonical artifact added/modified within the range
    if git diff --name-only --diff-filter=AM "$base" "$head" | grep -qx "_workspace/02_review_${domain}.md"; then
      continue
    fi

    echo "BLOCKED: change touches the ${domain} domain (team-spec.md routing table)"
    echo "  but no commit in range pairs '${domain} review: pass' with a ${domain}-path diff"
    echo "  and _workspace/02_review_${domain}.md was not added/updated in this range."
    echo "  Run ${skill_path} and either note '${domain} review: pass' in the"
    echo "  commit message or commit the refreshed artifact before pushing."
    fail=1
  done
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
