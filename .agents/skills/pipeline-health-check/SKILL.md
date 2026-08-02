---
name: pipeline-health-check
description: Use when checking whether the native MT5 bridge, Redis transport, ingestion worker, PostgreSQL persistence, and dashboard data path are healthy, including missing accounts, stale live data, outbox backlog, or post-deploy verification.
---

# Native Pipeline Health Check

Read-only runbook for the current native path:

```text
MT5 terminal -> python -m bridge -> SQLite journal/outbox
             -> Redis mt5:account:* -> worker-v2 -> PostgreSQL -> API/UI
```

Do not mix legacy evidence. Only these are native-health evidence:

- NSSM service `bridge` running `python -m bridge` from `C:\analytic`.
- Bridge state under the effective `BRIDGE_STATE_DIR`.
- SQLite journals under that state directory.
- Redis keys under `mt5:account:{<login>}:*`.
- `worker-v2` and PostgreSQL rows written from native streams.

Never print secrets, Redis values, lease tokens, `bridge\.env`, `DATABASE_URL`,
`REDIS_URL`, or `REDIS_PASSWORD`.

## 0. Pick The Execution Surface

First identify where each layer actually runs. Do not assume one shell can see
every service.

- Local shell: repo files and local tests. Docker may be blocked by sandbox.
- `forexvps`: Windows MT5 terminals and NSSM `bridge`. Do not assume Docker,
  `node_modules`, `tsx`, or built worker artifacts exist there.
- Container host: Docker Compose services (`redis`, `db`, `worker-v2`, `web`).
  Use it only after `docker compose ps` succeeds on that host.

If `docker compose ps` fails with Docker socket permission, report that local
container evidence is unavailable. Do not retry with unrelated commands. Request
escalation only if local Docker evidence is required.

## 1. Runtime State

Run these as separate commands so a quoting failure does not hide partial output:

```bash
docker compose ps
ssh forexvps 'nssm status bridge'
ssh forexvps 'powershell -NoProfile -Command "nssm get bridge AppDirectory"'
ssh forexvps 'powershell -NoProfile -Command "nssm get bridge AppParameters"'
ssh forexvps 'powershell -NoProfile -Command "nssm get bridge AppStdout"'
ssh forexvps 'powershell -NoProfile -Command "nssm get bridge AppStderr"'
```

Pass criteria:

- `bridge` is `SERVICE_RUNNING`.
- AppDirectory is `C:\analytic`.
- AppParameters is `-m bridge`.
- stdout/stderr paths are known for fresh-log checks.

## 2. Bridge Health Files

Resolve the effective state directory from service configuration or safe
non-secret env-name checks. Do not dump `bridge\.env`.

Read:

- `<state>\health\supervisor.json`
- `<state>\health\<profile_id>.json`
- `<state>\quarantine\*.json`

For each account health file, record only:

- login, state, state_generation, restart_count
- last_transition_reason and last_transition_at_utc
- last_successful_live_poll_utc
- last_successful_history_window_utc
- whether current_lease_fence exists, never its contents
- active quarantine status

Take two samples at least two supervisor ticks apart. Live poll times should
advance. State generation and restart count should remain stable after startup.
Exactly five active account workers are expected for the current VPS account
set unless the operator has changed the account list.

Failures:

- missing supervisor health
- no health file for an expected login
- state not `running`
- active quarantine
- stale live poll timestamp
- restart_count or state_generation increasing without an explained restart
- duplicate workers that do not converge to one running owner

## 3. Fresh Logs Only

Create a UTC checkpoint before reading logs. Inspect only entries newer than
that checkpoint and only from the resolved NSSM stdout/stderr or bridge log
paths.

```powershell
$checkpoint = [DateTime]::UtcNow
$patterns = 'journal_failure|unexpected_fatal|duplicate_ownership|SQLite|cross-thread|foreign key|outbox.*dispatch|dispatch_once failed'
Get-ChildItem $logPaths -File |
  Get-Content |
  Select-String -Pattern $patterns |
  Where-Object { $_.Line -match $checkpoint.ToString('yyyy-MM-dd') }
```

Classify duplicate ownership from health and worker evidence, not log text
alone. Persistent journal, SQLite, foreign-key, or outbox dispatch errors are
failures.

## 4. SQLite Journal And Outbox

Inspect every `<state>\journal\<login>.sqlite3` read-only with a separate
SQLite connection. SQLite is durable acquisition truth; Redis is not.

Run:

```sql
PRAGMA quick_check;
PRAGMA integrity_check;

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

Take two samples. Pending/inflight must drain or remain bounded while
`newest_publish` advances. Fail on corrupt journals, quarantined rows, growing
backlog, or published rows missing stream IDs.

## 5. Redis Native Transport

Use only native keys. There is no `stream:live`.

```bash
docker compose exec -T redis sh -lc 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" --scan --pattern "mt5:account:{*}:*"'
```

For each login, check existence/TTL without printing values:

- `mt5:account:{<login>}:lease`
- `mt5:account:{<login>}:live`
- `mt5:account:{<login>}:stream:history`

Use `TTL`, `XLEN`, or `XINFO STREAM`. Redis proves publication and current
transport only. It does not prove durable acquisition or PostgreSQL persistence.

## 6. Worker-V2 And PostgreSQL

Only run Docker commands on the host where Compose is available.

```bash
docker compose ps
docker compose logs --since 5m worker-v2
docker compose exec -T db psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "Account";'
docker compose exec -T db psql "$DATABASE_URL" -c 'SELECT MAX("observed_at") FROM "AccountSnapshot";'
```

If schema names differ, inspect `prisma/schema.prisma` and use mapped SQL
column names. PostgreSQL must show expected accounts and recent snapshots after
fresh Redis publication. Worker logs must not show repeated schema, validation,
Redis, or database write errors.

## 7. Dashboard/API Read Path

Use this only after bridge, Redis, worker, and PostgreSQL checks have evidence.

```bash
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:3000/api/accounts
```

Dashboard/API health does not replace pipeline health. It is the final read
surface only.

## Report Format

Report by layer:

```text
bridge service: pass/fail/blocked
bridge health: pass/fail/blocked
journals/outbox: pass/fail/blocked
redis native transport: pass/fail/blocked
worker-v2/postgresql: pass/fail/blocked
api/ui read path: pass/fail/blocked
```

For blocked layers, include the exact boundary, such as "local Docker socket
permission denied" or "VPS has no node_modules/tsx". Do not convert blocked
evidence into pass/fail for the whole pipeline.

## Safety

Read-only means no restart, no deploy, no reset, no deletes, no lock edits, no
journal writes, no Redis key mutation, no second bridge process. Route fixes to
the appropriate implementation or VPS ops workflow.
