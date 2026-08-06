# Incident: 2026-07 missing history — fallback-date and broker-offset gaps

## Impact

Accounts could silently sync only a rolling 30-day (or later, incorrect
broker-local) window of history instead of the required full backfill from
`2025-01-01`, and history windows filtered against broker-local deal time
using a UTC "now" bound could permanently exclude the most recent
`brokerUtcOffsetMinutes` of history on every poll. Both failure modes are
silent — no error, just quietly incomplete data — which is what makes them
an incident rather than a normal bug: dashboard analytics computed over
`Position`/`Deal` would be wrong without any visible symptom.

## Detection

Surfaced across a series of fixes between 2026-07-10 and 2026-08-01 as the
durable-checkpoint backfill design (`8f7e931`) was built out and its edge
cases (empty pre-2025 checkpoints, broker-local window math) were found and
closed one at a time.

## Root Cause

Two distinct root causes, both eventually codified as hard rules in
CLAUDE.md:

1. **Fallback-date logic.** `15d3a3a` (2026-07-10) originally defaulted to a
   30-day window when the history cursor was unavailable in Redis, to avoid
   MT5 rejecting a Unix-epoch (1970-01-01) argument with "Invalid arguments."
   This traded a crash for silent data loss — a missing cursor should mean
   "backfill everything from `2025-01-01`," not "assume the last 30 days is
   enough."
2. **Broker-offset time math.** `db53d77` (2026-07-30): `now_epoch` was true
   UTC while `history_deals_get()` filters against broker-local `deal.time`,
   so the window bound permanently excluded the most recent
   `brokerUtcOffsetMinutes` of history on every poll. Compounding this,
   `41904f4` (2026-07-30) initially fixed only live position timestamps and
   left the history path untouched, requiring a follow-up (`b81f835`,
   2026-07-30) to apply the same broker-UTC-offset correction to Deal/Order/
   Position as well — not just `OpenPosition`.

A related durability gap: a checkpoint that was empty and predated
`2025-01-01` needed to be distinguished from a checkpoint that had genuinely
completed a pre-2025 window, or recovery logic could wrongly treat "never
started" as "already covered." `bab5e1a` (2026-08-01) added an explicit
`isEmptyPre2025Checkpoint` guard for this.

## Resolution

- `8f7e931` (2026-07-13) — introduced durable, checkpoint-driven automatic
  full-history backfill (PostgreSQL-authoritative completion) and the
  `TradingAccount.brokerUtcOffsetMinutes` field itself
  (`scripts/set-broker-utc-offset.ts`); accounts without it configured fail
  loud instead of guessing an offset.
- `db53d77` / `41904f4` / `b81f835` (2026-07-30) — corrected broker-local
  time math for the history sync window bound, then extended the fix from
  live positions to Deal/Order/Position.
- `bab5e1a` (2026-08-01) — "guard native history lower bound recovery,"
  added the `isEmptyPre2025Checkpoint`/`isEmptyPre2025Window` guards.
- `2216fa9` (2026-08-01) — "enforce history lower bound and live TTL,"
  closing the loop across `bridge/history.py`, `bridge/journal/repository.py`,
  `bridge/redis_transport.py`, `bridge/worker.py`.

## Prevention

CLAUDE.md, "History Backfill and Durability" section, now states explicitly:

- "Missing history cursor plus no completed durable checkpoint means account
  requires automatic retained-history backfill from `2025-01-01`; never fall
  back silently to `now - 30 days`."
- "Missing cursor after durable completion must be reconstructed safely from
  PostgreSQL or fail loudly; never reintroduce 30-day fallback."
- "Empty windows must be recorded as completed so historical coverage can be
  proven gap-free" — directly addressing the empty-pre-2025-checkpoint
  ambiguity that caused the `bab5e1a` guard.

## Evidence

- `15d3a3a` (2026-07-10) — "fix: use reasonable default date range for
  history sync when cursor unavailable" — the 30-day-fallback commit that
  CLAUDE.md later explicitly bans.
- `8f7e931` (2026-07-13) — "v7.74: automatic MT5 history backfill, broker UTC
  offset, balanceAfter fix."
- `db53d77` (2026-07-30) — "fix(bridge_v2): compute history sync window
  bound in broker-local time."
- `41904f4` (2026-07-30) — "fix(worker-v2): correct broker-local live
  position timestamps, leave history path untouched."
- `b81f835` (2026-07-30) — "fix(worker-v2): correct 41904f4 -- apply broker
  UTC offset to Deal/Order/Position too, not just OpenPosition."
- `bab5e1a` (2026-08-01) — "fix: guard native history lower bound recovery"
  (bridge ingestion review: pass).
- `2216fa9` (2026-08-01) — "fix: enforce history lower bound and live TTL."
- CLAUDE.md, "History Backfill and Durability" section (current).
