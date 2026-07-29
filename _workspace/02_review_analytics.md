# Analytics review — deposit load: filled XAUUSD order volume, not open position volume

## Change reviewed

`src/lib/trading/analytics/xauusd-margin.ts`, `account-data.ts`,
`metric-registry.ts`, `types.ts` (commit `db53d77`).

`deposit_load_pct` / `deposit_load_margin_used` / `xauusd_filled_lots` now
derive from `Order` rows with `state: "filled"` and symbol matching XAUUSD,
divided against `AccountSnapshot.balance` (was: open `OpenPosition` XAUUSD
volume, gross/net legs, divided against equity).

## Source mapping

- New authoritative source: `Order.state = "filled"` — a real, queried
  column (`account-data.ts` fetchAccountListItems now selects
  `orders: { where: { state: "filled" }, select: { symbol, state, volume } }`).
  Explicitly documented in `metric-registry.ts`
  (`source: "Order.state=filled + AccountSnapshot/Redis balance"`), not
  silently mixed with `OpenPosition`/equity.
- `margin`/`margin_level` (broker-raw, from `AccountSnapshot`) untouched —
  no mixing between the estimated deposit-load metric and the broker-reported
  margin surfaces.
- Divisor changed equity → balance. Deliberate: deposit load is meant to read
  as committed capital exposure, not exposure diluted by floating P/L; both
  are legitimate `AccountSnapshot` fields, no cross-account-type leak.

## Timeframe / segmentation

Not timeframe-scoped by design (current-state metric, like margin/margin
level) — correctly excluded from `getSinceDate`/timeframe filtering; no
deposit-op segmentation applicable since it doesn't touch balance-curve
growth logic.

## Formula / precision

`xauusdLots * XAUUSD_MARGIN_PER_LOT (410.3)` unchanged constant. Rounds only
at presentation (`computeDepositLoadPercent`), backend keeps
`marginUsedUsd`/`xauusdLots` full precision. `depositLoadPct` returns `null`
(not `0`) when no order has filled yet — correct zero-as-empty pattern per
`kpiValue` convention.

## Tests

`xauusd-margin.test.ts` and `account-data.test.ts` cover: multiple filled
XAUUSD legs summed, non-XAUUSD orders excluded, `placed` (unfilled) orders
excluded even at large volume, case-insensitive `state` match, empty/no-fill
→ `null` pct with `0` lots/margin. Boundary cases present; no live-vs-history
divergence risk since this is a live-state-only metric.

**Verdict: pass.**

analytics review: pass
