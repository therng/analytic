# Design: Single-Host Windows Migration (forexvps Clean Install)

**Date:** 2026-08-17
**Status:** Approved (user signed off on architecture, Redis tier, clean-install cutover, and accepted data loss)
**Success criterion:** `https://therng.duckdns.org` opens normally; accounts render; live tiles update; history backfill from 2025-01-01 progresses into Postgres; all services survive a deliberate reboot.

> **As-built deviations (read alongside the plan's progress log):** the data tier standardized on **PostgreSQL 18** (`postgresql-x64-18` on 5432) — every `postgresql-x64-16` / `C:\Program Files\PostgreSQL\16` reference below means the 18 equivalent. Node lives at `C:\nvm4w\nodejs\node.exe` (nvm4w), not Program Files. The `ssh-vps skill` referenced in the reboot-test step was removed when ops moved on-host — its successor is the vps-ops runbook (`references/mt5ops.md` `reboot-check`).

## Background

Host B (Linux Docker host running `db`, `redis`, `web`, `worker-v2`, `caddy`) is gone — expired/deleted, unrecoverable. The bridge on forexvps (Windows Server 2022) has been publishing to a dead Redis. This design consolidates the entire stack onto forexvps as native Windows services, alongside the already-running MT5 terminals and bridge.

Decisions locked with the user:

1. **Target host:** forexvps (Windows Server 2022, the same box as MT5 + bridge) — single host for everything.
2. **Old data:** not recovered in any form. No VPS-provider ticket, no volume salvage. History comes solely from a fresh MT5 backfill (2025-01-01 → present).
3. **Clean install:** delete `C:\analytic` on the VPS and reinstall from a fresh `git clone`. This includes the SQLite journals — accepted, since data loss was already accepted.
4. **Redis tier:** real Redis 7.2 inside WSL2, if the Phase-0 virtualization probe passes. Fallback (probe fails): Memurai Developer + scheduled weekly restart — re-ask the user before using the fallback.

## Architecture

```
┌─────────────────────────── forexvps (Win Server 2022) ───────────────────────────┐
│                                                                                    │
│  [MT5 Terminals ×4] ←─ portable terminal64.exe, Startup .lnk (untouched)           │
│       │  attach via MetaTrader5 py                                                 │
│  [bridge] NSSM svc (.\supachai)  ──REDIS_URL──→ 127.0.0.1:6379                     │
│                                                    │                               │
│                                          [Redis 7.2 ใน WSL2]                       │
│                                          bind 127.0.0.1, noeviction                │
│                                                    │                               │
│  [worker-v2] NSSM svc ── XREADGROUP ──────────────┤                               │
│       │                                           ▼                                │
│       └── Prisma ──→ [PostgreSQL 16] EDB native, 127.0.0.1:5432                    │
│                                                                                    │
│  [web Next.js standalone] NSSM svc :3000 ← 127.0.0.1 only                          │
│       ▲                                                                            │
│  [Caddy + duckdns] NSSM svc :80/:443 ← 0.0.0.0 (only public exposure)              │
│       └── HTTPS therng.duckdns.org (DNS-01 ZeroSSL/LE)                             │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Principles:

- Every service follows the **proven bridge pattern** (`bridge/scripts/install-service.ps1`): NSSM, `.\supachai` logon, `SERVICE_AUTO_START`, 10 MB online log rotation, restart-on-exit, `AppStopMethodConsole 25000`.
- **Loopback-only data plane.** Postgres, Redis, web, worker health all bind `127.0.0.1`. Caddy on 80/443 is the sole public exposure. The old Host-B posture (public Redis 6379 + password) is deliberately not reproduced — with bridge co-located there is zero reason for off-host Redis reachability, and dropping it is a strict security improvement.
- **Build on the box.** Deploy = `git pull` → `npm ci` → `npx prisma generate` → `npm run build` → `npm run build:worker-v2` → `npx prisma migrate deploy`, run on forexvps itself. Cross-produced `.next/standalone` bundles (Mac/Linux) embed paths/engine assumptions that break on Windows; building on-target eliminates that class of failure and matches the existing bridge deploy flow.
- **Windows Update survivability.** `analytic-worker` gets `DependOnService = postgresql-x64-16, redis-wsl` so SCM starts the data tier first; a deliberate reboot test is part of "done."

## Components

### PostgreSQL 16 (EDB native installer)

- `listen_addresses = '127.0.0.1'`, port **5432** (the old 5433 was a Host-B publish mapping; nothing needs it).
- `timezone = 'Asia/Bangkok'`, `log_timezone = 'Asia/Bangkok'` — verify with `SHOW timezone;`.
- User/db named as before (`supachai` / `trading_db`) so `DATABASE_URL` stays a minimal diff from compose.
- Raise `max_wal_size` during the first backfill; consider `log_checkpoints = on` initially to catch checkpoint thrash.
- Windows Defender exclusion on the data directory.

### Redis 7.2 in WSL2 (primary) — or Memurai fallback

**Primary path:** real Redis 7.2 in a WSL2 Ubuntu distro.

- Phase-0 probe gates this: nested virtualization must be present (`systeminfo` Hyper-V line, `wsl --status`); if absent, WSL2 is impossible → fallback discussion with user (see Fallback).
- Auto-start after reboot: NSSM service `redis-wsl` running `wsl.exe -d <distro> --exec redis-server /etc/redis/redis.conf` — NSSM holds the process, so Redis lifetime is tied to a Windows service, not to a logged-in WSL session. Bridge/worker connect to `127.0.0.1:6379` via WSL localhost forwarding.
- Config parity with Host B where it matters, one deliberate change:
  - `appendonly yes`, `appendfsync everysec` ✓ (same as Host B)
  - RDB saves `900 1 / 300 10 / 60 10000` ✓ (same)
  - `requirepass` kept (defense in depth) ✓
  - **`maxmemory-policy noeviction`** (CHANGED from `allkeys-lru`) — advisor finding: LRU can evict lease keys (fencing tokens that prevent double-publish) and unconsumed stream entries under pressure, silently losing history the bridge already marked PUBLISHED. Correct policy for a durability-critical transport.
- Monitor `XLEN` on `mt5:account:{login}:stream:history`; the bridge never trims (no MAXLEN on XADD), worker-v2 `XTRIM MINID` after ack is the sole trimmer.
- redis-py note (advisor): the bridge client sets no socket timeouts; on loopback this is acceptable, no code change.

**Fallback (probe fails):** Memurai Developer edition + Task Scheduler restart every 7 days (before the 10-day self-shutdown) with `SAVE` first. ~30 s weekly downtime, dev-only license accepted. **The user must be re-asked before this fallback is used** — it was not the approved path.

### web (Next.js standalone)

- Node 20 LTS MSI on the box.
- NSSM `analytic-web`: `node C:\analytic\.next\standalone\server.js`, env `PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production TZ=Asia/Bangkok` + `DATABASE_URL` + `REDIS_URL` + `AUTH_SECRET/AUTH_TRUST_HOST/AUTH_URL` (+ Google/Apple OAuth creds if in use).
- Note: `/api/health` is a static `{ok:true}` — it proves nothing about DB/Redis. Verification uses `/api/accounts` (touches Prisma/Postgres).

### worker-v2

- NSSM `analytic-worker`: `node C:\analytic\dist\worker-v2.js`, env same data-tier URLs + `TZ=Asia/Bangkok` + the `WORKER_V2_*` set from compose.
- **Required code fix (pre-clone, single PR):** `src/worker-v2/index.ts:260-263` checks `process.argv[1].endsWith("/dist/worker-v2.js")` — on Windows the path uses backslashes, the check never matches, and `main()` silently never runs. Fix: normalize separators (`replace(/\\/g, "/")`) before both `endsWith` checks, keeping the `.ts` branch for tsx/test parity. Unit-test both separator styles.
- `DependOnService = postgresql-x64-16, redis-wsl` so post-reboot startup order is data-tier-first (worker eagerly connects to Redis at boot and exits 1 if it's down; NSSM restart covers the remainder).
- Health on `127.0.0.1:9200` (component-aware: deals/orders/live/equity/calendar staleness) — the monitoring probe target, not web's static health.

### Caddy (HTTPS edge)

- Official Windows binary **with the duckdns module prebuilt** from caddyserver.com/download (no xcaddy/Go toolchain needed).
- NSSM `caddy`, env `DUCKDNS_TOKEN`; needs write access to its data dir (certs) and log dir — ACL per the journal-DACL discipline already proven on this box; not SYSTEM.
- Caddyfile changes: `web:3000` → `127.0.0.1:3000` (127.0.0.1, not `localhost`, to dodge IPv6 `::1` mismatch); access log path → `C:/caddy/logs/access.log` (forward slashes are fine in Caddyfile); TLS DNS-01 via DuckDNS is platform-neutral and unchanged.
- Pre-check: IIS/W3SVC must not own port 80 (`netstat -ano | findstr :80`), firewall inbound 80/443 open, and 80/443 reachable from outside the VPS network.

### Reinstalling bridge (last step)

- `bridge/.env` written fresh with `REDIS_URL=redis://:<password>@127.0.0.1:6379` (value never echoed in chat/docs — existing convention).
- `bridge/scripts/install-service.ps1` (idempotent) reinstalls the `bridge` NSSM service.
- Fresh empty journals → bridge sees no checkpoint → automatic retained-history backfill from **2025-01-01**, by design (CLAUDE.md "History Backfill and Durability" rules; never a 30-day fallback).
- Broker UTC offsets must be re-set per account before ingestion counts as correct: `node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>` (the fresh Postgres has no offsets either).

## Data flow (post-cutover steady state)

```
MT5 → bridge (lease-fenced) → Redis streams/live keys → worker-v2 (XREADGROUP,
consumer groups, ack-after-Postgres-commit) → PostgreSQL → web (poll /api/accounts,
live tiles read mt5:account:{login}:live via node-redis)
```

Unchanged from the compose deployment — only the transport hosts change.

## Cutover sequence (clean install)

Order matters: data tier → build → services → verify each → bridge last.

1. **Probes** — virtualization (WSL2 viability), free disk (budget: 2× expected DB size during backfill; MT5 ×2-5 GB each; Redis AOF rewrite needs 2× free), RAM at market-hours peak, port conflicts (3000/9200/5432/6379/80/443, IIS), inbound 80/443 from outside.
2. **Data tier** — install Postgres 16 + config; WSL2 + Redis 7.2 (or fallback decision); Defender exclusions (Postgres data dir, Redis/AOF dir, `C:\analytic\bridge\state`, `C:\analytic\logs`, Caddy logs).
3. **Clean slate** — `nssm stop bridge` → `nssm remove bridge confirm` → delete `C:\analytic` → fresh `git clone` → `pip install -r bridge\requirements.txt` (into `C:\Python314`).
4. **Build on box** — `npm ci` → `npx prisma generate` → `npm run build` → `npm run build:worker-v2` → `npx prisma migrate deploy` (includes PowerShell translation of the incomplete-migration-dir prune from `entrypoint.sh`). Verify `_prisma_migrations` count matches `prisma/migrations` directory count.
5. **App services** — install NSSM services `analytic-web`, `analytic-worker`, `caddy`; verify `127.0.0.1:3000/api/accounts` returns real JSON; verify `https://therng.duckdns.org` from outside (cert issues via DNS-01). Site being empty at this point is expected and fine.
6. **Bridge last** — write `bridge/.env` with loopback REDIS_URL → `install-service.ps1` → verify: bridge logs show lease ACQUIRED per login, `XLEN` grows per account, `mt5:account:{login}:live` keys exist, worker-v2 health shows active consumers, dashboard live tiles move. Then re-set broker UTC offsets per account.
7. **Reboot test** — deliberate `Restart-Computer`; verify every service self-starts in dependency order, MT5 terminals return (existing ssh-vps skill flow), backfill resumes, dashboard populates. A migration that only works until the first reboot is not done.
8. **Ongoing** — Task Scheduler: daily `pg_dump -Fc` (native rewrite of `scripts/backup-postgres.sh`, off-box copy) + weekly bridge-journal copy off-box; disk-space check alert; worker-v2 `:9200/health` as the monitoring probe.

## Rollback

There is nothing to roll back to (Host B is gone). The operational rollback is: `nssm stop bridge` and fix in place. Journals are read-only throughout the install; the only irreversible step (deleting `C:\analytic`) is taken explicitly in step 3.

## Accepted losses & risks

- **Permanent:** `equity_history` time series (historical equity curve panels will show a gap from inception to cutover), social-layer data. MT5 re-backfill cannot reconstruct these — accepted by the user.
- **Single-box blast radius:** MT5 and its monitor now share one kernel/disk/reboot. A wedged Postgres or Windows Update cycle takes down trading *monitoring* (not trading itself) simultaneously. Accepted; partially mitigated by loopback binding, service dependencies, reboot test.
- **First-backfill window:** gap between process start and backfill completion; dashboard fills in progressively.
- **WSL2 Redis dependency:** Redis lives inside a WSL2 VM on a host that must keep nested virtualization enabled. If the provider ever revokes it, the fallback conversation (Memurai) happens then.
- **History gap risk at fresh-Redis start:** none by design — consumer groups are created by worker-v2 with MKSTREAM before the bridge's first XADD (worker starts before bridge in the install order), so the first entry lands in a stream whose group exists at ID 0. No missed-entry window.

## Testing

- **Unit (repo, pre-clone):** worker-v2 argv-separator fix — both `/` and `\` styles invoke `main()`.
- **Phase-gate verification on box:** each cutover step has an explicit verify command (listed inline above); no phase advances on a failed check.
- **End-to-end:** browser dashboard → accounts render → live tiles move (exercises bridge→Redis→worker→Postgres→web path) → backfill progress visible over hours → reboot test green.

## Out of scope

- Recovering any Host-B data (explicitly declined).
- Multi-host redundancy or off-box failover.
- Monitoring stack beyond Task Scheduler probes (could add UptimeRobot etc. later).
- Any UI/domain changes; `therng.duckdns.org` stays the canonical URL, so OAuth redirect URIs are unaffected.
