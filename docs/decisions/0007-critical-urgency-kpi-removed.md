# ADR-0007: CRITICAL urgency KPI removed after the 8.74 trial; substrate retained

## Status

Accepted

## Date

2026-09-06

## Context

Version 8.74 (2026-09-01 22:33 +07) shipped a composite **CRITICAL urgency
score** on the dashboard: floating-loss 35 pts / margin-level 50 pts /
deposit-load 15 pts, surfaced as a supplementary KPI chip at ≥40 and a card
edge at ≥70, riding the pre-existing XAUUSD-volume deposit-load estimate.

Version 8.75 (2026-09-03 06:25 +07, `bbb6e28`, 20 files +25/−279) removed the
entire composite — score module, `SerializedAccount.critical_score`, chip,
card edge, CSS, metric-registry entry — after roughly **32 hours of live
trial**. Unlike the 8.66 course-correction, **no rationale was recorded** for
the removal; the operator declined to state one when asked (2026-09-06) and
delegated the disposition to review, which concluded: keep removed.

Notably, the removal deliberately **preserved the substrate** —
`deposit_load_pct` / `deposit_load_source` — rather than ripping out the
underlying estimates.

## Decision

The CRITICAL urgency KPI stays removed. We record this ADR so the decision is
greppable rather than living only in revert history.

## Consequences

- The composite score is not to be re-added as-shipped.
- **Retry preconditions:** any future urgency/health KPI work must begin with
  the operator naming *which aspect failed* in the 8.74 trial — the weighting
  (35/50/15), the thresholds (≥40/≥70), the placement (chip + card edge), or
  redundancy with the existing KPI chips. Without that, a redesign would most
  likely rebuild the wrong thing twice.
- The deposit-load substrate remains shipped and is the reuse point for any
  future attempt (see CHANGELOG 8.75 for the preserved-fields list).
- Cross-references: CHANGELOG 8.74 (formula), 8.75 (removal mechanics).
