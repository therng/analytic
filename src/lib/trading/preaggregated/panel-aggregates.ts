// Server-side aggregates for the dashboard's heavy panels. These replace
// MB-scale raw-position downloads that panels previously paginated through
// and re-aggregated client-side on every mount:
//   - Bot P/L chart  → summary.botPerformance (a few hundred bytes)
//   - P/L heatmap    → summary.dailyPnl (one row per trading day)
// Both run over the ENRICHED historyPositions of a view build (comment
// enrichment feeds getBotLabel grouping), so they are computed inside
// buildTimeframeView — once per cached view, not per client mount.
import { getBangkokDateKey } from "@/lib/time";
import { getBotLabel } from "@/lib/trading/bots";
import type { PositionsResponse } from "@/lib/trading/types";

type HistoryPosition = NonNullable<PositionsResponse["historyPositions"]>[number];

export interface BotPerformanceStat {
  /** getBotLabel bucket — same grouping the client chart used. */
  label: string;
  count: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  wins: number;
  losses: number;
}

export interface DailyPnlBucket {
  /** Bangkok-day key "YYYY-MM-DD" — the heatmap grid's cell index. */
  dateKey: string;
  pnl: number;
  count: number;
}

function historyNetPnl(position: HistoryPosition) {
  // Same formula the client chart used: profit + swap + commission.
  return (
    position.profit + (position.swap ?? 0) + (position.commission ?? 0)
  );
}

export function buildBotPerformance(
  positions: Array<HistoryPosition>,
): BotPerformanceStat[] {
  const map = new Map<string, BotPerformanceStat>();
  for (const position of positions) {
    const label = getBotLabel(position.comment);
    const net = historyNetPnl(position);

    let stat = map.get(label);
    if (!stat) {
      stat = {
        label,
        count: 0,
        grossProfit: 0,
        grossLoss: 0,
        netPnl: 0,
        wins: 0,
        losses: 0,
      };
      map.set(label, stat);
    }

    if (net >= 0) {
      stat.grossProfit += net;
      stat.wins += 1;
    } else {
      stat.grossLoss += net;
      stat.losses += 1;
    }
    stat.netPnl += net;
    stat.count += 1;
  }

  return Array.from(map.values()).sort((a, b) => b.netPnl - a.netPnl);
}

export function buildDailyPnl(
  positions: Array<HistoryPosition>,
): DailyPnlBucket[] {
  const map = new Map<string, DailyPnlBucket>();
  for (const position of positions) {
    if (!position.closedAt) continue;
    const dateKey = getBangkokDateKey(position.closedAt);
    if (!dateKey) continue;
    const net = historyNetPnl(position);
    const existing = map.get(dateKey);
    if (existing) {
      existing.pnl += net;
      existing.count += 1;
    } else {
      map.set(dateKey, { dateKey, pnl: net, count: 1 });
    }
  }
  return Array.from(map.values());
}
