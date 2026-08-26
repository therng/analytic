# C4 Model — analytic (Trading Account Monitor)

Scope: whole repository. Levels: Context and Container (Simon Brown's default; no
Component/Code level produced). Originally retro-documented 2026-07-30; maintained
against `src/worker-v2/`, `src/app/api/`, `bridge/`, `Caddyfile.windows`,
`prisma/schema.prisma`. Last audited 2026-08-26 — the retired `docker-compose.yml`
topology and `src/worker`/`src/worker-v3` runtimes are gone from the repo.

## Context Diagram

```mermaid
C4Context
  title System Context — analytic Trading Account Monitor

  Person(operator, "Dashboard Operator", "Views account balance/equity/growth, drills into trade history")

  System_Boundary(analytic, "analytic") {
    System(dashboard, "Trading Account Monitor", "Next.js web app + worker + bridge; ingests MT5 account data and serves the operator dashboard")
  }

  System_Ext(mt5, "MT5 Terminals / API", "MetaTrader 5 terminals running on the Windows Forex VPS; source of account, deal, order, position data")
  System_Ext(identity, "Identity Providers", "Google OAuth, Apple OAuth — operator sign-in via NextAuth v5")
  System_Ext(forexfactory, "Forex Factory", "nfs.faireconomy.media economic calendar feed, polled hourly")
  System_Ext(infra, "Infrastructure Services", "DuckDNS dynamic DNS + ZeroSSL/Let's Encrypt ACME certificate issuance for the DuckDNS hostname")

  Rel(operator, dashboard, "Views accounts, drills into trade history", "HTTPS")
  Rel(dashboard, mt5, "Reads live account/position/deal/order data", "MT5 API, via the native bridge (NSSM) on the VPS")
  Rel(dashboard, identity, "Authenticates operator", "OAuth 2.0")
  Rel(dashboard, forexfactory, "Polls economic calendar", "HTTPS, hourly")
  Rel(dashboard, infra, "Obtains TLS certificate for public hostname", "ACME DNS-01")
```

## Container Diagram

```mermaid
C4Container
  title Container Diagram — analytic Trading Account Monitor

  Person(operator, "Dashboard Operator")

  System_Ext(mt5, "MT5 Terminals", "Runs on the Windows Forex VPS")
  System_Ext(identity, "Identity Providers", "Google OAuth, Apple OAuth")
  System_Ext(forexfactory, "Forex Factory", "Economic calendar feed")
  System_Ext(infra, "Infrastructure Services", "DuckDNS + ACME (ZeroSSL/Let's Encrypt)")

  System_Boundary(vps, "forexvps — Windows Server 2022 (native Windows services, single host)") {
    Container(bridge, "bridge", "Python (NSSM service)", "Repo-tracked source (bridge/). Reads MT5 terminals, publishes live state and history streams to Redis; owns backfill/coverage bookkeeping in its own host-local SQLite journal (ADR-0005)")
    Container(caddy, "caddy", "Caddy Windows binary w/ DuckDNS DNS-01 plugin (NSSM)", "Reverse proxy, TLS termination on 80/443 — the sole public exposure")
    Container(web, "analytic-web", "Next.js 16 App Router, React 19, Node.js standalone (NSSM)", "Dashboard UI + API routes on 127.0.0.1:3000. Migrations run at deploy time, not service start")
    Container(worker, "analytic-worker", "Node.js, esbuild bundle (NSSM)", "Sole background worker on 127.0.0.1:9200 (health): durable Deal/Order/Position ingestion, account provisioning, live-state sync, equity/excursion sampling, economic calendar polling")
    ContainerDb(db, "postgresql-x64-18", "PostgreSQL 18 (EDB, Windows service)", "Durable store: accounts, deals, orders, positions, snapshots, economic events. 127.0.0.1:5432 only (PG16 installed-but-stopped, uninstall pending — see migration plan progress log)")
    ContainerDb(redis, "redis-wsl", "Redis 7.2 in WSL2, AOF+RDB, password-protected", "Live-state cache + history stream transport. Binds 127.0.0.1:6379 — loopback only")
  }

  Rel(operator, caddy, "HTTPS")
  Rel(caddy, web, "Reverse proxies", "HTTP, frontend_net")

  Rel(web, identity, "Authenticates operator", "OAuth 2.0")

  Rel(web, db, "Reads/writes accounts, reports, trade history", "Prisma / SQL")
  Rel(web, redis, "Reads live account/position keys (trading fast path)", "Redis GET/HGETALL, bypasses Postgres for near-real-time data")
  Rel(web, redis, "Reads/writes emoji reaction counters (unrelated social feature)", "Redis Lua EVAL")

  Rel(worker, db, "Writes Deal/Order/Position/OpenPosition/AccountSnapshot/EquitySnapshot/PositionExcursion/EconomicEvent", "Prisma / SQL")
  Rel(worker, redis, "Consumes history streams via consumer groups; reads live-state keys", "Redis XREADGROUP / GET")
  Rel(worker, redis, "ACKs consumed stream entries after the Postgres commit", "Redis XACK (consumer-group offset only — no coordination meaning; the bridge's SQLite journal owns backfill progress per ADR-0005)")
  Rel(worker, forexfactory, "Polls economic calendar (economic-events-poller.ts)", "HTTPS, hourly")

  Rel(bridge, mt5, "Reads account/deal/order/position data", "MT5 API")
  Rel(bridge, redis, "Writes live-state keys and XADDs history stream chunks with barriers", "Redis, password-authed over loopback 127.0.0.1:6379")

  Rel(caddy, infra, "Obtains/renews TLS certificate", "ACME DNS-01")
```

## Durability Protocol (detail, not a separate C4 level)

> **Superseded mechanism (kept as record):** this barrier/checkpoint handshake is the LEGACY bridge_v2 pipeline. The native bridge (`bridge/`) now publishes to `mt5:account:{login}:stream:history` and owns backfill/coverage state in its own per-account SQLite journal — `BridgeHistoryCheckpoint/Chunk/Record` are retired, unused by the live consumer (see `docs/architecture-data-models.md`).

1. `bridge` (`history_publisher.py`) writes deal/order records to Redis Streams
   (`mt5:v2:history:deals`, `mt5:v2:history:orders`) in bounded chunks, each followed
   by a barrier message.
2. `worker-v2` consumes the streams via `XREADGROUP` consumer groups, reconstructs
   the chunk, and commits it to PostgreSQL inside a transaction
   (`BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord`).
3. Only after the PostgreSQL commit succeeds, `worker-v2` writes an ACK mirror key
   (`mt5:v2:history:{accountNo}:ack`) to Redis.
4. `bridge` reads that ACK key before advancing its own history cursor — Redis
   is the transport and coordination mirror; PostgreSQL is the durable source of
   truth. This is a bidirectional handshake, not a one-way pipe.

## Groupings Applied

- **Identity providers**: Google OAuth, Apple OAuth — grouped as one external system
  (`identity`), both consumed only by NextAuth v5 in `web`.
- **Infrastructure services**: DuckDNS (dynamic DNS) and the ACME certificate
  issuers (ZeroSSL primary, Let's Encrypt fallback) — grouped as one external
  system (`infra`), both consumed only by `caddy` for TLS.

## Assumptions

- The bridge (`bridge/`, NSSM service) runs on the same forexvps host as the
  analytic stack — the former two-host split (bridge on the Windows VPS, app
  stack in Docker Compose on a Linux host) was retired in the 2026-08 single-host
  migration. Deploy = `git pull` on the host + on-host rebuild.
- The former public Redis 6379 exposure (which let the externally-deployed bridge
  reach the compose-internal Redis on the retired Linux host) is ELIMINATED by the
  single-host topology — Redis now binds loopback only.
- `web`'s call to Forex Factory is explicitly shown as not happening (only
  `worker-v2` polls it) to avoid implying a duplicate/ambiguous edge.

## Omitted / Out of Scope

- **`src/worker-v3`** — dead scaffolding, since deleted from the repo entirely
  (never ran in production). Omitted from both diagrams.
- **Component and Code levels** — not produced; not requested.

## Operations Notes (not part of the C4 diagrams)

- `worker-v2` exposes a component-health endpoint on port 9200. The code binds
  `0.0.0.0` (`src/worker-v2/health.ts`), NOT loopback as an earlier version of
  this note claimed — the Windows firewall (inbound only 80/443) is what keeps
  it host-private. No code in this repo calls it — it exists for on-host ops
  inspection via the vps-ops runbook (e.g. `Invoke-WebRequest
  http://127.0.0.1:9200/health`), not as an application-level integration.
  Deliberately excluded from the Container diagram to avoid implying an
  in-application dependency.
