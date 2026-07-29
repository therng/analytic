# C4 Model — analytic (Trading Account Monitor)

Scope: whole repository. Levels: Context and Container (Simon Brown's default; no
Component/Code level produced). Source: retro-documented from `docker-compose.yml`,
`src/worker-v2/`, `src/app/api/`, `bridge_v2/`, `Caddyfile`, `prisma/schema.prisma`
on 2026-07-30.

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
  Rel(dashboard, mt5, "Reads live account/position/deal/order data", "MT5 API, via bridge_v2 on the VPS")
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

  System_Boundary(vps, "Windows Forex VPS (outside docker-compose)") {
    Container(bridge, "bridge_v2", "Python", "Repo-tracked source (bridge_v2/), deployed externally on the VPS. Reads MT5 terminals, publishes live state and history streams to Redis, reads back the durability ACK mirror")
  }

  System_Boundary(compose, "Docker Compose stack") {
    Container(caddy, "caddy", "Caddy, custom image w/ DuckDNS DNS-01 plugin", "Reverse proxy, TLS termination. frontend_net only — reaches only web")
    Container(web, "web", "Next.js 16 App Router, React 19, Node.js", "Dashboard UI + API routes. Runs Prisma migrations at startup. Spans frontend_net and backend_net")
    Container(worker, "worker-v2", "Node.js, esbuild bundle", "Sole background worker: durable Deal/Order/Position ingestion, account provisioning, live-state sync, equity sampling, economic calendar polling. backend_net only")
    ContainerDb(db, "db", "PostgreSQL 16", "Durable store: accounts, deals, orders, positions, snapshots, history checkpoints, economic events. backend_net only")
    ContainerDb(redis, "redis", "Redis 7.2, AOF+RDB, password-protected", "Live-state cache + history stream transport. Port 6379 published to the host publicly — current security risk, not a desired end state")
  }

  Rel(operator, caddy, "HTTPS")
  Rel(caddy, web, "Reverse proxies", "HTTP, frontend_net")

  Rel(web, identity, "Authenticates operator", "OAuth 2.0")

  Rel(web, db, "Reads/writes accounts, reports, trade history", "Prisma / SQL")
  Rel(web, redis, "Reads live account/position keys (trading fast path)", "Redis GET/HGETALL, bypasses Postgres for near-real-time data")
  Rel(web, redis, "Reads/writes emoji reaction counters (unrelated social feature)", "Redis Lua EVAL")

  Rel(worker, db, "Writes Deal/Order/Position/OpenPosition/AccountSnapshot/EquitySnapshot/BridgeHistoryCheckpoint/EconomicEvent", "Prisma / SQL")
  Rel(worker, redis, "Consumes history streams via consumer groups; reads live-state keys", "Redis XREADGROUP / GET")
  Rel(worker, redis, "Writes durability ACK mirror after Postgres commit", "Redis SET mt5:v2:history:{accountNo}:ack")
  Rel(worker, forexfactory, "Polls economic calendar (economic-events-poller.ts)", "HTTPS, hourly")

  Rel(bridge, mt5, "Reads account/deal/order/position data", "MT5 API")
  Rel(bridge, redis, "Writes live-state keys and XADDs history stream chunks with barriers", "Redis, password-authed over public port 6379")
  Rel(bridge, redis, "Reads durability ACK mirror to confirm commit before advancing cursor", "Redis GET mt5:v2:history:{accountNo}:ack")

  Rel(caddy, infra, "Obtains/renews TLS certificate", "ACME DNS-01")
```

## Durability Protocol (detail, not a separate C4 level)

1. `bridge_v2` (`history_publisher.py`) writes deal/order records to Redis Streams
   (`mt5:v2:history:deals`, `mt5:v2:history:orders`) in bounded chunks, each followed
   by a barrier message.
2. `worker-v2` consumes the streams via `XREADGROUP` consumer groups, reconstructs
   the chunk, and commits it to PostgreSQL inside a transaction
   (`BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord`).
3. Only after the PostgreSQL commit succeeds, `worker-v2` writes an ACK mirror key
   (`mt5:v2:history:{accountNo}:ack`) to Redis.
4. `bridge_v2` reads that ACK key before advancing its own history cursor — Redis
   is the transport and coordination mirror; PostgreSQL is the durable source of
   truth. This is a bidirectional handshake, not a one-way pipe.

## Groupings Applied

- **Identity providers**: Google OAuth, Apple OAuth — grouped as one external system
  (`identity`), both consumed only by NextAuth v5 in `web`.
- **Infrastructure services**: DuckDNS (dynamic DNS) and the ACME certificate
  issuers (ZeroSSL primary, Let's Encrypt fallback) — grouped as one external
  system (`infra`), both consumed only by `caddy` for TLS.

## Assumptions

- `bridge_v2` is treated as in-repo source (`bridge_v2/` is version-controlled)
  deployed externally on the Windows Forex VPS, not part of the docker-compose
  topology. Not independently verified that the VPS runs the exact same commit
  as the repo's `HEAD` at any given time — assumed based on the `ssh-vps` skill's
  deploy-via-`git pull` workflow.
- The Redis port 6379 public exposure is documented here as the mechanism that
  lets the externally-deployed `bridge_v2` reach the compose-internal Redis
  container. It is flagged as a current security risk per user correction, not
  modeled as an intended architectural boundary.
- `web`'s call to Forex Factory is explicitly shown as not happening (only
  `worker-v2` polls it) to avoid implying a duplicate/ambiguous edge.

## Omitted / Out of Scope

- **`src/worker-v3`** — confirmed dead scaffolding (no docker-compose service, no
  imports from `web` or `worker-v2`). Omitted entirely from both diagrams.
- **Component and Code levels** — not produced; not requested.

## Operations Notes (not part of the C4 diagrams)

- `worker-v2` exposes a component-health endpoint on port 9200, restricted to
  `backend_net`. It is not reachable from `caddy` or `web`, and no code in this
  repo calls it — it exists for manual/ops inspection (e.g. `docker exec` +
  `curl`, or an external monitor attached directly to `backend_net`), not as an
  application-level integration. Deliberately excluded from the Container
  diagram to avoid implying an in-application dependency.
