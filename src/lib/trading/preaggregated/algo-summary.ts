import {
  computeAlgoTradingByComment,
  computeAlgoTradingPercent,
} from "@/lib/trading/analytics";
import type { PositionRow } from "../preaggregated-cache";

export function buildAlgoTradingSummary(rows: PositionRow[]) {
  return {
    algoTradingPercent: computeAlgoTradingPercent(rows),
    algoTradingByComment: computeAlgoTradingByComment(rows),
  };
}

/**
 * INTERIM historical deposit-load KPI.
 *
 * The product deposit-load metric is XAUUSD-volume-derived (see
 * `analytics/xauusd-margin.ts`, wired into the live `account.deposit_load_pct`).
 * The historical peak cannot use it yet: recomputing volume-based load at a past
 * timestamp needs exact open lots at that instant, and nothing persisted today
 * provides it — `Position.volume` is *cumulative opened* volume over the
 * position's life (see `worker-v2/position-reconstructor.ts`, `totalOpenedVolume`),
 * so a sweep over open/close spans overstates any scaled position, and
 * `PositionExcursion` carries profit only, no volume. A correct series would
 * require walking `Deal` rows to emit intermediate open-volume states — a new
 * reconstruction, deliberately not built here.
 *
 * Until that backfill exists, the peak stays on the broker-margin-derived
 * `EquitySnapshot.depositLoad` column written by `worker-v2/equity-sampler.ts`.
 * Scoped timeframes (1D/1W/...) are bounded by EquitySnapshot's 7-day row
 * retention; the "all" timeframe instead reads the persisted running
 * high-water mark (`maxAllTimeDepositLoad` below), which survives row pruning
 * as long as sampling never had a gap longer than the retention window.
 */
export function maxPersistedDepositLoad(
  rows: Array<{ depositLoad: number | null }>,
) {
  return rows.reduce<number | null>(
    (max, row) =>
      row.depositLoad == null
        ? max
        : max == null
          ? row.depositLoad
          : Math.max(max, row.depositLoad),
    null,
  );
}

/**
 * All-time peak, for the "all" timeframe only. `EquitySnapshot.maxDepositLoad`
 * is a running high-water mark carried forward onto every new row (see
 * `worker-v2/equity-sampler.ts`), so it survives the 7-day row-retention
 * prune as long as sampling has no gap longer than the retention window —
 * a sampling gap that long starts a fresh high-water run instead of true
 * all-time. Do not use this for scoped timeframes (1D/1W/...): the column
 * isn't reset by `since`, so every scoped view would show the same
 * all-time number. Use `maxPersistedDepositLoad` there instead.
 */
export function maxAllTimeDepositLoad(
  rows: Array<{ maxDepositLoad: number | null }>,
) {
  return rows.reduce<number | null>(
    (max, row) =>
      row.maxDepositLoad == null
        ? max
        : max == null
          ? row.maxDepositLoad
          : Math.max(max, row.maxDepositLoad),
    null,
  );
}
