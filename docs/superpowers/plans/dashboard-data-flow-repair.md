# Dashboard Data-Flow Repair

**Status banner (2026-07-16):** Superseded by [`docs/superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md`](superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md) for the trade-history fix (Package 2). `/live` and account resolver work described here is complete; TradeHistoryPanel's "behavior-as-designed" framing below is superseded — pagination is DB-unbounded and gated for the bounded keyset rewrite in the new plan.

Traced 2026-07-15, against account `7998410` (real data: 340 Deal / 320 Order / 167 Position / 167 ClosedPosition / 20 OpenPosition / 5886 PositionExcursion) as the render-correctness reference, and `7953093` only for account-switch/resolver checks (thin dataset — 4 Deal / 2 Order / 1 Position from the single-chunk backfill proof).

Backend ingestion (Redis → worker-v2 → PostgreSQL) is proven working (see prior session proof on 7953093). This document traces the remaining path: PostgreSQL/Redis → API → hook → component, for the 6 flagged panels.

## Summary table

| Component | Data source (actual) | Root cause found | Severity |
|---|---|---|---|
| `DashboardCard.tsx` (live balance/equity) | `/api/accounts/[id]/live` → `getMt5LiveData` → **legacy** Redis `mt5:account:<no>:live` | **Reads a dead key namespace.** Legacy hash is stale (frozen ~26h old, `balance==equity`); legacy positions key doesn't exist at all. Real live data lives in `mt5:v2:account:<no>:live/positions`, snake_case fields, never read by this path. | **Critical — confirmed root cause** |
| `OpenPositionsPanel.tsx` | 3-way fallback: live Redis (dead, per above) → `positionsDetail` (Prisma `OpenPosition`) → `overview.data.openPositions` (Prisma) | Live overlay never engages (same dead-key issue), but Prisma fallback is populated by worker-v2 and likely renders correctly already. Confirm in browser — may not actually be broken once DashboardCard's live source is fixed (a broken live overlay silently no-ops into this fallback, it doesn't error). | Depends on Step 4 fix; likely **secondary**, not independently broken |
| `TradeHistoryPanel.tsx` | `/api/accounts/[id]/positions?timeframe=…` → Prisma `Position` (camelCase, no mismatch) | **No snake_case/camelCase bug** — confirmed the read path never touches `ClosedPosition`. Root cause: fetch is scoped to the dashboard's *selected* timeframe (not "all"), and only fires when `expandedKpi === "trades"`. If the account's last close is older than the selected window, empty history is correct filtering, not a bug. Separately, `sl`/`tp`/`pips`/`magic` are always `null` on `Position` (worker-v2 never sets them) — causes placeholder values, not empty rows. | **Behavior-as-designed** + a real but lower-severity field-completeness gap |
| `DrawdownEquityPanel.tsx` | `/api/accounts/[id]/balance?timeframe=…` → Prisma `Deal`-derived `balanceCurve`/`drawdownCurve` | Panel is labeled/styled as "equity" but only ever plots **balance** and balance-drawdown; the real `equityCurve` (from `EquitySnapshot`, live floating P/L) is fetched by the API but routed to a sibling `SparklineChart`, never read here. Single-point series render invisibly (`markers:{size:0}` + smooth curve). | **Confirmed semantic bug**, not empty-state |
| `BotPnLPanel.tsx` | Same `/positions` history array as TradeHistoryPanel | Groups by `Position.comment` regex, ignoring `magic`/`Strategy`/`AccountPerformanceByStrategy` entirely. Not dropping unassigned trades (falls to "Manual"), but stats shown are minimal (no win rate %, profit factor per bot). | Functional but **fragile/incomplete**, not broken |
| `DashboardClient.tsx` | `/api/accounts` → Prisma `TradingAccount` (24h `updatedAt` staleness filter) | Accounts not updated by any worker in the last 24h **silently vanish from the list** (no error shown). Page-level empty-state and error-state render identically (`CandleAnimation`) — a genuine backend failure and a healthy-but-empty account list are indistinguishable. Passes one consistent `id`/`account_number` object to every child — no divergent identifiers found. | **Real observability gap**, not itself why panels are empty |

## Cross-cutting finding: account-id resolution is duplicated and inconsistent

No shared `resolveAccount`/`toLogin` helper exists. Four independent call sites do cuid↔accountNo resolution:

1. `src/app/api/accounts/[id]/live/route.ts:25-28` — cuid-only, no fallback.
2. `src/app/api/accounts/[id]/route.ts:24-26` — cuid-only, no fallback.
3. `src/lib/trading/preaggregated-cache.ts:598-627` (`getAccountVersionProbe`) — cuid-only, backs overview/balance/positions/pips.
4. `src/lib/trading/account-data.ts:338-350` (`getAccountBundle`) — **the only one that tries accountNo first, then falls back to cuid.** Inconsistent with #1-#3.

Currently harmless in practice (dashboard only ever passes `account.id`, the cuid), but latent — Step 3 consolidates these into one resolver.

## Detailed per-component trace

### 1. `DashboardCard.tsx`

**Hooks:** `useApiResource` (generic fetch, 12s timeout, `src/components/trading-monitor/useApiResource.ts:21`), `useLiveData(accountId)` (polls `/api/accounts/<id>/live` every 2s, `src/hooks/useLiveData.ts:8` — **on error, keeps stale data, doesn't clear to null**), `useValueFlash` (cosmetic only).

**Endpoints fetched** (all keyed on `account.id`, the cuid — never `account_number`):
- `overview?timeframe=` — always
- `balance?timeframe=` — always
- `pips?timeframe=all` — only when `expandedKpi === "pips"`
- `positions?timeframe=&history=0` — only when `expandedKpi === "opens"` or dd-subpanel
- `positions?timeframe=all&history=0` — only when `expandedKpi === "trades"`
- `positions?timeframe=&limit=` (history rows) — only when trades or dd/dd-subpanel
- `/live` (via `useLiveData`) — always, polled 2s

**`overview`/`balance`/`pips`/`positions` routes** all go through `withCachedAccountView` → `getCachedAccountView` (`preaggregated-cache.ts:1594`) → `getAccountBundle` (`account-data.ts:338`) — **100% Prisma**, in-memory cache keyed on Prisma `updatedAt`, no Redis except `balance`'s one-off `buildEquityCurveForAccount` call (merges one live equity point, 4s timeout, swallows failure).

**`/live` route** (`src/app/api/accounts/[id]/live/route.ts`): resolves `id`→`accountNo`, then `getMt5LiveData(accountNo)` (`src/lib/redis-mt5.ts:124`):
- `mt5:account:<accountNo>:live` (hGetAll, **legacy**), `mt5:account:<accountNo>:positions` (GET, **legacy**)
- Expects camelCase fields (`freeMargin`, `marginLevel`, `tradeMode`) and camelCase positions JSON (`openPrice`, `currentPrice`, `openTime`)
- **Confirmed empirically:** legacy `:live` hash is frozen (`timestamp=1784040092` vs current ~1784134489, ~26h stale; `balance==equity==2487.66`, no floating P/L). Legacy `:positions` key **does not exist** (`TYPE none`) for 7998410.
- Real live data: `mt5:v2:account:<accountNo>:live` (fresh, `balance=2840.11 equity=2041.42 profit=-798.69`, **snake_case**: `margin_free`, `margin_level`, `trade_mode`, `margin_mode`) and `mt5:v2:account:<accountNo>:positions` (fresh JSON array, snake_case: `price_open`, `price_current`, `time`, `time_msc`). Freshness governed by `mt5:v2:bridge:<accountNo>:heartbeat`'s `lastSeen` field (hash), not by key existence.

**This is the confirmed root cause for "DashboardCard balance live data failed"** — the route reads a dead key namespace and silently serves stale values (not an error, so the UI shows wrong numbers rather than an error state) since the legacy hash still technically exists and parses.

**Error/empty states:** `overview.error` → card-level `InlineState tone="error"`. `overview.loading && !overview.data` → skeleton. Live open-position count badge prefers `liveOpenPositions` (always null under the dead-key bug) over `overview.data.kpis.openCount` — i.e. it silently falls back correctly today.

### 2. `OpenPositionsPanel.tsx`

Pure presentation, no own fetch. Receives `positions={liveOpenPositions ?? positionsDetail.data?.openPositions ?? overview.data?.openPositions}` from `DashboardCard`. `liveOpenPositions` is always `null` today (dead legacy key → `stale=true` → `mapLivePositions` returns `null`), so this silently falls to the Prisma-backed path — which worker-v2 keeps populated via `OpenPosition` upserts. **Likely renders correctly already**; re-verify in browser once Step 4 fixes the live source, since a working live overlay changes which branch of the fallback is exercised.

Empty-state nuance: "zero positions" and "data failed" look nearly identical unless `error` is set — the empty state always renders a technical-analysis CTA + economic calendar underneath, additively, even on error.

### 3. `TradeHistoryPanel.tsx`

Fed by `positionsHistory` (`DashboardCard.tsx:221-225`), gated behind `expandedKpi === "trades"`. Hits `/api/accounts/[id]/positions?timeframe=<selected>&limit=…` → `getAccountBundle` → Prisma `Position.where({closeTime: {gte: sinceDate}})`, ordered by `closeTime, positionNo`. **Confirmed: only `Position` is read, never `ClosedPosition`; no casing mismatch exists in this path** — `Position` has per-field `@map` so Prisma returns camelCase, matching `SerializedHistoryPosition`/`PositionsResponse` exactly.

Root cause candidates, ranked:
1. **Timeframe scoping** — the history row fetch uses the dashboard's *selected* timeframe, not `all` (only the KPI aggregate stats force `all`). If the account's most recent close is older than the selected window, empty history is correct filtering behavior, not a bug.
2. **Gated fetch** — only fires when the "trades" KPI is expanded; `positions` prop is `undefined` otherwise (expected).
3. **Field completeness gap (real, lower severity):** `src/worker-v2/position-reconstructor.ts:248-284`'s `prisma.position.upsert` never sets `sl`, `tp`, `pips`, `magic`, `mae`, `mfe` — always `NULL`. `TradeHistoryPanel` renders these as `"Mkt"`/`"—"`/`"-"` placeholders, not missing rows.

### 4. `DrawdownEquityPanel.tsx`

Pure presentation, fed `balanceDetail` from `DashboardCard`'s `/api/accounts/[id]/balance` fetch. Route computes `balanceCurve`/`drawdownCurve` from `Deal` rows (`analytics.ts`) and, only for `timeframe==="1d"`, an `equityCurve` from `EquitySnapshot`. **The panel never reads `equityCurve`** (`DrawdownEquityPanel.tsx:44,53` only touch `balanceCurve`/`drawdownCurve`) — it's labeled/aria'd as "Drawdown on equity" but plots balance, not equity. The real equity series is instead consumed only by the sibling `SparklineChart` (`DashboardCard.tsx:697-699`). `excludeTransfers=false` branch is dead code (only one callsite, always `true`). Single-point series render with no visible line/marker (`markers:{size:0}`, smooth curve) and no "no data" message (`return null` when `!balanceSeries.length`).

Field names match exactly between API and component (no casing drift) — this is a **semantic wiring bug**, not a contract mismatch.

### 5. `BotPnLPanel.tsx`

Fed the same `historyPositions` array as `TradeHistoryPanel`. Groups exclusively by `Position.comment` via regex classification (`src/lib/trading/bots.ts`), completely bypassing `Position.magic`, the `Strategy` model, and `AccountPerformanceByStrategy` — all of which exist in the schema specifically for bot/strategy attribution and are read nowhere in this component. No trades are dropped (unmatched/empty comment → `"Manual"`), but per-bot stats shown are minimal (net P/L, win/loss counts only — no win rate %, profit factor, trade count). Existing `BotPnLPanel.test.ts` only asserts the component doesn't re-filter by date client-side and calls `aggregate(positions)` — both currently pass, no coverage of grouping correctness.

### 6. `DashboardClient.tsx`

Fetches `/api/accounts` → `getAccountListItems` (`account-data.ts:552`) → Prisma `TradingAccount.where({updatedAt: {gte: now-24h}})`. **Accounts not touched by any worker in 24h silently disappear from the list** — no error surfaced. Page-level empty-state (`!accounts.data?.length || accounts.error`) renders the same `CandleAnimation` placeholder for both "zero accounts" and "fetch failed" — indistinguishable to the user. Passes one full `SerializedAccount` object (not a loose string) uniformly to every child; no divergent per-child identifiers found. Missing from `SerializedAccount`: no `brokerUtcOffsetMinutes`, no explicit `login` alias (children use `.account_number`/`.id` directly).

## Next steps (this doc is a working gate, not the deliverable)

1. Fix `src/lib/redis-mt5.ts` + `/api/accounts/[id]/live/route.ts` to read `mt5:v2:account:<no>:{live,positions}` and `mt5:v2:bridge:<no>:heartbeat`, with snake_case field parsing and heartbeat-based freshness — this is the highest-value fix (Step 4).
2. Re-verify `OpenPositionsPanel` in-browser after (1) — likely not independently broken.
3. Fix `DrawdownEquityPanel` to actually plot `equityCurve` where intended, or confirm with the user that "balance drawdown" is the intended semantic and just fix the label/aria-text instead.
4. Decide with the user whether enriching `Position.sl/tp/pips/magic` in worker-v2 is in scope now or a tracked follow-up.
5. Consolidate the 4 duplicated id-resolution call sites into one helper (Step 3).
