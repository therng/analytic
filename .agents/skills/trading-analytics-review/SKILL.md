---
name: trading-analytics-review
description: Review analytic platform changes for financial metric correctness, timeframe scope, authoritative data sources, and display mappings. Use when changes touch trading calculations, account APIs, metric registry entries, KPI values, balance curves, drawdowns, or position-derived statistics.
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

1. Map every changed metric to its authoritative source: `Position`, `Deal`, `OpenPosition`, snapshot/Redis, or equity/excursion samples.
2. Check timeframe filtering, deposit/withdrawal segmentation, and snapshot exceptions.
3. Confirm closed-trade P/L uses `profit + swap + commission`.
4. Trace the value from query through formula, API field, serialization, and display.
5. Check decimal precision and ensure rounding happens only at presentation boundaries.
6. Read focused tests and identify missing boundary cases such as empty periods, deposits, losses, truncation, and live-versus-historical divergence.

## Outputs

Return one status:

- `pass`: no material semantic issue.
- `fix`: list each issue with file/line evidence, violated rule, and expected correction.
- `blocked`: name the missing source or decision that prevents a trustworthy review.

For durable handoff, write `_workspace/02_review_analytics.md`.

## Validation

- No metric mixes authoritative sources.
- Position metrics are timeframe-sensitive unless explicitly snapshot-based.
- Growth and drawdown preserve balance-operation semantics.
- API names and UI labels describe the actual calculation.
- Tests cover the changed formula or boundary, not only rendering.
