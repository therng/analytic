# Dashboard Responsive Review — account-list ordering tie-break (trades 1D)

- status: pass
- date: 2026-08-19
- reviewer: dashboard-responsive-reviewer (read-only agent)
- reviewed scope: commit `6c92daab5a9cfca153d7441b75c87771a01270cc` (HEAD on main, parent `d3ac380`). Dashboard-relevant surface: `src/components/trading-monitor/formatters.test.ts` (only trading-monitor path in the diff), additive required `SerializedAccount.today_trade_count` (`src/lib/trading/types.ts:22`) on the `/api/accounts` response, and the server-side ordering tie-break (`src/lib/trading/account-data.ts:149-152`). Analytics-domain internals of the commit were reviewed separately (`_workspace/02_review_analytics.md`, pass).
- change: account-list card ORDERING only (Growth 1D desc -> Pips 1D desc -> Trades 1D desc -> balance desc -> accountNo asc) plus fixture-only test edits. No component, layout, CSS, chart, KPI-chip, or interaction code changed.

## Findings (all verified clean — no action)

### F1 — No dashboard render path consumes `today_trade_count` (or any list-level sort key)
- `today_trade_count` referenced only in `src/lib/trading/types.ts:22` (definition), `src/lib/trading/account-data.ts:149,527` (comparator + serializer), and tests. Zero component-side consumers.
- Stronger: no trading-monitor component renders ANY list-level sort field — grep for `today_growth_percent|today_net_pips|today_net_profit|week_growth_percent` across `src/components/trading-monitor/` (non-test) returns nothing. Card numbers come from per-card detail endpoints fetched in `DashboardCard.tsx` (`/api/accounts/{id}/overview`, `/balance`, `pips`, `positions`). `DeferredDashboardCard.tsx:22-26,96` reads only `status`, `account_number`, `owner_name`/`server` (via `displayName`), `balance`.

### F2 — `formatters.test.ts` edit is fixture-only and behavior-neutral
- Diff adds exactly three `today_trade_count: 0,` lines at `src/components/trading-monitor/formatters.test.ts:27,56,85`, inside three full `SerializedAccount` object literals for existing `displayName` tests. `displayName` (`src/components/trading-monitor/formatters.ts:185-188`) reads only `owner_name`/`server`; assertions unchanged. Suite passes 4/4.

### F3 — Ordering change is orientation- and composition-neutral
- Sort is applied server-side (`src/lib/trading/account-data.ts:165-167,661`) inside `getAccountListItems`; `/api/accounts` (`src/app/api/accounts/route.ts:10`) returns it; `DashboardClient.tsx:100,370` renders `accounts.data.map(...)` in received order. No client re-sort (only within-panel sorts: `BotPnLPanel.tsx:136,308`, `OpenPositionsPanel.tsx:26`).
- Portrait single-column grid (`src/app/globals.css:411-416`) and landscape horizontally paged chart-first workspaces (`globals.css:4690-4732`, scroll-snap over the same `.dashboard-section` DOM) consume one ordered list — re-ordering permutes cards/pages identically; per-card layout untouched.
- Only positional CSS is the entrance-animation stagger (`globals.css:514-531`, `:nth-child(1..5)`/`(n+6)` delays 0-155ms) — order-agnostic by design.
- React keys are `account.id` (`DashboardClient.tsx:372`): component state (timeframe selection, KPI expand, deferred-load flag) survives re-order; `LazyDashboardCard` eager threshold is positional `index < 2` (`LazyDashboardCard.tsx:8,24-26`) and works identically under any order.

### F4 — Gate: this artifact is required for the push
- `scripts/check-harness-review.sh d3ac380 6c92daa` BLOCKS: `src/components/trading-monitor/formatters.test.ts` matches `DASHBOARD_PATH_RE`, the commit message carries only the analytics marker, and `_workspace/02_review_dashboard.md` was not in the range. Coordinator must commit this artifact (or add a `dashboard review: pass` marker to a dashboard-path commit) within the push range.

## Checks performed
- Full `git show 6c92daa` diff review against the routing-table dashboard row (team-spec "API field changes consumed by dashboard" — coordinator-triggered second review; analytics was gate-enforced in-commit).
- Greps: field consumers, sort-key renders, client-side sorts, `SerializedAccount` consumers (`formatters.ts`, `DashboardClient.tsx`, `card/{DashboardCard,LazyDashboardCard,DeferredDashboardCard}.tsx` — all read-only consumers; additive field breaks none).
- Tests: `node --import tsx --test src/components/trading-monitor/formatters.test.ts` 4/4 pass; `src/components/trading-monitor/card/DashboardCard.test.ts` 10/10 pass.
- `npx tsc --noEmit`: errors confined to pre-existing `src/worker-v2/reconstruct-position-adapter.test.ts` (ingestion domain, untouched by this commit); all dashboard/lib files clean.
- Gate simulation on the exact push range (see F4).

## Viewport/interaction evidence
- Static code-trace in lieu of screenshots: the only user-visible delta is relative card order (data-driven), per-card composition identical in both orientations; no CSS/layout/interaction surface changed, so per-orientation rendering is unchanged by construction (single DOM, CSS-only orientation switch). No browser session run (read-only review); touch-target/Escape/pull-to-refresh/windowing surfaces untouched by the diff.

## Missing evidence
- `npm run build` not run by this reviewer (no component/CSS/app-shell change; tsc covers compile risk). Coordinator should keep it in the release baseline before push, as also noted by the analytics review.
