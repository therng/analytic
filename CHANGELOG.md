# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
