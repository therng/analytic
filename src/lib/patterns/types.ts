export type CandleData = {
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TrendDirection = "up" | "down";

export type PatternStage = "trend" | "formation" | "pause" | "outcome" | "fade";

export type CandlestickPattern = {
  id: string;
  name: string; // Internal name, not displayed
  type: "bullish" | "bearish";
  trend: TrendDirection;
  formation: CandleData[];
  outcome: {
    startPrice: number;
    endPrice: number;
  };
};
