"use client";

import { getBangkokDateKey } from "@/lib/time";
import type {
  BalanceEventPoint,
  ChartPoint,
  Timeframe,
} from "@/lib/trading/types";
import { SparklineChart } from "@/components/trading-monitor/MonitorShared";

interface BalancePanelProps {
  accountId: string;
  points: Array<ChartPoint | BalanceEventPoint>;
  active: boolean;
  timeframe: Timeframe;
  liveTimestamp?: Date | string | null;
  liveBalance?: number | null;
  equityPoints?: Array<ChartPoint | BalanceEventPoint>;
  liveEquityValue?: number | null;
  showLiveBeacon?: boolean;
  onHighlightBalanceChange: (value: number | null) => void;
}

export function BalancePanel({
  accountId,
  points,
  active,
  timeframe,
  liveTimestamp,
  liveBalance,
  equityPoints,
  liveEquityValue,
  showLiveBeacon = false,
  onHighlightBalanceChange,
}: BalancePanelProps) {
  const dateKey = timeframe === "1d" ? getBangkokDateKey(new Date()) : null;

  return (
    <div className="sp-canvas">
      <div className="sp-canvas__chart">
        <SparklineChart
          points={points}
          active={active}
          tone="neutral"
          onHighlightBalanceChange={onHighlightBalanceChange}
          timeframe={timeframe}
          liveTimestamp={liveTimestamp}
          liveBalance={liveBalance}
          equityPoints={timeframe === "1d" ? equityPoints : undefined}
          liveEquityValue={timeframe === "1d" ? liveEquityValue : undefined}
          showLiveBeacon={timeframe === "1d" && showLiveBeacon}
          showAxisLabels
          yAxisGridStep={50}
          reactionTarget={
            dateKey ? { accountId, date: dateKey } : undefined
          }
        />
      </div>
    </div>
  );
}
