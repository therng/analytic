# Repository Guidelines

> **For commands, stack, directory structure, coding conventions, data model, and environment variables — see `CLAUDE.md`.** This file covers dashboard behaviour, UI conventions, analytics rules, and visual design. Update `AGENTS.md` when those change; update `CLAUDE.md` when commands or stack change.

## Agent Workflow Notes

- Check the worktree before editing — this repo may contain unrelated local deletions or experiments.
- Dashboard work starts in `src/components/trading-monitor/`, `src/app/globals.css`, and the account API routes.
- Dashboard, analytics, and worker work — no active Python backend (FastAPI/collector are present but inactive).
- When modifying responsive dashboard behavior, verify both portrait **and** landscape — changes often break the other orientation silently.
- API terminology: account list → `/api/accounts`; account detail → `/api/accounts/[id]?timeframe=...`; economic calendar → `/api/economic-events?scope=expanded` (30-day window) or default (today + nearest week), Forex Factory source, Bangkok time, `force-dynamic`.
- For import/debug workflows, `npm run worker:local` reads from `data/source-reports` by default; override with `LOCAL_REPORT_DIR`.
- The worker ignores report files that are too fresh or too small — tune `WORKER_POLL_MS`, `WORKER_FILE_STABLE_MS`, `WORKER_MIN_FILE_SIZE_BYTES` in `.env` before changing ingestion logic.

## Commit and PR Guidance

- Descriptive imperative commits: `fix: stabilize win stats across timeframes`.
- Keep PRs focused; call out user-visible behavior changes.
- Include screenshots for dashboard or layout work.
- Note schema, migration, parser, or backfill implications in the PR body.
- List verification commands and test suites you ran.

## Security and Data Safety

- Never commit `.env` values, credentials, database secrets, or imported report data.
- Review Prisma migrations before applying them.
- Avoid destructive cleanup or import actions against shared environments.
- When changing parser/backfill behavior, document expected inputs, migration risk, and rollback considerations.

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

| Chip key | Canvas panel | Detail chips (below KPI row) |
|----------|-------------|------------------------------|
| `gain`   | No overlay — SparklineChart (balance curve) is the detail view | COMM. / SWAP / DEPOS. / WITHD. (from `overview.kpis`) |
| `dd`     | Sub-panel toggled via 5 chips (see below) | DD / ABS / MAX / LOAD / EXPECT |
| `pips`   | `PipsPerformanceTable` + `ProfitHeatmapPanel` (stacked) | — (canvas is comprehensive) |
| `trades` | `TradeHistoryPanel` | ACTIVITY (total) / PER WEEK / HOLDING |
| `opens`  | `OpenPositionsPanel` (handles empty state internally with `EconomicCalendarList`) | FLOAT. P/L / MARGIN / FREE MRG / LEVEL% (from `SerializedAccount`) |

**DD sub-panel chips** (default = DD):

| Chip | Canvas | Value shown in chip |
|------|--------|---------------------|
| `DD`     | `BotPnLPanel` — closed-position P/L timeline | Drawdown % (default; no sub-chip) |
| `ABS`    | `DrawdownEquityPanel` — equity line + drawdown% area (dual y-axis, blue/red) | Absolute drawdown (signed compact) |
| `MAX`    | `PerformanceQualityPanel` — gauge comparisons | Maximal drawdown amount (unsigned, red) |
| `WIN`    | `PerformanceBars` — streak/trade-size bars (no BotPnL) | Win rate % (≥70 green, ≥50 neutral, <50 amber) |
| `EXPECT` | `PiePanel` — symbol distribution pie | Expected payoff per trade |

**`EconomicCalendarList`** — client component (used internally by `OpenPositionsPanel` empty state); fetches from `/api/economic-events`; displays Forex Factory high-impact events in Bangkok time; supports drag-to-expand (see Expandable Panel Pattern). Component file: `EconomicCalendarList.tsx`. Also available standalone via `DraggableCalendarPanel`.

**`BotPnLPanel`** — receives `historyPositions` from the positions detail endpoint; renders a compact P/L timeline chart for closed positions. Used in `gain` panel and `dd→DD` sub-panel.

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

| Key | Scope | Data source |
|-----|-------|-------------|
| `D` | Today intraday | `Deal`-derived hourly balance on fixed 0–23 axis |
| `1W` | Last 7 days (rolling) | `Deal` balance curve |
| `1M` | Last 30 days | `Deal` balance curve |
| `3M` | Last 90 days | `Deal` balance curve |
| `6M` | Last 180 days | `Deal` balance curve |
| `1Y` | Last 365 days | `Deal` balance curve |
| `ALL` | Full history | `Deal` balance curve |

Position-based metrics (`TRADES`, `GAIN`, `PIPS`, `DD`) are all timeframe-filtered except snapshot values (balance, equity, margin level).

### Balance Chart

- Single continuous balance line for selected account + timeframe.
- `D` sparkline: prior-day close as visual baseline; fixed 0–23 hourly axis in report-local time; no permanent gridlines or labels in compact card; exposes point balance + timestamp via tap tooltip.
- Segment color may communicate balance-event type (deposit / withdrawal ≠ trading P/L).
- If a live snapshot is newer than the last historical point, the UI may append a live point.

### KPI Chips

Required fast-scan KPIs (`ExpandableKpiKey`):

| Key | Metric | Source |
|-----|--------|--------|
| `gain` | Net gain | `Position` (timeframe-filtered) |
| `dd` | Relative drawdown | `AccountReportResult` |
| `pips` | Pips | `Position` (timeframe-filtered) |
| `trades` | Total closed trades | `Position` (timeframe-filtered) |
| `opens` | Live open positions count | `OpenPosition` |

Supplementary non-expandable chips may show floating P/L and margin level when available.

`TRADES` count and history list use timeframe-filtered closed `Position` rows only — no open positions.
`OPENS` tapping opens `OpenPositionsPanel` or the economic calendar fallback when no positions are active.

### Live vs Historical Display

- Show the WebSocket live beacon only when the `AccountSnapshot` timestamp is fresher than the last `ReportImport`.
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

| Source | Metrics |
|--------|---------|
| `Position` | Win rate, profit factor, Sharpe, expected payoff, avg/largest win-loss, consecutive streaks, trades/week, avg hold time |
| `Deal` | Balance curve, growth, drawdowns, intraday balance (`D` timeframe) |
| `OpenPosition` | Floating P/L, open exposure, open counts |
| `AccountSnapshot` / Redis | Latest balance, equity, margin, marginLevel |

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

**Brand:** Pure Black Terminal — OLED-first, single chromatic accent (electric blue). Semantic color for P/L. No decorative gradients, no emoji, no heavy borders. Hairline `0.5px` white-alpha borders, deep near-black surfaces, 16px card radius.

### Design Tokens

**Single source of truth:** `docs/Analytic Design Tokens (Standalone).html`

Open the file in a browser to see exact values for surfaces, accent palette, semantic colors, text/border alphas, typography roles, radius scale, and motion timing. Do not copy token values into other files — reference this document instead.

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

---

## Social Layer

### Components

| Component | File | Role |
|-----------|------|------|
| `ShoutTicker` | `src/components/social/ShoutTicker.tsx` | Horizontal ticker strip; cycles through active shouts; opens `ShoutModal` on tap |
| `ShoutModal` | `src/components/social/ShoutModal.tsx` | Full shout feed + compose area; handles unauthenticated, `needsUsername`, and authenticated states |
| `EmojiReactionBar` | `src/components/social/EmojiReactionBar.tsx` | Per-shout emoji reaction bar (compact mode hides zero-count buttons unless `canReact`) |

### Shout Lifecycle

- Shouts expire after **12 hours** — `expiresAt` is set at creation time.
- `ShoutTicker` auto-cycles through active shouts; shows remaining time (`<1h` / `Xh`).
- When no shouts exist, `ShoutTicker` still renders the ticker bar (empty state).

### Authentication States (`useSocialSession`)

| Status | Compose UI |
|--------|------------|
| `authenticated` | Textarea + Shout button |
| `needsUsername` | Inline amber notice — prompt user to set username first |
| `unauthenticated` | Sign in with Google / Sign in with Apple buttons |

### Data Flow

- `useShouts` — polls/subscribes to active shouts.
- `useSocialSession` — wraps `next-auth` session; derives `authenticated` / `needsUsername` / `unauthenticated`.
- `EmojiReactionBar` targets: `targetType = "SHOUT"`, `targetId = shout.id`.

### Conventions

- Sign-in uses `next-auth` providers: `google` and `apple` (via `signIn()` from `next-auth/react`).
- Do not surface admin/moderator controls in this layer — shouts are ephemeral and self-expiring.
- Compact `EmojiReactionBar` appears under each shout in `ShoutModal`'s feed list.

---

## Candlestick Pattern Knowledge Base

### Goal
A visual-only pattern recognition system to help users learn candlestick formations through repetition without textual descriptions.

### Design Principles
- **No text labels**: No pattern names, no "bullish/bearish" text, no descriptions.
- **Visual-only communication**: Knowledge is conveyed through formation, trend context, and outcome animation.
- **Pure Black UI**: Matches the dashboard aesthetic (#000 background, panel-0/panel-1 surfaces).

### Implementation
- **Components**: `src/components/patterns/` (PatternCard, PatternCanvas, Candle, TrendTrace).
- **Patterns**: `src/lib/patterns/` (Bullish and Bearish reversal patterns).
- **Animation Cycle**: 
  1. **Trend** (800ms): Lightweight trace showing context (up/down).
  2. **Formation** (800ms): Sequential candle appearance.
  3. **Pause** (400ms): Recognition window.
  4. **Outcome** (1000ms): Directional price trace + glow effect.
- **Responsive**: Grid layout (1 col mobile, 2 col tablet, 4 col desktop).
