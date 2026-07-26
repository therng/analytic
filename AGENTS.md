# Repository Guidelines

> **Commands, stack, dir structure, coding conventions, data model, env vars — see `CLAUDE.md`.** This file cover dashboard behavior, UI convention, analytics rule, visual design. Update `AGENTS.md` when those change; update `CLAUDE.md` when commands or stack change.

## Agent Workflow Notes

- Check worktree before editing — repo may hold unrelated local deletions or experiments.
- Dashboard work start in `src/components/trading-monitor/`, `src/app/globals.css`, account API routes.
- Dashboard, analytics, worker work — stack Next.js + Node.js worker + Prisma/PostgreSQL only; no Python services.
- Automatic history lifecycle: Python bridge publish bounded Deal/Order/Position envelopes with raw MT5 UTC epochs plus barriers; Node worker persist those UTC instants idempotently, advance PostgreSQL `BridgeHistoryCheckpoint` only after all barriers/counts/digests commit. Never shift MetaTrader Python epochs by broker-server offset. Redis `mt5:bridge:history-ack:{login}` derived mirror only. Missing state starts at 2025-01-01; never epoch or 30-day fallback.
- Modifying responsive dashboard behavior — verify both portrait **and** landscape. Changes often break other orientation silently.
- API terms: account list → `/api/accounts`; account detail → `/api/accounts/[id]?timeframe=...`; trade history → `/api/accounts/[id]/trade-history` (cursor-paginated); economic calendar → `/api/economic-events?scope=expanded` (30-day window) or default (today + nearest week), Forex Factory source, Bangkok time, `force-dynamic`.
- Worker Bridge/Redis-only. Don't reintroduce FTP, HTML report parsing, manual local import, file-hash dedup, or UI mappings to fields not in Bridge/Redis/PostgreSQL path.
- Metric display mappings live `src/lib/trading/metric-registry.ts`; every UI metric need source, formula, API field, display target.

## Commit and PR Guidance

- Descriptive imperative commits: `fix: stabilize win stats across timeframes`.
- Keep PRs focused; call out user-visible behavior changes.
- Include screenshots for dashboard/layout work.
- Note schema, migration, Bridge/Redis ingestion, or analytics implications in PR body.
- List verification commands and test suites run.

## Security and Data Safety

- Never commit `.env` values, credentials, DB secrets, imported report data.
- Review Prisma migrations before applying.
- Avoid destructive cleanup or import actions against shared environments.
- Changing Bridge/Redis ingestion or analytics behavior → document expected inputs, migration risk, rollback considerations.

---

## Frontend Product Direction

### Product Goal

Dashboard helps operator answer three questions fast:

- which accounts matter most right now
- what balance/equity curve doing
- where to drill next without losing context

Operational surface. Favor orientation, chart readability, trustworthy KPIs over decorative density.

### Current Layout Model

- **Mobile landscape:** horizontally paged account workspaces, chart-first composition
- **Mobile portrait:** compact single-column account cards

Avoid reverting to generic card mosaic layout.

---

## Dashboard Panel Composition

Each account card exposes overlay panel driven by tapped KPI chip (`ExpandableKpiKey`):

| Chip key | Canvas panel                                                                      | Detail chips (below KPI row)                                       |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `gain`   | No overlay — SparklineChart (balance curve) is detail view                    | COMM. / SWAP / DEPOS. / WITHD. (from `overview.kpis`)              |
| `dd`     | Sub-panel selected via 4 chips (default = DD; see below)                          | ABS / MAX / WIN / EXPECT                                             |
| `pips`   | `PipsPerformanceTable` + `ProfitHeatmapPanel` (stacked)                           | — (canvas comprehensive)                                            |
| `trades` | `TradeHistoryPanel`                                                               | ACTIVITY (total) / PER WEEK / HOLDING                                |
| `opens`  | `OpenPositionsPanel` (handles empty state internally with `EconomicCalendarList`) | FLOAT. P/L / MARGIN / FREE MRG / LEVEL% (from `SerializedAccount`) |

**DD sub-panel chips** (default = DD; tapping active sub-panel chip again toggles back to `DD`):

| Chip     | Canvas                                                                       | Value shown in chip                            |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `DD`     | `BotPnLPanel` — closed-position P/L timeline                                 | Drawdown % (default; no sub-chip)              |
| `ABS`    | `DrawdownEquityPanel` — Sparkline-based equity + drawdown lines (green/red) | Absolute drawdown (signed compact)             |
| `MAX`    | `MaeMfePanel` — Win/Loss scatter for selected account and timeframe          | Scoped closed-trade count (`500+` if truncated) |
| `WIN`    | `PerformanceBars` — Sharpe/Profit Factor/Recovery gauges above streak and trade-size bars | Win rate % (≥70 green, ≥50 neutral, <50 amber) |
| `EXPECT` | `PerformanceRadar` — multi-axis performance radar                            | Expected payoff per trade                      |

**`EconomicCalendarList`** — client component (used internally by `OpenPositionsPanel` empty state); fetches from `/api/economic-events`; shows Forex Factory high-impact events in Bangkok time; supports drag-to-expand (see Expandable Panel Pattern). Component file: `EconomicCalendarList.tsx`.

**`BotPnLPanel`** — receives `historyPositions` from positions detail endpoint; renders compact P/L timeline chart for closed positions. Used in `gain` panel and `dd→DD` sub-panel. Per-bot trade-history sheet has outcome filter (ALL/WIN/LOSS) and newest/oldest sort toggle; sheet dismissed via drag-down-to-close or Escape (no dedicated close button).

**`PerformanceRadar`** (`EXPECT` sub-panel) — uses shared `.perf-quality-panel--radar-only` layout variant to center single radar chart instead of shared `.perf-quality-panel` three-column base layout.

**`MaeMfePanel`** (`MAX` sub-panel) — renders per-trade MAE/MFE coordinates from selected account and timeframe as separate semantic-color Win/Loss scatter series. Plots only complete coordinate pairs, reports when scoped response truncated to latest 500 closed trades.

---

## Responsive Rules

Keep overview and account context visible same time when space allows.

### Mobile Landscape

- Two-zone layout: balance chart dominant one side, account context other.
- Identity, growth, balance stay in card header.
- KPI chips remain visible without forcing drill-down.
- Secondary report sections must not occupy permanent side rail.
- Horizontal paging between accounts OK if account order stable.

### Mobile Portrait

- Single-column stack.
- Header stays compact.
- Chart stays above secondary content.
- Timeframe controls stay attached to chart.
- KPI chips appear immediately after chart as dense grid or row.

### Shared Mobile Rules

- Pull-to-refresh works only from top of scroll container.
- Primary chart and KPI content fits without sideways panning.
- Horizontal scroll OK for secondary tables or timeframe controls.
- Orientation changes must not reshuffle account ordering.
- **iOS baseline:** `dvh` units + `viewport-fit=cover`. In standalone PWA mode, apply `env(safe-area-inset-top)` to prevent status bar overlap; scroll content stays full-bleed in browser view.
- **Touch targets:** Interactive elements must meet 44×44pt minimum (iOS HIG). Use `min-h-[44px] min-w-[44px]` or padding to pad smaller visual elements.
- **Long-press** standard secondary action on mobile (detail sheet, context menu). Don't rely solely on hover. Implement with `onTouchStart`/`onTouchEnd` timer; cancel on `touchmove`.
- **Scroll performance:** Lists exceeding ~50 rows (positions, history) should use windowing. Avoid attaching scroll listeners directly to `window`; use scroll container ref.

### Expandable Panel Pattern

Expandable panels (e.g. `EconomicCalendarPanel`) use framer-motion:

- `useDragControls` + `useMotionValue` for drag-to-expand gesture.
- Drag handle sits at panel top edge.
- Panel height snaps between **collapsed** (peek height) → **expanded** (full viewport height) on drag release.
- Use `spring` transition for snap (`stiffness: 400, damping: 40`).
- `AnimatePresence` wraps panel for mount/unmount animation.

---

## Account and Metric Rules

### Ordering

- Default: `Growth` `1D` descending.
- Tie-breakers: `Pips` `1D` → balance desc → accountNo asc.
- Ordering preserved across breakpoints; selection changes focus only, never sort.

### Timeframe Definitions

| Key   | Scope                 | Data source                                      |
| ----- | ---------------------- | -------------------------------------------------- |
| `D`   | Today intraday        | `Deal`-derived hourly balance on fixed 0–23 axis |
| `1W`  | Last 7 days (rolling) | `Deal` balance curve                              |
| `1M`  | Last 30 days          | `Deal` balance curve                              |
| `3M`  | Last 90 days          | `Deal` balance curve                              |
| `6M`  | Last 180 days         | `Deal` balance curve                              |
| `1Y`  | Last 365 days         | `Deal` balance curve                              |
| `ALL` | Full history          | `Deal` balance curve                              |

Position-based metrics (`TRADES`, `GAIN`, `PIPS`, `DD`) all timeframe-filtered except snapshot values (balance, equity, margin level).

### Balance Chart

- Single continuous balance line for selected account + timeframe.
- `D` sparkline: prior-day close as visual baseline; fixed 0–23 hourly axis in report-local time; no permanent gridlines or labels in compact card; exposes point balance + timestamp via tap tooltip.
- `D` sparkline now includes a live equity line (solid, `--equity` purple) alongside balance, sourced from `EquitySnapshot` + live Redis equity. This `D` (1-day) timeframe only, consistent with timeframe table above — other timeframes render balance line only, no equity line.
- Segment color may communicate balance-event type (deposit / withdrawal ≠ trading P/L).
- If live snapshot newer than last historical point, UI may append live point.

### KPI Chips

Required fast-scan KPIs (`ExpandableKpiKey`):

| Key      | Metric                    | Source                                      |
| -------- | -------------------------- | -------------------------------------------- |
| `gain`   | Net gain                  | `Deal` trading net P/L (timeframe-filtered) |
| `dd`     | Relative drawdown         | `Deal` balance curve (timeframe-filtered)   |
| `pips`   | Pips                      | `Position` (timeframe-filtered)             |
| `trades` | Total closed trades       | `Position` (timeframe-filtered)             |
| `opens`  | Live open positions count | `OpenPosition`                              |

Supplementary non-expandable chips may show floating P/L and margin level when available.

`TRADES` count and history list use timeframe-filtered closed `Position` rows only — no open positions.
`OPENS` tapping opens `OpenPositionsPanel` or economic calendar fallback when no positions active.

### Live vs Historical Display

- Show WebSocket live beacon only when Redis live data fresh and newer than last account snapshot/report timestamp.
- Don't present stale WebSocket data as "live" — beacon only as connection indicator.
- If live snapshot equity diverges from last historical balance beyond threshold, prefer snapshot for header balance but keep chart historical.

### Snapshot and Open Positions

Emphasize current-state: balance/equity, floating P/L, margin/exposure context.

For open positions summaries in compact layouts:

- Surface most important live exposure first.
- Prefer market price over open price.
- Preferred compact fields: symbol, side, volume, market price, floating P/L.
- Don't force full positions table into compact layouts.

---

## Analytics Expectations

- Growth follows MQL5-style logic — deposits/withdrawals don't distort performance.
- Use source-derived analytics when source data available; `AccountReportResult` is cache, not authoritative.
- Preserve balance-operation segmentation logic across UI and backend changes.
- `positionNetPnl = profit + swap + commission` — always include swap and commission.

**Source boundaries (don't mix):**

| Source                                 | Metrics                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Position`                             | Win rate, profit factor, Sharpe, expected payoff, avg/largest win-loss, consecutive streaks, trades/week, avg hold time, per-trade MAE/MFE |
| `Deal`                                 | Balance curve, growth, drawdowns, intraday balance (`D` timeframe)                                                      |
| `OpenPosition`                         | Floating P/L, open exposure, open counts                                                                                |
| `AccountSnapshot` / Redis              | Latest balance, equity, margin, marginLevel                                                                             |
| `EquitySnapshot` / `PositionExcursion` | Intraday equity, margin load, runtime excursion samples                                                                 |

Position metrics timeframe-sensitive unless explicitly defined as snapshot values.

**Metric definitions:**

- **Recovery Factor** = Net Profit ÷ Max Absolute Drawdown (from `AccountReportResult.recoveryFactor`). Gauge thresholds: red <1 / amber 1–3 / green >3.
- **Relative Drawdown** = Max peak-to-valley equity drop as % of peak (from `AccountReportResult`).
- **Growth** = MQL5-style balance growth adjusted for deposits/withdrawals.

---

## States and Interaction

- **Loading:** preserve layout shape with skeletons — no layout shift.
- **Empty:** explicit and operational (e.g. economic calendar fallback when no open positions).
- **Errors:** render inline in affected region; never collapse full page.
- **Pull-to-refresh:** show visible progress; trigger only from top of scroll container.

---

## Visual Direction

**Brand:** Pure Black Terminal — OLED-first, single chromatic accent (electric blue). Semantic color for P/L. No decorative gradients or heavy borders. Emoji allowed only as semantic representation of user or manual trades, not decoration. Hairline `0.5px` white-alpha borders, deep near-black surfaces, 16px card radius.

### Design Tokens

**Single source of truth:** `design-system/trading-monitor/MASTER.md`

See file for exact values — surfaces, accent palette, semantic colors, text/border alphas, typography roles, radius scale, motion timing. Don't copy token values into other files — reference this document instead.

**Avoid:**

- Generic card mosaics
- Decorative gradients overpowering data
- Excessive borders around minor elements
- Marketing-style copy inside operational panels
- Legacy mobile fallbacks (`vh` units or manual iOS height scripts)
- Tailwind color defaults (e.g. `green-500`, `red-400`) — use semantic tokens from design document

---

## Frontend and Bugfix Workflow

### Frontend Changes

- Preserve existing responsive dashboard behavior.
- Avoid unnecessary rerenders.
- Prefer incremental UI changes over rewrites.
- Reuse existing helpers and formatting utilities in `src/lib/trading/` and `src/components/trading-monitor/`.
- Keep chart-first mobile layouts intact.
- ApexCharts must be `dynamic` imported — uses `window`/`document`, will crash SSR.

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

Update `AGENTS.md` when any of following materially change:

- Primary dashboard composition or panel mapping
- Responsive behavior or breakpoints
- Account ordering assumptions
- KPI definitions or source boundaries
- API/data contract assumptions used by frontend
- Design token values
