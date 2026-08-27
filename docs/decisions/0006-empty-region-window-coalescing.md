# ADR-0006: Empty-region window coalescing for history backfill

## Status

Accepted

## Date

2026-08-26

## Context

The history-backfill invariant mandates a `2025-01-01` lower bound with every
window durably recorded, so historical coverage is provably gap-free. On
2026-08-18 all five production accounts had zero 2025 deals (first deals
2026-02-25 → 2026-04-23): at the default one-day window (~7 windows/min) a
fresh journal crawls ~420 provably-empty windows — roughly 55 minutes of
silent crawl before the first real deal. Operators repeatedly misread this as
"backfill broken" on the old host.

Two candidate fixes were considered:

- **B — auto per-account earliest-deal bound**: raise each account's lower
  bound to its first deal minus a guard band. Rejected: it is the same
  failure class as the 2026-07 history-recovery incident
  (`docs/incidents/2026-07-history-recovery.md`, silent date-fallback). A
  terminal whose server history has not synced returns a too-late first
  deal, the bound lands too high, and coverage is silently and permanently
  lost — checkpoints are forward-only, so nothing heals it.
- **D — empty-region window coalescing** (accepted): keep the `2025-01-01`
  bound and full coverage recording; widen windows while they come back
  empty and collapse once non-empty.

An interim mitigation shipped 2026-08-18: host-local per-account override
files (`bridge/accounts/<login>.json`) raise `history_lower_bound_raw` to
first-deal − 2 days, cutting the crawl to ~3 minutes. It is operator-set
state, not architecture — on a fresh journal the skipped prefix is proven
empty only by a manual terminal probe. This ADR replaces it.

## Decision

`HistoryPolicy` (`bridge/history.py`) gains `empty_window_raw` — the coarse
span applied while the region is provably empty. `_run_next_window` sizes
each window from the committed prior window's emptiness
(`repository.get_window(checkpoint.last_window_id)`, evaluated on the
post-clamp expected checkpoint):

- no prior window evidence (fresh journal, or checkpoint clamped to the
  lower bound) → coarse span; backfill starts in the known-empty 2025 region;
- prior window with zero deals and zero orders → coarse span;
- prior window with any deal or order, or a missing prior window (emptiness
  unknowable) → the fixed `maximum_window_raw` span.

`policy_version` stays `1`: coverage proof rests on contiguous half-open
`[start, end)` windows, never on window granularity, so persisted checkpoints
remain compatible and existing one-day journals widen on their next empty
window without reset. Window-size transitions replay overlap bytes that
dedupe by event id exactly as same-size overlaps already do
(`history_record_versions` reuse, outbox event skip).

Production wiring: `BRIDGE_HISTORY_EMPTY_WINDOW_RAW` (default `2592000` =
30 days; set equal to `BRIDGE_HISTORY_WINDOW_RAW` to disable widening). At
the dataclass level `empty_window_raw=None` (the default) keeps fixed-size
windows — widening is always explicit.

## Consequences

- A fresh journal crosses the 2025 empty prefix in ~14 windows (~2 minutes)
  instead of ~420 (~55 minutes), with every window still durably recorded —
  gap-free proof is preserved; only granularity in empty regions changes.
- Quiet forward-only periods (days without trades) also coarsen: one cheap
  empty 30-day read replaces a month of empty one-day windows. Active
  accounts collapse back to one-day windows on their first non-empty window.
- A coarse window that turns out non-empty is committed coarse — valid,
  since variable window size was always supported (`commit_window` requires
  only `start <= next_window_start_raw && end > start`).
- After this lands on forexvps, the interim per-account bound overrides must
  be removed or regenerated with the default bound so fresh journals
  exercise coalescing
  (`docs/superpowers/plans/2026-08-18-backfill-empty-region-coalescing.md`,
  "After D lands").
