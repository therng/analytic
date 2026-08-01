---
name: pipeline-health-check
description: Use when checking whether the native MT5 bridge to Redis, ingestion worker, PostgreSQL, and dashboard data path is healthy, including missing accounts, stale live data, outbox backlog, or post-deploy verification.
---

# Native Pipeline Health Check

Use this skill for the current native path only:

```text
MT5 terminal -> python -m bridge -> per-account SQLite journal/outbox
             -> Redis mt5:account: -> ingestion worker -> PostgreSQL -> API/UI
```

Warning: never mix legacy and native evidence. This skill accepts only the
native bridge, its current ingestion worker, and Redis keys under
`mt5:account:`; any other bridge, service, worker, or namespace is not
evidence for native health and must not be used to explain it.

## Ownership and sources of truth

- `python -m bridge` under NSSM service `bridge` owns MT5 reads, fencing,
  complete live/history envelopes, per-account journal writes, and outbox
  publication attempts.
- The effective `BRIDGE_STATE_DIR` is the source of truth for bridge health,
  worker `state_generation`, durable `restart_count`, quarantine state, and
  per-login SQLite journals. Redis does not replace this state.
- Redis `mt5:account:` is the transport/current-live surface. Fenced live keys
  and the history stream prove publication, not durable acquisition.
- The ingestion worker owns Redis consumption and PostgreSQL persistence.
  PostgreSQL is authoritative for provisioned accounts and persisted history;
  the API/UI is a read-only consumer for this check.
- Never infer health from a single layer. A green service with stale health,
  an empty outbox with no Redis stream entries, or Redis data with no PostgreSQL
  persistence is an incomplete pipeline.

## 1. Discover runtime state

Run local container checks and the VPS bridge checks separately. Do not start a
second bridge process for diagnosis.

```bash
docker compose ps
ssh forexvps 'nssm status bridge'
ssh forexvps 'powershell -NoProfile -Command "nssm get bridge AppDirectory; nssm get bridge AppParameters; nssm get bridge AppStdout; nssm get bridge AppStderr"'
```

The service must run `python -m bridge` from `C:\analytic`. Resolve the
effective state directory from the service environment before reading health
or journals. Never print `bridge\\.env`, `REDIS_URL`, or lease values.

## 2. Bridge workers and health freshness

The expected shape is one supervisor plus one worker per discovered account or
login. Confirm the expected five profiles and exactly five active workers.
Terminal-window count is not worker count.

For each profile, read its health JSON and record:

- `state`, login, `state_generation`, `restart_count`
- transition reason/time and quarantine
- `last_successful_live_poll_utc`
- `last_successful_history_window_utc`
- current lease-fence presence without exposing its value

Take two samples separated by at least two supervisor ticks. Live-poll times
must advance. Generation and restart count must stay stable after startup; an
increase requires a correlated worker exit/restart event. A duplicate spawn is
harmless only when it is bounded overlap, the previous owner exits/releases,
and the replacement reaches `running` with fresh live data. Repeated duplicate
ownership, a surviving old owner, quarantine, or a worker that never reaches
`running` is a failure.

## 3. Fresh logs only

Create a UTC checkpoint before reading logs. Resolve the actual NSSM stdout,
stderr, and bridge log paths first, then inspect only entries newer than that
checkpoint:

```powershell
$checkpoint = [DateTime]::UtcNow
$patterns = 'journal_failure|unexpected_fatal|duplicate_ownership|SQLite|cross-thread|foreign key|outbox.*dispatch|dispatch_once failed'
Get-ChildItem $logPaths -File | Get-Content | Select-String -Pattern $patterns |
  Where-Object { $_.Line -match $checkpoint.ToString('yyyy-MM-dd') }
```

The exact error signatures `journal_failure`, `unexpected_fatal`, SQLite
cross-thread errors, foreign-key errors, and persistent outbox dispatch errors
are failures. A duplicate ownership line is classified using the worker and
health evidence above, not by log text alone.

## 4. SQLite journal and outbox

Inspect each `journal\\<login>.sqlite3` read-only using a separate connection.
SQLite is authoritative for durable acquisition and outbox state. Check for
database errors, then compare two samples of state counts and publication
timestamps:

```sql
SELECT state, COUNT(*) AS rows
FROM outbox_messages
GROUP BY state
ORDER BY state;

SELECT COUNT(*) AS pending_or_inflight
FROM outbox_messages
WHERE state IN ('PENDING', 'INFLIGHT');

SELECT MAX(published_at_utc) AS newest_publish,
       COUNT(redis_entry_id) AS published_with_stream_id
FROM outbox_messages
WHERE state = 'PUBLISHED';
```

Pending/inflight rows must drain or remain bounded while new publications
continue. Quarantined rows, a growing backlog, missing stream IDs for published
rows, or a journal error is unhealthy. Never delete rows or state files during
this check.

## 5. Redis transport evidence

Use only the native namespace and never print values or credentials:

```bash
docker compose exec -T redis sh -lc 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" --scan --pattern "mt5:account:{*}:*"'
```

For each login, verify lease/live key existence and TTL, then compare `XLEN`
or `XINFO STREAM` for `mt5:account:{<login>}:stream:history`. A fresh bridge
live-poll timestamp plus changing live key/stream evidence proves current
publication. Redis alone does not prove journal durability or PostgreSQL
persistence. There is no `stream:live` — it was removed (write-only, zero
consumers); don't look for it.

## 6. Ingestion and PostgreSQL

Identify the active ingestion worker from `docker compose ps`; inspect its
fresh logs for consumption, persistence, schema, and connection errors. Then
verify PostgreSQL has the expected account rows and recent current-state data:

```bash
docker compose logs --since 5m <ingestion-service>
docker compose exec -T db psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "Account";'
docker compose exec -T db psql "$DATABASE_URL" -c 'SELECT MAX("observedAt") FROM "AccountSnapshot";'
```

Use the repository schema if deployed column names differ. Recent PostgreSQL
state must follow fresh Redis publication; missing accounts, stale snapshots,
or repeated persistence errors fail the end-to-end check.

## Safety

This skill is read-only. For a restart, deployment, state repair, or code fix,
route to the relevant operational or implementation workflow. Do not start a
second or unconfigured bridge/worker, and do not delete locks, journals,
health/quarantine files, Redis leases, or outbox rows.
