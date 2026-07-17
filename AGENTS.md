# Repository Guidelines

> **For commands, stack, directory structure, coding conventions, data model, and environment variables — see `CLAUDE.md`.** This file covers dashboard behaviour, UI conventions, analytics rules, and visual design. Update `AGENTS.md` when those change; update `CLAUDE.md` when commands or stack change.

## Agent Workflow Notes

- Check the worktree before editing — this repo may contain unrelated local deletions or experiments.
- Dashboard work starts in `src/components/trading-monitor/`, `src/app/globals.css`, and the account API routes.
- Dashboard, analytics, and worker work — stack is Next.js + Node.js worker + Prisma/PostgreSQL only; no Python services.
- Automatic history lifecycle: Python bridge publishes bounded, raw-server-time Deal/Order/Position envelopes plus barriers; Node worker persists idempotently and advances PostgreSQL `BridgeHistoryCheckpoint` only after all barriers/counts/digests commit. Redis `mt5:bridge:history-ack:{login}` is derived mirror only. Missing state starts at 2000-01-01; never epoch or 30-day fallback.
- When modifying responsive dashboard behavior, verify both portrait **and** landscape — changes often break the other orientation silently.
- API terminology: account list → `/api/accounts`; account detail → `/api/accounts/[id]?timeframe=...`; trade history → `/api/accounts/[id]/trade-history` (cursor-paginated); economic calendar → `/api/economic-events?scope=expanded` (30-day window) or default (today + nearest week), Forex Factory source, Bangkok time, `force-dynamic`.
- The worker is Bridge/Redis-only. Do not reintroduce FTP, HTML report parsing, manual local import, file-hash deduplication, or UI mappings to fields that do not exist in the Bridge/Redis/PostgreSQL path.
- Metric display mappings live in `src/lib/trading/metric-registry.ts`; every UI metric must have a source, formula, API field, and display target.

## Commit and PR Guidance

- Descriptive imperative commits: `fix: stabilize win stats across timeframes`.
- Keep PRs focused; call out user-visible behavior changes.
- Include screenshots for dashboard or layout work.
- Note schema, migration, Bridge/Redis ingestion, or analytics implications in the PR body.
- List verification commands and test suites you ran.

## Security and Data Safety

- Never commit `.env` values, credentials, database secrets, or imported report data.
- Review Prisma migrations before applying them.
- Avoid destructive cleanup or import actions against shared environments.
- When changing Bridge/Redis ingestion or analytics behavior, document expected inputs, migration risk, and rollback considerations.

---

## Frontend Product Direction

### Product Goal

The dashboard helps an operator answer three questions quickly:

- which accounts matter most right now
- what the balance/equity curve is doing
- where to drill next without losing context

This is an operational surface. Favor orientation, chart readability, and trustworthy KPIs over decorative density.

### Current Layout Model

- **Mobile landscape:** horizontally paged account workspaces with chart-first composition
- **Mobile portrait:** compact single-column account cards

Avoid reverting to a generic card mosaic layout.

---

## Dashboard Panel Composition

Each account card exposes an overlay panel driven by the tapped KPI chip (`ExpandableKpiKey`):

| Chip key | Canvas panel                                                                      | Detail chips (below KPI row)                                       |
| -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `gain`   | No overlay — SparklineChart (balance curve) is the detail view                    | COMM. / SWAP / DEPOS. / WITHD. (from `overview.kpis`)              |
| `dd`     | Sub-panel selected via 4 chips (default = DD; see below)                          | ABS / MAX / WIN / EXPECT                                           |
| `pips`   | `PipsPerformanceTable` + `ProfitHeatmapPanel` (stacked)                           | — (canvas is comprehensive)                                        |
| `trades` | `TradeHistoryPanel`                                                               | ACTIVITY (total) / PER WEEK / HOLDING                              |
| `opens`  | `OpenPositionsPanel` (handles empty state internally with `EconomicCalendarList`) | FLOAT. P/L / MARGIN / FREE MRG / LEVEL% (from `SerializedAccount`) |

**DD sub-panel chips** (default = DD; tapping an active sub-panel chip again toggles it back to `DD`):

| Chip     | Canvas                                                                       | Value shown in chip                            |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| `DD`     | `BotPnLPanel` — closed-position P/L timeline                                 | Drawdown % (default; no sub-chip)              |
| `ABS`    | `DrawdownEquityPanel` — equity line + drawdown% area (dual y-axis, blue/red) | Absolute drawdown (signed compact)             |
| `MAX`    | `MaeMfePanel` — Win/Loss scatter for the selected account and timeframe      | Scoped closed-trade count (`500+` if truncated) |
| `WIN`    | `PerformanceBars` — Sharpe/Profit Factor/Recovery gauges above streak and trade-size bars | Win rate % (≥70 green, ≥50 neutral, <50 amber) |
| `EXPECT` | `PerformanceRadar` — multi-axis performance radar                            | Expected payoff per trade                      |

**`EconomicCalendarList`** — client component (used internally by `OpenPositionsPanel` empty state); fetches from `/api/economic-events`; displays Forex Factory high-impact events in Bangkok time; supports drag-to-expand (see Expandable Panel Pattern). Component file: `EconomicCalendarList.tsx`.

**`BotPnLPanel`** — receives `historyPositions` from the positions detail endpoint; renders a compact P/L timeline chart for closed positions. Used in `gain` panel and `dd→DD` sub-panel. Per-bot trade-history sheet includes an outcome filter (ALL/WIN/LOSS) and newest/oldest sort toggle; the sheet is dismissed via drag-down-to-close or Escape (no dedicated close button).

**`PerformanceRadar`** (`EXPECT` sub-panel) — uses the shared `.perf-quality-panel--radar-only` layout variant to center the single radar chart instead of using the shared `.perf-quality-panel` three-column base layout.

**`MaeMfePanel`** (`MAX` sub-panel) — renders per-trade MAE/MFE coordinates from the selected account and timeframe as separate semantic-color Win/Loss scatter series. It plots only complete coordinate pairs and reports when the scoped response is truncated to the latest 500 closed trades.

---

## Responsive Rules

Keep overview and account context visible at the same time when space allows.

### Mobile Landscape

- Two-zone layout: balance chart dominant on one side, account context on the other.
- Identity, growth, and balance stay in the card header.
- KPI chips remain visible without forcing a drill-down.
- Secondary report sections must not occupy a permanent side rail.
- Horizontal paging between accounts is acceptable if account order remains stable.

### Mobile Portrait

- Single-column stack.
- Header stays compact.
- Chart remains above secondary content.
- Timeframe controls stay attached to the chart.
- KPI chips appear immediately after the chart as a dense grid or row.

### Shared Mobile Rules

- Pull-to-refresh works only from the top of the scroll container.
- Primary chart and KPI content fits without sideways panning.
- Horizontal scroll is acceptable for secondary tables or timeframe controls.
- Orientation changes must not reshuffle account ordering.
- **iOS baseline:** `dvh` units + `viewport-fit=cover`. In standalone PWA mode, apply `env(safe-area-inset-top)` to prevent status bar overlap; scroll content remains full-bleed in browser view.
- **Touch targets:** Interactive elements must meet 44×44pt minimum (iOS HIG). Use `min-h-[44px] min-w-[44px]` or padding to pad smaller visual elements.
- **Long-press** is the standard secondary action on mobile (detail sheet, context menu). Do not rely solely on hover. Implement with `onTouchStart`/`onTouchEnd` timer; cancel on `touchmove`.
- **Scroll performance:** Lists exceeding ~50 rows (positions, history) should use windowing. Avoid attaching scroll listeners directly to `window`; use the scroll container ref.

### Expandable Panel Pattern

Expandable panels (e.g. `EconomicCalendarPanel`) use framer-motion:

- `useDragControls` + `useMotionValue` for drag-to-expand gesture.
- Drag handle sits at the panel top edge.
- Panel height snaps between **collapsed** (peek height) → **expanded** (full viewport height) on drag release.
- Use `spring` transition for snap (`stiffness: 400, damping: 40`).
- `AnimatePresence` wraps the panel for mount/unmount animation.

---

## Account and Metric Rules

### Ordering

- Default: `Growth` `1D` descending.
- Tie-breakers: `Pips` `1D` → balance desc → accountNo asc.
- Ordering is preserved across breakpoints; selection changes focus only, never the sort.

### Timeframe Definitions

| Key   | Scope                 | Data source                                      |
| ----- | --------------------- | ------------------------------------------------ |
| `D`   | Today intraday        | `Deal`-derived hourly balance on fixed 0–23 axis |
| `1W`  | Last 7 days (rolling) | `Deal` balance curve                             |
| `1M`  | Last 30 days          | `Deal` balance curve                             |
| `3M`  | Last 90 days          | `Deal` balance curve                             |
| `6M`  | Last 180 days         | `Deal` balance curve                             |
| `1Y`  | Last 365 days         | `Deal` balance curve                             |
| `ALL` | Full history          | `Deal` balance curve                             |

Position-based metrics (`TRADES`, `GAIN`, `PIPS`, `DD`) are all timeframe-filtered except snapshot values (balance, equity, margin level).

### Balance Chart

- Single continuous balance line for selected account + timeframe.
- `D` sparkline: prior-day close as visual baseline; fixed 0–23 hourly axis in report-local time; no permanent gridlines or labels in compact card; exposes point balance + timestamp via tap tooltip.
- `D` sparkline now includes a live equity line (solid, `--neutral` color) alongside balance, sourced from `EquitySnapshot` + live Redis equity. This is `D` (1-day) timeframe only, consistent with the timeframe table above — other timeframes render the balance line only, no equity line.
- Segment color may communicate balance-event type (deposit / withdrawal ≠ trading P/L).
- If a live snapshot is newer than the last historical point, the UI may append a live point.

### KPI Chips

Required fast-scan KPIs (`ExpandableKpiKey`):

| Key      | Metric                    | Source                                      |
| -------- | ------------------------- | ------------------------------------------- |
| `gain`   | Net gain                  | `Deal` trading net P/L (timeframe-filtered) |
| `dd`     | Relative drawdown         | `Deal` balance curve (timeframe-filtered)   |
| `pips`   | Pips                      | `Position` (timeframe-filtered)             |
| `trades` | Total closed trades       | `Position` (timeframe-filtered)             |
| `opens`  | Live open positions count | `OpenPosition`                              |

Supplementary non-expandable chips may show floating P/L and margin level when available.

`TRADES` count and history list use timeframe-filtered closed `Position` rows only — no open positions.
`OPENS` tapping opens `OpenPositionsPanel` or the economic calendar fallback when no positions are active.

### Live vs Historical Display

- Show the WebSocket live beacon only when Redis live data is fresh and newer than the last account snapshot/report timestamp.
- Do not present stale WebSocket data as "live" — use the beacon only as a connection indicator.
- If live snapshot equity diverges from the last historical balance by more than a threshold, prefer snapshot for the header balance but keep the chart historical.

### Snapshot and Open Positions

Emphasize current-state: balance/equity, floating P/L, margin/exposure context.

For open positions summaries in compact layouts:

- Surface the most important live exposure first.
- Prefer market price over open price.
- Preferred compact fields: symbol, side, volume, market price, floating P/L.
- Do not force the full positions table into compact layouts.

---

## Analytics Expectations

- Growth follows MQL5-style logic — deposits/withdrawals do not distort performance.
- Use source-derived analytics when source data is available; `AccountReportResult` is a cache, not authoritative.
- Preserve balance-operation segmentation logic across UI and backend changes.
- `positionNetPnl = profit + swap + commission` — always include swap and commission.

**Source boundaries (do not mix):**

| Source                                 | Metrics                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Position`                             | Win rate, profit factor, Sharpe, expected payoff, avg/largest win-loss, consecutive streaks, trades/week, avg hold time, per-trade MAE/MFE |
| `Deal`                                 | Balance curve, growth, drawdowns, intraday balance (`D` timeframe)                                                      |
| `OpenPosition`                         | Floating P/L, open exposure, open counts                                                                                |
| `AccountSnapshot` / Redis              | Latest balance, equity, margin, marginLevel                                                                             |
| `EquitySnapshot` / `PositionExcursion` | Intraday equity, margin load, runtime excursion samples                                                                 |

Position metrics are timeframe-sensitive unless explicitly defined as snapshot values.

**Metric definitions:**

- **Recovery Factor** = Net Profit ÷ Max Absolute Drawdown (from `AccountReportResult.recoveryFactor`). Gauge thresholds: red <1 / amber 1–3 / green >3.
- **Relative Drawdown** = Max peak-to-valley equity drop as % of peak (from `AccountReportResult`).
- **Growth** = MQL5-style balance growth adjusted for deposits/withdrawals.

---

## States and Interaction

- **Loading:** preserve layout shape with skeletons — no layout shift.
- **Empty:** explicit and operational (e.g. economic calendar fallback when no open positions).
- **Errors:** render inline in the affected region; never collapse the full page.
- **Pull-to-refresh:** show visible progress; trigger only from the top of the scroll container.

---

## Visual Direction

**Brand:** Pure Black Terminal — OLED-first, single chromatic accent (electric blue). Semantic color for P/L. No decorative gradients or heavy borders. Emoji is allowed only as a semantic representation of a user or manual trades, not as decoration. Hairline `0.5px` white-alpha borders, deep near-black surfaces, 16px card radius.

### Design Tokens

**Single source of truth:** `design-system/trading-monitor/MASTER.md`

See the file for exact values for surfaces, accent palette, semantic colors, text/border alphas, typography roles, radius scale, and motion timing. Do not copy token values into other files — reference this document instead.

**Avoid:**

- Generic card mosaics
- Decorative gradients overpowering data
- Excessive borders around minor elements
- Marketing-style copy inside operational panels
- Legacy mobile fallbacks (`vh` units or manual iOS height scripts)
- Tailwind color defaults (e.g. `green-500`, `red-400`) — use semantic tokens from the design document

---

## Frontend and Bugfix Workflow

### Frontend Changes

- Preserve existing responsive dashboard behavior.
- Avoid unnecessary rerenders.
- Prefer incremental UI changes over rewrites.
- Reuse existing helpers and formatting utilities in `src/lib/trading/` and `src/components/trading-monitor/`.
- Keep chart-first mobile layouts intact.
- ApexCharts must be `dynamic` imported — it uses `window`/`document` and will crash SSR.

### Bug Fixing

- Investigate root cause before fixing.
- Avoid speculative changes.
- Prefer minimal diffs.
- Preserve trading analytics correctness and source boundaries.

### Verification

Before completing changes:

- Run `npm run lint` and relevant `*.test.ts` files.
- Verify both portrait and landscape on mobile.
- For analytics changes, cross-check against source boundary table above.

---

## When Updating This File

Update `AGENTS.md` when any of the following materially change:

- Primary dashboard composition or panel mapping
- Responsive behavior or breakpoints
- Account ordering assumptions
- KPI definitions or source boundaries
- API/data contract assumptions used by the frontend
- Design token values
