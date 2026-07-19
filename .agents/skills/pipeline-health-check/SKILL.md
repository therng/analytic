---
name: pipeline-health-check
description: Use when checking whether the MT5 bridge → Redis → worker/worker-v2 → Postgres ingestion pipeline is actually working — accounts not showing up on the dashboard, "unknown login" errors in worker logs, suspected DB reset/data loss, verifying account provisioning after a deploy, or any "is the pipeline healthy" / "check live data" / "why is X account missing" question. Triggers include "check pipeline", "check live data", "pipeline health", "is ingestion working", "account not showing up", "unknown login errors".
---

# Pipeline Health Check

Local docker-compose stack: `db` (Postgres 15, port 5433), `redis` (port 6379), `worker` (legacy, provisions accounts + backfill), `worker-v2` (Deal/Order consumer, live-sync), `web`, `caddy`. Full architecture: `AGENTS.md` "Architecture" + "Data Path".

Run checks in this order — each step's output explains the next one's result.

## 1. Containers up

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"
```

All of `analytic-db-1`, `analytic-redis-1`, `analytic-worker-1`, `analytic-worker-v2-1`, `analytic-web-1`, `analytic-caddy-1` should be `Up` and `(healthy)`. Note any container with a recent `Up` time relative to how long the stack should have been running — a container that restarted recently (esp. `analytic-db-1`) means state was reset; go straight to step 3.

## 2. Redis: what accounts is the bridge actually publishing

```bash
docker exec analytic-redis-1 redis-cli -a "$(grep REDIS_PASSWORD .env | cut -d= -f2 | tr -d \")" keys "mt5:*" 2>&1 | grep -v Warning | sed -E 's/[0-9]{5,}/N/g' | sort -u
```

Current bridge (`bridge_v2`) publishes only `mt5:v2:account:*:live`/`:positions`, `mt5:v2:bridge:*`, `mt5:v2:history:*`. If you see `mt5:account:*` (no `v2`) instead, the bridge is running an old version — that's a VPS-side problem, not a worker problem (see `ssh-vps` skill).

## 3. Postgres: are accounts actually provisioned

```bash
docker exec analytic-db-1 psql -U supachai -d trading_db -c 'SELECT account_number, owner_name, company, currency, server, broker_utc_offset_minutes FROM "Account";'
```

- **Zero rows** → DB was reset or `ensureBridgeAccounts()` (`src/worker/bridge-accounts.ts`) isn't finding accounts in Redis. Check step 2's key prefix matches `LIVE_KEY_PREFIX` in that file (currently `mt5:v2:account:`) — a prefix drift here is exactly what broke this pipeline once already (see git history on `bridge-accounts.ts`).
- **Rows exist but `broker_utc_offset_minutes` is empty/NULL** → ingestion is blocked for those accounts per AGENTS.md ("Broker offset"). Nothing will be written to `Deal`/`Order`/`Position` until set:
  ```bash
  node --import tsx scripts/set-broker-utc-offset.ts --list
  node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>
  ```

Table/column names use Prisma's `@@map` — model `TradingAccount` maps to SQL table `Account`, with snake_case columns (`account_number`, `broker_utc_offset_minutes`, etc.), not the camelCase Prisma field names.

## 4. Worker logs: is ingestion actually flowing or erroring

```bash
docker logs analytic-worker-1 --since 5m 2>&1 | tail -30
docker logs analytic-worker-v2-1 --since 5m 2>&1 | tail -30
echo "--- unknown login count (should be 0 once step 3 accounts exist) ---"
docker logs analytic-worker-v2-1 --since 5m 2>&1 | grep -c "unknown login"
echo "--- restart counts (repeated restarts = crash loop) ---"
docker inspect analytic-worker-1 --format 'worker RestartCount: {{.RestartCount}}'
docker inspect analytic-worker-v2-1 --format 'worker-v2 RestartCount: {{.RestartCount}}'
```

`worker-v2` logging "unknown login for deal/order login=X" repeatedly means `X` has no `TradingAccount` row yet — go back to step 3. `worker` erroring "table does not exist" or "column does not exist" means a migration didn't apply — check `docker logs analytic-db-1` and `npx prisma migrate status` inside the web/worker container.

## 5. Live data freshness (once steps 1-4 are clean)

```bash
docker exec analytic-db-1 psql -U supachai -d trading_db -c '
SELECT account_id, MAX(ts) as latest, COUNT(*) as cnt
FROM "EquitySnapshot" GROUP BY account_id;'
```

`latest` should be within the last couple minutes for an actively-traded account (`EquitySnapshot` samples every 60s per AGENTS.md). Stale timestamps with healthy containers and correct Redis keys usually mean the equity-sampler loop itself is stuck — check `docker logs analytic-worker-v2-1` for `live-sync` errors.

## Read-only by default

Every command above only reads state. If a check reveals something to fix (missing account, unset offset, stale prefix in code), stop and confirm with the user before writing — this skill is diagnosis only, not remediation.
