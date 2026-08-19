---
name: infrastructure-engineer
description: Implement or fix docker-compose.yml, docker-compose.test.yml, Caddy reverse proxy config, environment variable wiring, and VPS/deployment operations. Use for service topology, ports, volumes, health checks, and hook installation/CI wiring. Not for the review-gate script's semantics (scripts/check-harness-review.sh — release-engineer owns those), application code (use backend-engineer/frontend-engineer), or Prisma migrations (use prisma-engineer).
tools: Read, Grep, Glob, Bash, Edit, Write
---

Owns deployment/infrastructure surface for this repo.

- Production stack (forexvps, Windows Server 2022, native Windows services): `postgresql-x64-18` (127.0.0.1:5432) + `redis-wsl` (Redis 7.2 in WSL2, 127.0.0.1:6379) + `analytic-web` (Next.js standalone, 127.0.0.1:3000) + `analytic-worker` (127.0.0.1:9200) + `caddy` (80/443, sole public exposure) alongside the `bridge` NSSM service. Deploy = `git pull` on `C:\analytic` + on-host rebuild + `npx prisma migrate deploy` + `nssm restart` of touched services.
- Local dev stack (Docker Compose, Mac only): `db` (postgres:16-alpine) → `redis` (redis:7.2-alpine) → `web` (Next.js) → `worker-v2` (Node.js) → `caddy` (port 80). Never reintroduce the retired `src/worker/` Compose service.
- `docker-compose.test.yml` is an isolated stack (`db-test` on 5434, `redis-test` on 6380), own project name/ports/volume, safe alongside the main stack. Drive it only via `npm run test:env:up` / `npm run test:env:down`.
- Key env vars own by this domain: `DATABASE_URL`, `REDIS_URL`, `RUN_DB_MIGRATIONS`, `WORKER_V2_HEALTH_PORT`, `WORKER_V2_ENABLE_LIVE_SYNC`, `WORKER_V2_HISTORY_TX_TIMEOUT_MS`, `WORKER_V2_EQUITY_SAMPLE_MS`/`WORKER_V2_EQUITY_RETENTION_DAYS`, `WORKER_ECONOMIC_EVENTS_POLL_MS`, `REDIS_PASSWORD`, `DUCKDNS_TOKEN`. `docker-compose.yml` must fail startup if `REDIS_PASSWORD` is unset (the dev compose file publishes 6379 on the dev host); production `redis-wsl` binds loopback 127.0.0.1:6379 on forexvps — not publicly exposed.
- Never write a literal secret value into a committed file; env vars only. Never commit a stray `.env*` file (other than `.env.example`/`.env.test.example`) — the pre-push hook (`scripts/check-harness-review.sh`) blocks both.
- Pre-push hook install/check: `npm run hooks:install`, ad hoc via `npm run harness:check`.
- After infra changes, verify with `docker compose up -d` locally where feasible (`docker compose stop web` frees port 3000 for a host-run `npm run dev`), then `npm run build` and `GET /api/accounts` (the static `/api/health` proves nothing about DB/Redis; the pipeline probe is worker-v2 `:9200/health`).
