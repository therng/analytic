# Ingestion review — Bug A: bridge_v2 history sync window bound

**Adds to, does not replace, the prior entries in this file** (Node-side
`epochSecondsToDate` fix, `b81f835`). This entry covers a separate,
independently-confirmed bug in `bridge_v2`'s history sync loop.

## What changed

- `bridge_v2/main.py`: `_history_loop` now computes `now_epoch` as broker-local
  (`true_utc_now + broker_utc_offset_minutes * 60`), not true UTC. New required
  CLI arg `--broker-utc-offset-minutes` (fails loud if omitted — no default).
- `bridge_v2/run_all_v2.py`: new `--broker-offset LOGIN=MINUTES` (repeatable),
  threaded through `_spawn()` to each child. `run()` refuses to supervise
  (logs an error, does not spawn) any login missing from `--broker-offset`
  rather than guessing.
- `history_publisher.py` is **unchanged** — its logic was already correct
  once fed a `now_epoch` in the right clock space; the bug was entirely in
  what `main.py` passed it.
- Docs corrected: `bridge_v2/README.md` "Time handling", `serializers.py`
  module docstring, `scripts/set-broker-utc-offset.ts` header comment — all
  previously asserted "MT5 epochs are already UTC, no offset applied", which
  is the same false claim `b81f835` corrected on the Node side.

## Evidence

**Root cause.** MT5's `positions_get()` (live) and `history_deals_get()`
(history) share one clock base — the broker trade server's own wall clock,
confirmed by the discriminator test in `b81f835`'s review entry (identical
raw epoch from both APIs for the same ticket). `bridge_v2/main.py`'s history
loop computed its query window's upper bound from `datetime.now(timezone.utc)`
— true UTC — then handed it straight to `history_deals_get()`, which compares
it against broker-local `deal.time`. Every query's effective bound was
therefore always `brokerUtcOffsetMinutes` short of real broker "now".

**Confirmed, not inferred — with a non-tautological test.** An initial check
("cursor tracks wall-clock 1:1") was correctly challenged as circular: `window_end`
is *defined* as `now_epoch - grace`, so of course it tracks true time,
regardless of whether MT5 actually returned matching data. The valid test:
10 most-recently-ingested deals for account 7954220, each imported within
seconds of being ingested (real-time), each showing a **`182 ± 0.5` minute**
lag between `imported_at` and the deal's own (corrected) true-UTC `time` —
tight and consistent, matching `brokerUtcOffsetMinutes` (180) plus fixed
overhead (grace + poll interval), not the wide scatter a generic latency
issue would produce. Every account was structurally frozen ~3 hours behind
real broker activity, permanently, until fixed.

**Note:** this is a separate bug from the specific 14:01→21:20 halt on
account 7948784 investigated the same session (MT8 terminal crash / failover
sequence) — that halt's root cause was not conclusively identified; it
resolved after an incidental worker-v2 restart. Bug A explains the *chronic*
~3h lag; it does not explain that one-off multi-hour halt.

## Design decision (confirmed with user)

Offset source: **CLI arg, per-login** (`--broker-offset LOGIN=MINUTES`), not
a single global env var (breaks the day a different-broker account is added)
and not a live Redis/DB lookup (keeps `bridge_v2` DB-free by design, per its
existing docstring). Verified before implementing: all 5 current accounts
share the same broker (`ICMarketsSC-MT5-2`) and offset (180) — SELECT against
`Account` confirmed this — so a per-login CLI list is a safe, minimal change
today and correct if that ever changes.

## Deployment status

**Code only, not deployed to the VPS.** Per explicit user decision, this
commit ships the fix to git but does NOT edit the live
`bridge_v2/service_wrapper.ps1` or restart the `MT5BridgeV2` nssm service.
Deploying requires adding `--broker-offset 7948784=180 7950622=180
7953093=180 7954220=180 7998410=180` to that script and restarting the
service — this briefly interrupts live ingestion for all 5 accounts and was
deliberately deferred to a separate, explicit action.

**Once deployed:** the next poll after restart will compute a correct
broker-local `now_epoch`. Since `window_start` (the cursor) already lives in
broker-local space (inherited from prior `window_end` values) and
`HISTORY_WINDOW_DAYS` (30) comfortably covers the ~3h gap, the very next
sync call self-heals in one chunk — no separate backfill/reset needed for
this bug specifically. (The historical Deal/Order/Position mixed-epoch-
convention seam from `b81f835` is a separate, still-open item.)

## Validation checklist

- [x] `python3 -m pytest -q bridge_v2/tests` → 92 passed, 1 skipped (7 new
      tests: `_parse_broker_offsets` parsing/error cases, `_spawn` includes
      the offset in the child's argv via a mocked `subprocess.Popen` — no
      real process launched — and `main.py`'s CLI now hard-requires
      `--broker-utc-offset-minutes`).
- [x] `python3 -m py_compile` on all touched files — clean.
- [x] No secret/credential/.env file in diff.
- [x] `history_publisher.py`'s own logic untouched — single-point fix at the
      one place true-UTC leaked in, matching "smallest correct fix."
- [ ] Live VPS deployment — explicitly deferred, not part of this commit.

**Verdict: pass for the code fix. VPS deployment is a separate, pending action.**

bridge-ingestion review: pass
