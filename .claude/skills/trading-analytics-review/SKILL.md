---
name: trading-analytics-review
description: "Use when changes touch trading calculations, account APIs, metric registry entries, KPI values, balance curves, drawdowns, or position-derived statistics."
version: 1.1.0
---

# Trading Analytics Review

## When to Use

- Review changes in `src/lib/trading/`, account detail APIs, analytics caches, metric registry, or KPI serialization.
- Use when a UI change alters the meaning, formula, scope, or source of a displayed metric.
- Do not use for purely visual styling with unchanged data semantics.

## Required Inputs

- Original request and acceptance criteria.
- Changed diff and relevant tests.
- `AGENTS.md` source-boundary and metric-definition sections.
- `src/lib/trading/metric-registry.ts` for displayed metrics.

## Workflow

1. Map every changed metric to its authoritative source: `Position`, `Deal`, `OpenPosition`, snapshot/Redis, or equity/excursion samples. Treat `AccountReportResult` as a cache, never the authority when source data exists.
2. Trace every displayed value from source through formula, API field, `src/lib/trading/metric-registry.ts`, and its panel or label.
3. Check timeframe filtering, deposit/withdrawal segmentation, and snapshot exceptions. Position metrics are timeframe-sensitive unless the component/API contract explicitly requests all-history data.
4. Confirm closed-trade P/L uses `profit + swap + commission`, and typed funding deals never enter trading P/L metrics. Preserve MQL5-style growth segmentation for deposits and withdrawals.
5. Verify relative drawdown and maximum balance drawdown amount come from the scoped `Deal` balance curve. Verify recovery factor is scoped closed-position net P/L divided by that maximum balance drawdown amount.
6. For MAE/MFE distributions, plot only complete coordinate pairs, preserve win/loss semantic series, and disclose even sampling when the scoped response is capped at 1,000 closed positions.
7. Check decimal precision and ensure rounding happens only at presentation boundaries. For `D`, verify the scope remains the Bangkok day and live equity is not generalized to other timeframes.
8. Read focused tests and identify missing boundary cases such as empty periods, funding operations, losses, truncation, all-history panel exceptions, and live-versus-historical divergence.

## Outputs

Return `pass`, `fix`, or `blocked` per the review-artifact contract in `docs/harness/analytic/team-spec.md` (status, reviewed scope/commit identity, findings with file/line evidence, required action, checks performed):

- `pass`: no material semantic issue.
- `fix`: list each issue with file/line evidence, violated rule, and expected correction.
- `blocked`: name the missing source or decision that prevents a trustworthy review.

For durable handoff, write `_workspace/02_review_analytics.md`.

## Validation

- No metric mixes authoritative sources; `AccountReportResult` remains a cache, not authority.
- Position metrics are timeframe-sensitive unless an explicit component/API contract intentionally requests all-history data.
- Growth and drawdown preserve balance-operation semantics.
- API names and UI labels describe the actual calculation.
- Rounding occurs only at display boundaries, and the source/API/display mapping matches `metric-registry.ts`.
- Tests cover the changed formula or boundary, not only rendering.
