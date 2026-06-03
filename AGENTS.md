# Repository Guidelines

## Overview
`analytic` is a Next.js trading account monitor for MT5-style account data. The main product is an operational dashboard, not a marketing site. Prioritize fast scanability, stable metrics, and responsive layouts that preserve meaning across mobile portrait.

## Project Structure
- `src/app/`: Next.js App Router pages, layouts, and API routes.
- `backend/`: FastAPI gateway for real-time data ingestion and WebSocket management.
- `collector/`: Python-based MT5 sidecar collector.
- `shared/`: Shared Pydantic models for cross-service type safety.
- `src/components/trading-monitor/`: shared dashboard UI, formatters, and client-side account card logic.
- `src/lib/trading/`: analytics, cached/preaggregated views, and account data helpers.
- `src/lib/parser/`: report parsing and normalization.
- `src/worker/`: background historical import worker.
- `prisma/`: schema and migrations.
- `scripts/`: operational scripts such as cleanup, backfills, and data remediation.

## Core Commands
- `npm install`: install project dependencies.
- `cp .env.example .env`: create the local env file.
- `npm run dev`: run the dashboard locally.
- `docker-compose up -d`: start the full stack (Next.js, FastAPI, Redis, Postgres, Worker).
- `npx prisma migrate dev`: apply local Prisma schema changes.
- `npm run build`: baseline verification for app changes.
- `npm run lint`: run Next.js and backend lint checks.
- `cd backend && source venv/bin/activate && PYTHONPATH=.. pytest`: run backend Python tests.
- `npm run test:formatters`: run unit tests for dashboard formatting logic.
- `npm run test:parser`: run unit tests for the MT5 report parser.
- `npm run worker`: build and run the Node.js worker.
- `npm run db:backfill-report-results`: recompute persisted report result rows.


## Coding Conventions
- Use TypeScript for app and script work where practical.
- Follow the existing style: 2-space indentation, semicolons, double quotes, and `@/` import aliases.
- Components and exported types use `PascalCase`.
- Functions, hooks, local variables, and helpers use `camelCase`.
- Next.js route folders should follow file-system conventions such as `src/app/api/accounts/[id]/route.ts`.
- Prefer small data-driven helpers over duplicated JSX or formatting logic.
- Time-based logic should use helpers from `src/lib/time.ts`, which assumes a Bangkok/Thai context for market sessions.

## Verification Expectations
- Use `npm run test:formatters` and `npm run test:parser` to verify core logic changes.
- Treat `npm run build` and `npm run lint` as the standard baseline for overall app health.
- For parser, analytics, or import changes, also run the closest relevant script against representative data.
- Keep tests close to the feature or in a clear `__tests__/` directory and use `*.test.ts` naming. New logic should include corresponding unit tests.

## Commit and PR Guidance
- Use descriptive imperative commits such as `fix: stabilize win stats across timeframes`.
- Keep PRs focused and call out user-visible behavior changes.
- Include screenshots for dashboard or layout work.
- Note schema, migration, parser, or backfill implications in the PR body.
- List the verification commands and test suites you ran.

## Security and Data Safety
- Never commit `.env` values, credentials, database secrets, or imported report data.
- Review Prisma migrations before applying them.
- Avoid destructive cleanup or import actions against shared environments.
- When changing parser/backfill behavior, document expected inputs, migration risk, and rollback considerations.

## Agent Workflow Notes
- Check the worktree before editing. This repo may contain unrelated local deletions or experiments.
- If the task is dashboard-facing, start with `src/components/trading-monitor/`, `src/app/globals.css`, and the account API routes.
- When modifying responsive dashboard behavior, verify both mobile portrait assumptions, not only portrait.
- Keep API and UI terminology aligned: account list comes from `/api/accounts`; account-level overview comes from `/api/accounts/[id]?timeframe=...`.
- For import/debug workflows, `npm run worker:local` reads reports from `data/source-reports` by default; override with `LOCAL_REPORT_DIR` when replaying another local folder.
- The worker ignores report files that are still too fresh or too small; tune `WORKER_POLL_MS`, `WORKER_FILE_STABLE_MS`, and `WORKER_MIN_FILE_SIZE_BYTES` in `.env` before changing ingestion logic.

## Frontend Product Direction

### Product Goal
The dashboard should help an operator answer three questions quickly:
- which accounts matter most right now
- what the balance/equity curve is doing
- where to drill next without losing context

This is an operational surface. Favor orientation, chart readability, and trustworthy KPIs over decorative density.

### Current Layout Model
The current UI direction is a command-center dashboard:
- mobile landscape: horizontally paged account workspaces with chart-first composition
- mobile portrait: compact single-column account cards

Avoid reverting to a generic card mosaic layout.

### Responsive Rules

- Keep overview and account context visible at the same time when space allows.
- Prefer split layouts for command/overview sections.

#### Mobile Landscape
- Treat the account workspace as a two-zone layout.
- The balance chart stays dominant.
- Identity, growth, and balance stay in the card header.
- KPI chips should remain visible without forcing a drill-down.
- Secondary report sections should not occupy a permanent side rail.
- Horizontal paging between accounts is acceptable if account order remains stable.

#### Mobile Portrait
- Use a single-column stack.
- Header stays compact.
- Chart remains above secondary content.
- Timeframe controls stay attached to the chart.
- KPI chips should appear immediately after the chart as a dense grid or row.

#### Shared Mobile Rules
- Pull-to-refresh should still work from the top of the dashboard.
- Primary chart and KPI content should fit without sideways panning.
- Horizontal scroll is acceptable for secondary tables or timeframe controls.
- Orientation changes must not reshuffle account ordering.
- **iOS Optimization**: The layout is optimized for iOS Safari using `dvh` units and `viewport-fit=cover`. The main scrolling area provides a native, full-bleed experience. In standalone PWA mode, top safe-area insets are applied to prevent content from overlapping with the system status bar, while regular browser view remains full-bleed.

## Account and Metric Rules

### Ordering
- Default account ordering is the `Growth` KPI value from timeframe `1D`, sorted descending.
- If `Growth` `1D` ties, fall back to `Pips` `1D`, then balance descending, then account number ascending.
- The same ordering should be preserved across breakpoints.
- Selection changes focus only; it should not rewrite the default sort.

### Balance Chart
- The chart is a single continuous balance line for the selected account and timeframe.
- The `D` timeframe uses an intraday realtime balance sparkline anchored to the report date.
- The `D` sparkline uses the prior-day close as its visual baseline, renders on a fixed 0–23 hourly axis in report-local time, and avoids permanent gridlines or labels in the compact card.
- The `D` sparkline should expose point balance and timestamp through hover or tap tooltip.
- A compact open-positions overlay may sit inside the chart frame when it preserves chart readability and keeps live exposure visible.
- Segment color can communicate balance-event type changes such as deposit or withdrawal.
- Balance operations are not the same as normal trading P/L.
- If a live snapshot is newer than the last historical point, the UI may append a live point.

### KPI Chips
Required fast-scan KPIs:
- net gain
- floating P/L
- relative drawdown
- margin level when available
- win rate
- total trades
- open positions

Use compact formatting when it improves readability.
The `TRADES` chip count and replacement history list both use timeframe-filtered closed positions from the `Position` table only, excluding open positions.

### Number Formatting Policy
- Keep backend calculations at full precision; rounding is presentation-only in the frontend.
- Do not round intermediate values before render.
- Full currency views use 2 decimals and always include a currency symbol with no space, for example `$1,234.57` or `-$1,234.57`.
- Compact monetary views do not show a currency symbol and use uppercase `K`, `M`, or `B` suffixes only.
- Compact views should use at most 1 decimal and strip trailing `.0`.
- Do not mix compact monetary values and full currency values inside the same compact metric surface.
- When a compact monetary value is shown in a card or chip, provide access to the full currency value via tooltip, hover, or tap affordance when practical.

### Snapshot and Opens
Snapshot/account context should emphasize current-state information such as:
- balance/equity state
- floating P/L
- margin or exposure-related context

For open positions summaries:
- keep the summary list short
- surface the most important live exposure first
- prefer market price over open price in compact summaries
- symbol, side, volume, market price, and floating P/L are the preferred compact fields
- avoid forcing the full positions table into compact layouts

## Analytics Expectations
- Growth should follow MQL5-style logic so deposits and withdrawals do not distort performance.
- Use source-derived analytics when source data is available.
- Precomputed report-result tables are useful caches, not a replacement for sound source-derived logic.
- If a calculation depends on balance-operation segmentation, preserve that logic across UI and backend changes.
- Position-based result metrics must use `positionNetPnl = profit + swap + commission`.
- Keep source boundaries explicit:
- `Positions` for win rate, profit factor, sharpe ratio, expected payoff, average/largest win-loss trade, consecutive win-loss streaks, trades per week, and average hold time.
- `Deals` for balance curve, growth, and drawdown-oriented analytics.
- `Deals` also drive the intraday balance progression for the `D` timeframe.
- `OpenPositions` for floating P/L, open exposure, and open counts.
- `TradingAccount` or `AccountSnapshot` for latest balance, equity, margin, and margin-level values.
- Position metrics are timeframe-sensitive unless they are explicitly defined as latest-snapshot values.

## States and Interaction
- Loading states should preserve layout shape with skeletons.
- Empty states should be explicit and operational.
- Errors should render inline in the affected region instead of collapsing the full page.
- Pull-to-refresh should show visible progress and only trigger from the top of the scroll container.

## Visual Direction
- The main shell uses a **Pure Black Terminal** aesthetic optimized for modern OLED screens (specifically targeting iOS).
- Avoid legacy retro styles like scanlines or heavy borders.
- The layout is intentionally designed to be full-bleed, disregarding traditional safe-area padding for scrolling content in browser view, while applying top safe-area padding specifically in standalone PWA mode to prevent status bar overlap.
- Account cards use subtle contrast against the true black background to maintain readability and hierarchy without breaking the dark mode immersion.
- Use strong typographic hierarchy, defaulting to iOS system fonts (`-apple-system`, `BlinkMacSystemFont`) for the base UI to feel native, while retaining monospace for numerical utility text.
- Positive, negative, warning, and neutral tones should stay semantically consistent.

Avoid:
- generic dashboard card mosaics
- decorative gradients that overpower routine data
- excessive borders around minor elements
- marketing-style copy inside operational panels
- legacy mobile fallbacks (`vh` units or manual iOS height calculation scripts)

## When Updating This File
Update `AGENTS.md` when any of the following materially change:
- primary dashboard composition
- responsive behavior or breakpoints
- account ordering assumptions
- KPI definitions
- API/data contract assumptions used by the frontend
- verification expectations or project commands

## Frontend and Bugfix Workflow

### Frontend Changes

- Preserve existing responsive dashboard behavior.

- Avoid unnecessary rerenders.

- Prefer incremental UI changes over rewrites.

- Reuse existing helpers and formatting utilities.

- Keep chart-first mobile layouts intact.

### Bug Fixing

- Investigate root cause before fixing.

- Avoid speculative changes.

- Prefer minimal diffs.

- Verify fixes before completion.

- Preserve trading analytics correctness.

### Verification

Before completing changes:

- run lint when relevant

- run affected tests when relevant

- verify responsive behavior assumptions