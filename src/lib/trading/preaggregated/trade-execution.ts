import type { DealRow } from "../preaggregated-cache";

export function getDealBalancePointValue(deal: DealRow) {
  const value = Number(deal.balanceAfter ?? deal.balance ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}
