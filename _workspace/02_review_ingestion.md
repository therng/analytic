# Ingestion review — broker UTC offset correction (Deal/Order/Position/OpenPosition)

**Supersedes the verdict in commit `41904f4`.** That commit's claim — "history
path (`Deal`/`Order`/`Position`) already reports true UTC, only the live
`positions_get()` path needs the offset correction" — is **wrong**. Corrected
below with the evidence that disproves it.

## What changed (this revision)

`epochSecondsToDate` (`src/lib/time.ts`) now subtracts
`offsetMinutes * 60 * 1000` unconditionally, for **every** call site: `Deal`,
`Order`, `Position` (via `position-reconstructor.ts` deriving from
`Deal.time`), and `OpenPosition`. The short-lived `liveEpochSecondsToDate`
split introduced in `41904f4` is removed — there was never a real split.

## Why the previous verdict was wrong

**The discriminator test (decisive):** same MT5 ticket, same script, same
instant, both APIs:

```
positions_get raw:              1785363660 -> 2026-07-29T22:21:00Z
history_deals_get raw (entry=0): 1785363660 -> 2026-07-29T22:21:00Z
```

Identical raw epoch from `positions_get()` and `history_deals_get()` for the
opening deal/position of the same ticket. One clock base for both MT5 APIs —
not two. Since `positions_get()` is proven broker-local (matches the
account's configured `brokerUtcOffsetMinutes` to the second across 10 live
rows), `history_deals_get()` — and therefore `Deal`/`Order`/`Position` — is
broker-local too.

**Why the previous check missed it:** the prior "verification" compared
`Deal.time` against its own `imported_at` and found a ~73s lag, called it
proof of correct UTC. That check was circular: `BridgeHistoryCheckpoint`'s
cursor (`deals_cursor_time`, `completed_through_server_time`) advances in the
*same mislabeled epoch space* as `Deal.time` itself — a deal sitting at
broker-local numeric value `14:01:29` gets published and imported the moment
the cursor reaches that number, so a small `imported_at` skew is
structurally guaranteed whether or not the offset is actually being applied.
It measured ingestion latency, not clock alignment.

**Corroborating, previously dismissed as inconclusive:** two Friday-close
XAUUSD sessions land at `2026-07-18 00:03:29` and `2026-06-27 00:05:53` —
Saturday, naively read. At UTC+3 these are `21:03:29` / `21:05:53` Friday —
standard forex/gold weekend close. Real signal, not noise.

## Root cause, precisely

MT5's `positions_get()` (live) and `history_deals_get()`/`history_orders_get()`
(history) both report the broker trade server's own wall clock, encoded as
epoch seconds — never true UTC unless the broker server itself runs UTC
(this broker, `ICMarketsSC-MT5-2`, runs UTC+3 DST / UTC+2 standard). There is
no live/history split in MT5's time semantics. `epochSecondsToDate` must
subtract `brokerUtcOffsetMinutes` for every call site, with no exception.

## Consequence: historical data

Every `Deal.time`, `Order.timeSetup`/`timeDone`, `Position.openTime`/
`closeTime`, and (until `41904f4`) `OpenPosition.openTime` row ingested
since this app went live is stored `brokerUtcOffsetMinutes` minutes ahead of
true UTC. This is **not cosmetic** — it feeds Trade History timestamps,
balance-curve bucketing, 1D/1W/1M timeframe filtering (`getSinceDate` /
`startOfBangkokDay` in `src/lib/trading/analytics/timeframe.ts`), and every
Bangkok-day grouping in the UI.

**Not remediated in this commit.** A blanket historical UPDATE using the
account's *current* `brokerUtcOffsetMinutes` (180, DST) would itself be
wrong for any row that predates the broker's DST transition (should be 120
for that period) — see `[[project_broker_offset_dst_debt]]`-class risk,
already flagged as tech debt before this investigation. Correcting historical
rows requires knowing the broker's actual UTC offset *at each row's
timestamp*, not just the current one. This needs an explicit decision with
the user before any data migration or re-ingestion — re-ingesting through
this fixed code with a single static offset does not solve the DST-boundary
case either.

## Validation checklist

- [x] Tests updated to assert the corrected value:
      `src/lib/time.test.ts`, `src/lib/redis-mt5.time.test.ts`,
      `src/worker-v2/mappers.test.ts`.
- [x] Full suite: `node --import tsx --test src/worker-v2/*.test.ts
      src/lib/time.test.ts src/lib/trading/*.test.ts` → 251 pass / 1
      pre-existing skip / 0 fail.
- [x] `npx tsc --noEmit` clean.
- [x] `npm run lint` clean (same pre-existing unrelated warning as before,
      not touched by this change).
- [x] `npm run build` clean.
- [x] No secret/credential/.env file in diff.
- [ ] Historical data remediation — **not done, needs explicit user decision**
      on DST-boundary handling before any migration or re-ingestion.

**Verdict: pass for the code fix. Data remediation is a separate, open decision.**

bridge-ingestion review: pass
