# Backfill Empty-Region Window Coalescing (ADR-0006 candidate)

**Status:** IMPLEMENTED in repo 2026-08-26 (ADR-0006 `docs/decisions/0006-empty-region-window-coalescing.md`; `bridge/history.py` `_next_window_span` + `HistoryPolicy.empty_window_raw`; env `BRIDGE_HISTORY_EMPTY_WINDOW_RAW` default 2592000 wired in `bridge/worker.py`; unit + journal-integration tests added TDD-first, full bridge suite 404 passed / 4 Windows-only skips) · **Host follow-up DONE 2026-09-06:** the 5 interim `bridge/accounts/<login>.json` overrides were removed (rollback copy at `bridge/state/retired-overrides-20260906/`), the bridge restarted via its scheduled task (`schtasks /End` + `/Run /TN analytic-bridge` — NOT nssm; task-based topology since 8.72), all 5 loops restarted with zero quarantine, live TTLs republished, and the journal `.bak`s pruned · **Created:** 2026-08-18 · **Advisor:** architecture-reviewer session 2026-08-18 (evening)

## Problem

The history-backfill invariant mandates a 2025-01-01 lower bound with every window recorded (gap-free proof). Verified 2026-08-18 by direct terminal probe: **all 5 production accounts have zero 2025 deals** (first deals 2026-02-25 → 2026-04-23). At ~7 windows/min (1-day windows), every fresh journal crawls ~420 provably-empty windows ≈ **55 minutes of silent crawl** before the first real deal — repeatedly misread as "backfill broken" (operator experience on the old host).

## Interim mitigation applied (Option C — 2026-08-18, live)

Per-account override files `bridge/accounts/<login>.json` (host-local, NOT committed — they embed per-host terminal paths) raising `history_lower_bound_raw` to first-deal − 2 days:

| login | bound (UTC) |
|---|---|
| 7950622 | 2026-02-23 |
| 7953093 | 2026-02-25 |
| 7954220 | 2026-02-27 |
| 7948784 | 2026-03-02 |
| 7998410 | 2026-04-21 |

`recover_history_lower_bound` proved the skipped prefix empty and left `.history-lower-bound.*.bak` journal backups per account; deals began persisting ~3 min after restart. **Limitation:** on a FRESH journal the "proof" is only the operator's probe — that is why D below is the real fix.

## Decision (advisor verdict)

- **D — empty-region window coalescing** is the architecture: keep the 2025-01-01 bound and full coverage recording; widen windows (e.g. 30 days) while windows come back empty, collapse to 1-day once non-empty. Gap-free proof rests on *contiguous `[start,end)` windows*, not 1-day granularity. ~55 min → ~2 min, no coverage skipped.
- **B (auto per-account earliest-deal bound) REJECTED**: same failure class as the 2026-07 incident (silent date-fallback). A terminal whose server history hasn't synced returns a too-late first deal → bound too high → silent permanent loss; checkpoints are forward-only (`bridge/history.py:266-274`, `bridge/journal/repository.py:296-373`) so nothing heals it.
- New **ADR-0006** + wording edits in `docs/ARCHITECTURE.md` (§ window algorithm ~L241-244) and `CLAUDE.md` (History Backfill section): coverage proof = contiguous windows, not fixed 1-day granularity.

## Implementation map (from advisor; verified line refs as of 8.36)

1. `bridge/history.py` — `HistoryPolicy` gains an empty-region coarse size (e.g. `empty_window_raw`, default 2592000); `_run_next_window` (~L135-181) sizes the window from the prior window's emptiness (`repository.get_window(checkpoint.last_window_id)` when present); collapses to `maximum_window_raw` once non-empty. **Keep `policy_version=1`** (hardcoded at `bridge/worker.py:702`; mismatch vs persisted checkpoint ⇒ ValueError ⇒ permanent ABORT loop — `history.py:263-264`).
2. `bridge/worker.py` (~L699-702) — read new env `BRIDGE_HISTORY_EMPTY_WINDOW_RAW` into the policy.
3. `bridge/.env.example` (~L87-90) — document the var.
4. Variable window size, empty-window coverage rows, overlap dedupe (event-id reuse `repository.py:474-492`) already work end-to-end — do not reinvent. `commit_window` only requires `start <= checkpoint.next_window_start_raw && end > start` (`repository.py:596-599`); worker-v2 has no window-size assumptions (`src/worker-v2/history-consumer.ts:59-61`, header L6-11).
5. Tests: `bridge/tests/unit/test_history.py`, `bridge/tests/integration/test_history_journal.py` — adaptive sizing; size-transition overlap idempotency; checkpoint compatibility with `policy_version=1`.
6. Docs: ADR-0006, ARCHITECTURE.md §6, CLAUDE.md History Backfill bullet, `bridge/README.md` history section.
7. No worker-v2 / Prisma / dashboard changes. Domain: mt5-bridge-engineer implements; bridge-ingestion-review gate before push.

## After D lands

Remove the interim `bridge/accounts/<login>.json` overrides on the host (or regenerate them with the default 2025-01-01 bound) so fresh journals exercise coalescing instead of operator-set bounds. Update the auto-memory note `forexvps-backfill-empty-2025` accordingly.
