---
name: dashboard-responsive-review
description: "Use when changes touch trading-monitor components, globals.css, dashboard app-shell pages (src/app/page|layout|loading.tsx), dashboard account APIs, charts, KPI chips, or expandable panels."
version: 1.1.0
---

# Dashboard Responsive Review

## When to Use

- Review changes under `src/components/trading-monitor/`, `src/app/globals.css`, dashboard pages, or account APIs consumed by the dashboard.
- Use for charts, KPI panels, mobile interactions, loading/empty/error states, or orientation-specific layouts.
- For API field changes consumed by the dashboard, the pre-push gate enforces only Analytics; dashboard review of the consumed response shape is coordinator-triggered (team-spec "Analytics + Dashboard" row), not gate-enforced.
- Do not use for backend-only changes that preserve the dashboard contract.

## Required Inputs

- Original request and changed diff.
- Relevant component tests and API response types.
- `AGENTS.md` dashboard composition and responsive rules.
- `design-system/trading-monitor/MASTER.md`.

## Workflow

1. Check the requested panel against the KPI-to-panel mapping and metric registry: `gain`; `dd` with `DD`, `ABS`, `MAX`, `WIN`, and `EXPECT`; `pips`; `trades`; and `opens`. Confirm `MAX` selects `TradeDistributionPanel` and `opens` retains its economic-calendar empty fallback.
2. Inspect portrait and landscape layouts without changing account order. Preserve landscape's horizontally paged, chart-first workspaces and portrait's compact single-column cards.
3. Verify the primary chart and KPI content avoid sideways panning; allow horizontal scroll only for secondary tables or controls. For UI timeframe `D`, confirm the API scope is `1d`, the axis is fixed to Bangkok 0–23 hours with a prior-day-close baseline, and the live equity line appears only there; other timeframes render balance only.
4. Check 44×44pt touch targets and their focused tests, long-press cancellation, drag gestures, Escape handling, pull-to-refresh only at the top of the owned scroll container, and list windowing above roughly 50 rows.
5. Confirm charts that access browser globals remain dynamically imported.
6. Check `dvh`, `viewport-fit=cover`, standalone safe-area behavior, loading shape, inline errors, and operational empty states.
7. Verify token usage against the design-system source; reject decorative gradients, Tailwind default colors, and duplicated token literals.
8. Trace each panel request to its API contract. `TradeHistoryPanel` and `BotPnLPanel` use the selected timeframe; Pips performance, its heatmap, and the trade activity/per-week/holding summary intentionally request all-history data. Treat a mismatch between documentation and this contract as an issue to reconcile with evidence, not an assumption to overwrite.
9. When editing `ExpandableKpiKey`, preserve the existing `profit` compatibility key unless its callers and tests are deliberately migrated.

## Outputs

Return `pass`, `fix`, or `blocked` per the review-artifact contract in `docs/harness/analytic/team-spec.md` (status, reviewed scope/commit identity, findings with file/line evidence, required action, checks performed), plus viewport/interaction evidence. For durable handoff, write `_workspace/02_review_dashboard.md`.

## Validation

- Portrait and landscape are both verified at mobile dimensions.
- Account ordering and chart-first composition are preserved.
- Interactive elements meet touch and keyboard expectations.
- Visual screenshots accompany user-visible layout changes when practical.
- Data labels and panel content match the actual API fields and metric definitions.
