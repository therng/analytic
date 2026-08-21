# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [8.46] - 2026-08-21

### Removed

- **Docker dev/test stack deleted** — `Dockerfile` (web image), `Dockerfile.caddy` (xcaddy DuckDNS build), `docker-compose.test.yml` (isolated db-test:5434 / redis-test:6380), `.dockerignore`, and `.env.test.example`. Production has run as native Windows services on forexvps since the 2026-08-17 single-host migration; the dev Compose stack was already retired in 8.45-era leanness passes, and CI provisions its own Postgres service container without any repo Docker files.
- `scripts/backup-postgres.sh` — dumped the retired Compose-era `analytic-db-1` container; obsolete under the native PostgreSQL 18 service.
- `package.json`: `test:env:up` / `test:env:down` scripts removed with the test Compose stack. Opt-in integration tests (`RUN_WORKER_V2_HISTORY_INTEGRATION=1`, `RUN_HISTORY_RECOVERY_INTEGRATION=1`, bridge durable-Redis integration) now require manually provisioned local PostgreSQL + Redis.

### Changed

- README/CONTRIBUTING/CLAUDE.md/ci.yml guidance rewritten for native (or WSL2) PostgreSQL + Redis with `DATABASE_URL`/`REDIS_URL`; stray Compose references dropped. `.gitignore` no longer whitelists `.env.test.example`.

## [8.44] - 2026-08-20

### Removed

- **`ssh-vps` skill deleted** (`.claude/skills/ssh-vps/`, 14 files) — the SSH-based ops runbook for the forexvps host. Claude Code now runs on the host itself, so the SSH-hop framing is obsolete; on-host operational knowledge lives in `CLAUDE.md` (deploy flow), the `run-analytic` skill, and the 2026-08-17 migration plan. Dangling references cleaned from `CLAUDE.md`, `README.md`, `docs/architecture/c4-model.md`, `docs/architecture-data-models.md`, and `run-analytic/SKILL.md` (content preserved, pointers dropped).

## [8.43] - 2026-08-20

### Removed

- **Superseded/completed planning docs deleted** (content remains in git history): `docs/IMPLEMENTATION_PLAN.md` (superseded — implemented in `bridge/`), `docs/worker-v3-implementation-plan.md` (superseded — worker v2 sole worker), `docs/pg15-to-pg16-migration.md` (historical runbook), `docs/codebase-review-2026-08-02.md` (one-off review), all 7 July-era `docs/plans/*.md`, and `docs/superpowers/plans/2026-08-{02,03}-*.md` (implemented: dashboard doc fixes, outbox replay). Kept: `2026-08-17-windows-single-host-migration.md` (Task 7 items still open) and `2026-08-18-backfill-empty-region-coalescing.md` (planned, not started).
- `docs/ARCHITECTURE.md`: dropped the stale "working-tree change as of 2026-08-01" note pointing at the deleted IMPLEMENTATION_PLAN.md (ADR 0001's historical references left untouched per point-in-time record convention).
- Repo hygiene: stale remote-tracking refs pruned (remote had only `main`); `v8.42` tag synced.

## [8.42] - 2026-08-20

### Changed

- **`deepmerge-ts` override scoped and pinned exactly:** the override introduced in 8.41 (to clear the advisory in `@prisma/config`'s `deepmerge-ts` 7.1.5 pin) moves from root-scoped `"^8.0.0"` to `"@prisma/config": { "deepmerge-ts": "8.0.1" }`. The exact pin also makes the lockfile-less runner-stage `npm install prisma@6.19.3` inside the Docker image deterministic — the standalone `package.json` shipped by `scripts/sync-standalone.mjs` carries the override into the runner, so a future `deepmerge-ts` 8.x release can no longer float into the `prisma migrate deploy` path on image rebuilds.
- **Override removal condition:** drop the `@prisma/config` override once `@prisma/config` depends on `deepmerge-ts >= 8.0.1` (check: `npm view @prisma/config@latest dependencies`, then confirm `npm audit` stays clean without the override).

## [8.19] - 2026-08-01

### Changed

- **Redis key namespace migrated:** the legacy `mt5n:v1:*` namespace has been retired. Production is cut over to `mt5:account:{login}:*` (lease, lease-epoch, fence-counter, live, stream:history), with all keys for one account hash-tagged to the same Redis Cluster slot. Bridge (VPS) and worker-v2 were redeployed and restarted together; verified across all active accounts (lease TTL, live timestamp advancing, history stream readable, consumer group lag/pending at 0, PostgreSQL ingestion continuing).
- Redis key generation centralized: `src/lib/mt5-redis-keys.ts` (worker-v2/lib) and `bridge/redis_transport.py`'s `RedisLease.cluster_keys()` (bridge) are now the single source of each side's key format.
- `cache:report-view:*` and `social:sparkline:*` established as top-level Redis namespaces, siblings of `mt5:`, not nested under it — derived/application state with independent lifecycles from the MT5 bridge protocol.

### Removed

- **`stream:live` removed from the Redis contract** — a write-only mirror of every live/error publication with zero consumers (confirmed by repo-wide grep). Removed from producer code (`bridge/redis_transport.py`, `bridge/live.py`), tests, and documentation.
- Legacy `mt5n:v1:*` Redis keys deleted from production after the new namespace was verified healthy (25 keys, `SCAN`+`UNLINK`, zero failures).

## [6.91] - 2026-06-23

### Changed

- **Stack simplified to Next.js-only:** Removed Python FastAPI gateway (`backend/`), MT5 collector sidecar (`collector/`), shared Pydantic models (`shared/`), and their Dockerfiles. The historical FTP→Worker→PostgreSQL→Next.js path remains the sole data pipeline.
- **docker-compose:** Removed `gateway` and `snapshot` services; removed `caddy` dependency on `gateway`; removed `x-backend-build` and `x-backend-depends-on` anchors.
- **SparklineChart 1D axis:** Fixed x-axis labels to use Bangkok timezone (UTC+7) instead of raw UTC hours.

### Removed

- `backend/`, `collector/`, `shared/` — Python services and shared models
- `Dockerfile.backend`, `Dockerfile.collector` — Python container build files
- `CA/` — SSL certificate files
- `migration.sql`, `test-base.txt` — stale one-off files

## [Unreleased]

### Fixed (2026-06-11 audit)

- **EconomicCalendarPanel**: Restored full framer-motion implementation from HEAD; removed light-theme inline styles that broke dark terminal design
- **BotPnLPanel**: Disabled ApexCharts animations to prevent `elDefs.node null` crash on unmount (regression from cleanup)
- **useRealtimeAccount**: Added exponential backoff WebSocket reconnect (2s–30s, max 10 retries); removed console logs; changed return type to `void`
- **DashboardClient**: Removed unused `dcRightView`/`setDcRightView` state; fixed named import for EconomicCalendarPanel
- **OpenPositionsPanel**: Fixed named import for EconomicCalendarPanel
- **preaggregated-cache**: Removed unused `currentFloatingProfit` variable
- **eslint.config.mjs**: Added `.remember/**` to lint ignore list
- **stats/page.tsx**: Changed value import to `import type` for SerializedAccount

## [6.8.0] - 2026-06-04

### Added

- **Open-positions empty state:** Render an explicit "วิเคราะห์ทางเทคนิค XAUUSD" CTA that opens the technical-analysis modal, plus an embedded TradingView timeline of ICMARKETS:XAUUSD top stories in `th_TH`.
- **TradingView analysis modal:** Reusable zoom-in/out modal hosting the existing technical-analysis widget.
- **Server-side balance-curve downsampling:** Reduces payload for long timeframes before sending to the client.

### Changed

- **ABS KPI is now period-scoped:** `absoluteDrawdown` in both `overview.kpis` and `balanceDetail.summary` now uses `totalWithdrawals(period) + balance − totalDeposits(period)`, driven by the existing timeframe selector. Previous wiring fed `max(0, …)` into a loss-only formatter that always rendered "0".
- Extracted growth-calculation core logic into reusable helper.
- Frontend uses an environment variable for the WebSocket URL.

### Fixed

- **Balance curve drops empty-type trade deals:** `hasDealTypeOrComment` no longer treats `type=""` as "no metadata", so trades MT5 emits with empty `type` and `null` comment are included in the running balance, drawdown, and growth calculations.
- **Multi-account WebSocket publish:** `ingest_deals` groups deals by account and publishes to each account's Redis channel separately.
- **BotPnL tooltip sign:** Tooltip writes `grossLoss` with an explicit sign so future sign-convention refactors cannot silently flip it.
- **Backend network isolation:** Restored `internal: true` on `backend_net` so `db` and `redis` cannot reach the public network.
- **Gateway health checks:** Switched to `curl` with longer timeouts; added a real `/health` endpoint to break the docker-compose startup deadlock.

### Removed

- `backend/abs_calculation.py` placeholder (had a SyntaxError, `Decimal` + `float` TypeError, missing balance-adjustment classifier, and a different formula than the dashboard).
- Old `TradingViewTechnicalAnalysis` component in favor of the new modal-hosted widget.

## [6.6.0] - 2026-05-24

### Added

- **Real-time Architecture Rewrite:** Complete transition to a near-realtime, multi-tenant architecture.
- **Python MT5 Collector (Sidecar):** New lightweight, resilient worker that polls MT5 terminals every second and pushes HMAC-signed payloads.
- **FastAPI Ingestion Gateway:** New backend service to validate, authenticate, and route incoming MT5 data.
- **Redis Live-State Cache:** Integrated Redis for real-time state management (equity, PnL, positions) and Pub/Sub broadcasting.
- **Real-time WebSocket Streaming:** Frontend now receives live updates via WebSockets, eliminating aggressive client-side polling.
- **Snapshot Persistence Worker:** Background service that persists 1-minute state snapshots from Redis to PostgreSQL for historical analytics.
- **Incremental Trade Reconciliation:** Efficient deal syncing mechanism using ticket cursors.
- **Shared Schemas:** Centralized Pydantic models for cross-service type safety.

### Fixed

- **WebSocket Disconnect Detection:** Fixed the FastAPI WebSocket endpoint to correctly detect client disconnects using `asyncio.wait` and `FIRST_COMPLETED` strategy.
- **Hanging WebSocket Tests:** Resolved issues where `test_websocket.py` would hang due to event loop conflicts between `TestClient` and `asyncio.create_task`.
- **Global Test State Pollution:** Fixed `test_main.py` globally mocking the Redis client, which caused failures in isolated test modules.
- **Signature Verification Mocking:** Corrected a hardcoded secret in `test_redis.py` that caused 401 Unauthorized errors during testing.
- **Persistence Worker Warnings:** Fixed `RuntimeWarning`s in `test_worker.py` caused by improper `AsyncMock` usage for synchronous connection methods.

## [6.3.0] - 2026-05-16

### Added

- Added BotPnLPanel showing per-bot gross profit/loss as bars with a tap tooltip.
- Added a timeframe selector below the history list in the Trades panel.

### Changed

- Redesigned the Performance Quality panel as semicircular benchmark gauges (Poor/Fair/Good/Great) with a zone-colored value and per-metric subtitle.

### Fixed

- Fixed the BotPnL tooltip being clipped by the chart frame so it is now visible, and trimmed it to show only the bar values.
- Updated the app version to 6.3.

## [6.2.0] - 2026-05-13

### Added

- Added long-press guidance for DD panel gauges and refreshed loading/performance hints across the dashboard. ([PR #39](https://github.com/therng/analytic/pull/39))

### Changed

- Sorted accounts by weekly growth performance so the strongest accounts surface first.
- Updated heatmap day labels to M/W/F. ([PR #40](https://github.com/therng/analytic/pull/40))
- Simplified the sparkline live beacon to a single ring with a natural heartbeat blink. ([PR #41](https://github.com/therng/analytic/pull/41), [PR #43](https://github.com/therng/analytic/pull/43))
- Muted inactive account names and chart lines for cleaner focus. ([PR #45](https://github.com/therng/analytic/pull/45))

### Fixed

- Kept the chart tooltip visible on desktop click. ([PR #44](https://github.com/therng/analytic/pull/44))
- Tightened open-position expanded-row typography and comment alignment.
- Updated the app version to 6.2.

## [6.0.0] - 2026-05-06

### Changed

- Redesigned KPI and Performance Quality hints as Preview Cards with zoom transitions.
- Redesigned Open Positions row layout with expandable details (S/L, T/P, Comments).
- Optimized Loading Screen candle animation (faster loop cycle).
- Refactored Loading Screen component for better performance.
- Fixed Pips Performance Table to be non-scrollable for better visibility.

### Fixed

- Fixed missing 'memo' import in Performance Quality Panel.
- Resolved Next.js build cache corruption issues.

### Added

- Standard documentation files (CONTRIBUTING, CHANGELOG).

### Fixed

- Fixed Safari Safe Area display issues on the Stats page.
