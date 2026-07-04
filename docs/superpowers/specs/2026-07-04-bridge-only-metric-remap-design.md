# Bridge-Only Metric Remap Design

**Status:** Active merged design. This design supersedes the FTP/shadow-table validation direction in `2026-07-02-bridge-ftp-migration-design.md` and retains the compatible `EquitySnapshot` / `PositionExcursion` source concepts from `2026-07-01-equity-line-and-intraday-snapshots-design.md`.

## Goal

Rebuild dashboard value mapping from scratch so every UI value comes from the active Bridge/Redis pipeline only. FTP, HTML report parsing, manual local report import, file-hash deduplication, and report-derived UI assumptions are permanently removed.

## Source Contract

Allowed authoritative inputs:

- Redis live account hash and fresh positions key for current balance, equity, margin, free margin, floating P/L, open positions, and live freshness.
- Redis streams consumed into PostgreSQL for `Deal`, `Position`, and `Order` history.
- `OpenPosition` mirrored from fresh Redis positions.
- `EquitySnapshot` and `PositionExcursion` sampled from fresh Redis live state.
- Derived cache tables or in-memory caches only when recomputed from the Bridge/Redis sources above.

Removed inputs:

- FTP import.
- MT5 HTML parser.
- Manual local HTML import and `worker:local`.
- `ReportImport` file hash deduplication.
- `EquityHistory` points derived from report files.
- UI values that only existed because the HTML report exposed a summary/detail field.

## Metric Mapping Contract

Every dashboard metric must have a single registry entry with:

- `id`: stable metric identifier used by API/UI mapping.
- `source`: one of `deal`, `position`, `open-position`, `snapshot`, `equity-snapshot`, `position-excursion`, or `derived-cache`.
- `formula`: short human-readable definition.
- `timeframe`: whether the metric is timeframe-scoped or a current snapshot.
- `apiField`: response field that carries the value.
- `display`: chip/panel target, formatter, tone rule, and empty-state behavior.

If a metric has no active source, it is removed from the UI or returned as explicit unavailable metadata. It must not be silently mapped to a stale report field.

## Cleanup

Remove legacy files and commands:

- `src/lib/parser/` and parser tests.
- Manual HTML import code in `src/worker/index.ts`.
- `npm run worker:local`.
- Report-file operational scripts.
- Prisma models and migrations for `ReportImport` and `EquityHistory`.
- Tracked `prisma/dev.db`.
- Docs that describe FTP/manual import as an active source.

Keep bridge-only worker behavior:

- Worker starts equity sampler and bridge consumer.
- Worker health remains available.
- Bridge stream consumer recomputes `AccountReportResult` from `Deal` and `Position`.
- Current-state writes continue to respect Redis freshness.

## API and UI Direction

Keep existing route families initially, but rebuild their payload construction around a source-backed mapping layer. The dashboard should consume mapped metric descriptors rather than hand-built KPI arrays inside `DashboardCard.tsx`.

First implementation pass:

- Remove impossible/legacy values from the backend and docs.
- Add tests that lock Bridge/Redis-only behavior.
- Introduce metric mapping metadata for the current KPI set.
- Refactor UI KPI construction to use the mapping metadata without changing the mobile layout.

## Verification

Run:

- `node --import tsx --test src/worker/bridge-consumer.test.ts`
- `node --import tsx --test src/worker/equity-sampler.test.ts`
- relevant trading tests after mapping changes
- `npm run lint`
- `npm run build`

Schema changes require reviewing the generated Prisma migration SQL before considering the work complete.
