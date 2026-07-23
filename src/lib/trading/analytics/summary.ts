import type { BalanceRow } from "./deal-kernel";
import { dealNet, isTradingDeal } from "./deal-kernel";

export function summarizeTrades(deals: BalanceRow[]) {
  let trades = 0,
    wins = 0,
    netProfit = 0;
  for (const d of deals) {
    if (isTradingDeal(d)) {
      trades++;
      const net = dealNet(d);
      if (net > 0) wins++;
      netProfit += net;
    }
  }
  return {
    trades,
    winPercent: trades > 0 ? (wins / trades) * 100 : 0,
    netProfit,
  };
}
