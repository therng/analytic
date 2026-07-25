# Package 4 — Bridge V2 Acknowledged Replay

**Status:** Planning only, no code changed by this document. Implements Package 4 from `docs/superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md` ("gated: user approval required" — approval given 2026-07-26 to proceed with implementation on a branch; production/VPS rollout remains separately gated under Package 5).

**Scope discipline:** Package 4 only. Package 5 (gated production rollout) stays untouched. No production data touched — implemented and tested against local/isolated stacks only. Durable mode defaults **off** — existing publish-on-success cursor behavior (Package 3b, already merged) is the fallback path and must keep working unchanged when the toggle is off.

## 1. What's missing today (gap found during research)

Package 3b's `persistHistoryBarrier` (worker-v2 consumer side) advances `BridgeHistoryCheckpoint` in PostgreSQL but **never writes anything back to Redis**. There is no `mirrorHistoryCheckpoint`-equivalent in `src/worker-v2/history-checkpoint.ts` (unlike the legacy `src/worker/history-checkpoint.ts:641`, which writes `mt5:bridge:history-ack:{accountNo}` after every checkpoint advance). Package 4 requires the bridge to read a validated ACK signal — that signal doesn't exist yet on the worker-v2 side. **This package must build the mirror writer as part of itself**, not assume it already exists.

## 2. Design

### 2a. Redis keys (worker-v2 namespace, isolated from legacy's `mt5:bridge:*`)

- `mt5:v2:history:{login}:ack` — written by the consumer after every successful checkpoint advance. Payload: `{version: 1, phase, completedThroughServerTime, dealsCursor, ordersCursor, lastCompletedChunkId, backfillCompletedAt}` (mirrors `DurableCheckpoint`).
- Bridge continues owning `mt5:v2:history:{login}:cursor` (existing key) as its own publish-progress cursor — durable mode does not remove this key, it changes what the bridge *reads before deciding to publish the next window*.

### 2b. Durable mode toggle

- `V2_HISTORY_DURABLE_MODE` env var (bridge-side), default unset/off — same convention as `WORKER_V2_ENABLE_LIVE_SYNC` (`isLiveSyncEnabled` pattern in `index.ts:25-26`). Off means today's exact behavior: publish, then advance the bridge's own cursor unconditionally on success (Package 3b, unchanged).

### 2c. On, behavior change in `sync_history_once`

- Before computing the next window, read `mt5:v2:history:{login}:ack`. If absent (durable mode just turned on, no chunk ever acknowledged), treat as "start from configured history start" — same as today's missing-cursor fallback, never a silent now-30d fallback (CLAUDE.md invariant carried forward).
- The bridge's *publish* cursor (`mt5:v2:history:{login}:cursor`) is allowed to run ahead of the ack (that's the existing Package 3b behavior — cursor advances on publish success, consumer checkpoint catches up asynchronously). Durable mode's actual change: **the bridge will not begin a *new* window until the ack mirror confirms the *previous* window it published is durably checkpointed.** This directly implements "publish one verified window, then wait for durable ACK before planning next."
- Concretely: `sync_history_once` in durable mode reads the ack's `completedThroughServerTime`. If it is behind the bridge's own last-published `window_end` by more than one window, the bridge does not publish a new window this cycle — it logs/returns an `{idle: True, waiting_for_ack: True}`-style status and the caller (the sync loop) retries next interval. This bounds how far ahead of the consumer the bridge can get to exactly one in-flight window, rather than today's unbounded pileup (documented as an accepted gap in the Package 3b plan doc, §1c).
- Empty windows still publish zero-count barriers (unchanged from Package 3b — already true today, no new work needed here).

### 2d. Frozen watermark

- "Freeze per-account target watermark at rollout start" is a Package 5 (rollout) concern operationally, but Package 4 must expose the *mechanism*: a per-account frozen watermark value stored wherever Package 5's rollout tooling can read it (a new Redis key `mt5:v2:history:{login}:watermark`, written once by an operator/rollout script — not by the bridge's normal loop). Package 4's job is only to make `sync_history_once` accept an optional watermark parameter and stop publishing once `completed_through >= watermark` when one is set — the actual "how rollout freezes it" is Package 5's runbook, out of this package's scope.

## 3. Design resolved (advisor-reviewed 2026-07-26)

**Q1 — cursor re-derivation:** §2c above was wrong. Durable mode must not trust `mt5:v2:history:{login}:cursor` as the window start at all — that's the exact thing the spec says to ignore, and it's the whole reason Package 4 exists (Redis cursor can survive a flush ahead of what PostgreSQL actually committed). Correct rule: in durable mode, `cursor = int(ack["completedThroughServerTime"])` if the ack key exists, else `cursor = start_epoch`. The existing `mt5:v2:history:{login}:cursor` key is still written for compatibility/observability but never read when durable mode is on.

**Q2 — serial retry, and the tail-window churn problem:** Deriving the window start from the ack makes "wait for ack before planning next" automatic — republishing before the ack lands recomputes the same `chunkId` (both `window_start`/`window_end` unchanged) and the consumer's existing replay-idempotency no-ops it. **But** `window_end = min(cursor + window_days, now)` still floats with live `now` on every retry whenever the window is clamped (the "tail" case) — and once an account reaches `phase=incremental`, *every* window is a tail window (completedThrough is always near-present). That turns "rare harmless orphaned chunk" (Package 3b's framing, correct for backfill) into a *new orphaned chunk every sync interval* in the far more common incremental steady state, for as long as the consumer lags the bridge.

Resolution: **persist the candidate window itself**, not just the cursor. New key `mt5:v2:history:{login}:pending-window` = `{start, end}`, written right after publish. Next call (durable mode only): if a pending window exists and the ack hasn't caught up to its `end` yet, republish that *exact* `{start, end}` verbatim (never recompute `window_end` from live `now` while a window is outstanding). Once the ack's `completedThroughServerTime` reaches the pending window's `end`, clear the key and compute a fresh window next cycle. This is the standard reserve-then-confirm pattern; it removes the "how much slack is allowed" question entirely rather than tuning it.

**Q3 — mirror-writer placement:** Post-commit, best-effort, called by the consumers (not from inside `persistHistoryBarrier`, which takes `DbLike` and has no Redis handle — adding one would break every existing fake-db test). `persistHistoryBarrier` already returns `DurableCheckpoint | null`; consumers write the mirror only when it's non-null. Mirror-write failure is "log and continue" — PostgreSQL stays authoritative, the next successful barrier rewrites the mirror. Requires threading a Redis client into `makeDealHandler`/`makeOrderHandler` as an **optional** parameter (existing tests that don't care can omit it) and wiring it in `index.ts` from the already-connected `dealsRedis`/`ordersRedis`.

**Two correctness risks flagged, both cheap to close:**
- **Ack key must be keyed by `login`, consumer writes by `accountId`.** The identity `accountNo == login` (string) is what `resolveAccountByLogin` already relies on (`account-registry.ts:11`, `registry.set(row.accountNo, ...)` looked up by `String(login)`). Mirror writer must key `mt5:v2:history:{accountNo}:ack` (accountNo, not accountId) so the bridge (which only knows `login`) reads the same key. If this identity ever breaks for one account, the bridge silently treats it as "never acked" and durable mode **re-publishes full history from `V2_HISTORY_START` every cycle** — the worst failure mode here, and it's invisible without an explicit log line the first time a bridge cycle finds no ack key at all for an account it has previously published for.
- **Stale ack on account recreation.** `onDelete: Cascade` wipes the checkpoint when a `TradingAccount` row is recreated (same `accountNo`, new id) — the old ack key would then reference history that no longer exists in PostgreSQL. Fix: the consumer deletes the ack key at the exact point `ensureHistoryCheckpoint` takes its *create* branch (a freshly created checkpoint means any existing ack is stale by definition — one line, in the function that already knows).

**Deployment ordering (for Package 5's runbook, not this package's code):** the mirror-writing consumer must run and populate every account's ack key *before* durable mode is ever turned on for that account — otherwise the first durable cycle reads no ack and restarts from `V2_HISTORY_START`.

## 4. Implementation sequencing

1. **Mirror writer + consumer wiring** (additive, off-path, independently revertable): `history-checkpoint.ts` gets a `mirrorHistoryCheckpoint`-equivalent; `deal-consumer.ts`/`order-consumer.ts` call it post-barrier with an optional Redis client; `index.ts` wires the client through. Own commit.
2. **Bridge-side durable read**: `V2_HISTORY_DURABLE_MODE` toggle, ack-derived cursor, pending-window persistence in `history_publisher.py`. Own commit.
3. **Watermark** (small — a parameter and a comparison, per §2d): own commit, last.
