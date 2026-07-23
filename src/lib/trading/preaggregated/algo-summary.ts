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
