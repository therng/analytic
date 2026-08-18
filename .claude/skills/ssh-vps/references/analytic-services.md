WHEN: anything about the analytic stack services on forexvps (not the bridge) — status, ports, logs, NSSM config, install/repair context.

TOPOLOGY (single host — everything binds loopback except caddy):
```
MT5 terminals → bridge (nssm) → Redis 127.0.0.1:6379 (WSL2, service redis-wsl)
  → worker-v2 (analytic-worker) → PostgreSQL 127.0.0.1:5432 (postgresql-x64-18)
web (analytic-web :3000) reads Postgres + Redis live keys
caddy :80/:443 (only public exposure) → https://therng.duckdns.org → 127.0.0.1:3000
```

**SSH command patterns:** See command-execution-strategy.md (Tier 1 for most checks).

## Service inventory

| Service (nssm/sc name) | Runs | Port | Logs |
|---|---|---|---|
| `postgresql-x64-18` | EDB PostgreSQL 18 (Windows service, not nssm) | 127.0.0.1:5432 | pg log dir under `C:\Program Files\PostgreSQL\18\data\log` |
| `redis-wsl` | `wsl.exe -d Ubuntu -u root --exec redis-server /etc/redis/redis.conf` | 127.0.0.1:6379 | `C:\analytic\logs\redis-wsl-std{out,err}.log` |
| `analytic-worker` | `C:\nvm4w\nodejs\node.exe C:\analytic\dist\worker-v2.js` | 127.0.0.1:9200 (health) | `C:\analytic\logs\worker-std{out,err}.log` |
| `analytic-web` | `C:\nvm4w\nodejs\node.exe C:\analytic\.next\standalone\server.js` | 127.0.0.1:3000 | `C:\analytic\logs\web-std{out,err}.log` |
| `caddy` | `C:\caddy\caddy.exe run --config C:\analytic\Caddyfile.windows` | 0.0.0.0:80/443 | `C:\caddy\logs\caddy-std{out,err}.log` + `access.log` |

All nssm services run as `analyticvps\supachai`, SERVICE_AUTO_START, 10MB log rotation, `AppExit Default Restart`, `AppThrottle 1500`, `AppStopMethodConsole 25000`.

## Boot/dependency order

`DependOnService`: analytic-worker and analytic-web depend on `postgresql-x64-18` + `redis-wsl`; caddy depends on analytic-web. SCM starts data tier first after reboot. Worker exits 1 if Redis is down at boot — NSSM restarts it until the data tier is up; a few restart cycles right after boot are NORMAL, a persistent loop is not.

## Health checks (quick)

1. All services: `ssh forexvps 'powershell -NoProfile -Command "Get-Service postgresql-x64-18,redis-wsl,analytic-worker,analytic-web,caddy,bridge | Format-Table Name,Status"'`
2. Worker (component-aware, use this not web health): `ssh forexvps 'powershell -NoProfile -Command "(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9200/health).StatusCode"'` → 200 ok / 503 stale component. JSON body names the stale component.
3. Web: `(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/accounts).StatusCode` → 200 + JSON. NOTE: `/api/health` returns static `{ok:true}` — proves nothing.
4. Postgres: `& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U supachai -d trading_db -c "SELECT 1;"`
5. Redis (alive check WITHOUT echoing password): `ssh forexvps 'wsl -d Ubuntu --exec redis-cli ping'` → `PONG` (or `NOAUTH ...` = server up, auth required — both mean alive; `Connection refused` = down)
6. End-to-end from your machine: `curl -sI https://therng.duckdns.org/` → 200.

## Restarting a single stack service

`ssh forexvps 'nssm restart <name>'` (name from the table above; `Restart-Service postgresql-x64-18` for Postgres). Restart order within the chain still applies — data tier before worker/web if multiple are down (see full-restart.md). Confirm-first per SKILL.md global safety. After any restart: verify per "Health checks" above.

## Config/source-of-truth

- Env for web/worker lives in nssm `AppEnvironmentExtra` (DATABASE_URL/REDIS_URL/AUTH_*). NEVER dump the whole block — it contains secrets (see SKILL.md global safety).
- Stack env on host: `C:\analytic\.env` (gitignored).
- Install/migration source of truth: `docs/superpowers/plans/2026-08-17-windows-single-host-migration.md` + spec at `docs/superpowers/specs/2026-08-17-windows-single-host-migration-design.md`. NSSM install commands: plan Tasks 3/5.
