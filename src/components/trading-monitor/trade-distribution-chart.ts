import type {
  LinearRegressionSummary,
  TradeDistributionDetail,
} from "@/lib/trading/types";

export type TradeDistributionMode = "mfe-profit" | "mae-profit" | "profit-time";

export type DistributionDatum = {
  x: number;
  y: number;
  pointIndex: number;
};

export type TradeDistributionSeriesEntry = {
  name: string;
  type: "scatter" | "line";
  data: Array<{ x: number; y: number }>;
};

export type TradeDistributionSeries = {
  hasData: boolean;
  data: DistributionDatum[];
  series: TradeDistributionSeriesEntry[];
  regression: LinearRegressionSummary | null;
};

export type TradeDistributionDomains = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function getModeX(
  mode: TradeDistributionMode,
  point: { mfe: number | null; mae: number | null; holdingSeconds: number | null },
): number | null {
  switch (mode) {
    case "mfe-profit":
      return point.mfe;
    case "mae-profit":
      return point.mae;
    case "profit-time":
      return point.holdingSeconds;
  }
}

function getModeRegression(
  mode: TradeDistributionMode,
  regressions: {
    mfeProfit: LinearRegressionSummary | null;
    maeProfit: LinearRegressionSummary | null;
    holdingProfit: LinearRegressionSummary | null;
  },
): LinearRegressionSummary | null {
  switch (mode) {
    case "mfe-profit":
      return regressions.mfeProfit;
    case "mae-profit":
      return regressions.maeProfit;
    case "profit-time":
      return regressions.holdingProfit;
  }
}

/**
 * Converts a regression summary into its two endpoint coordinates.
 */
export function regressionLine(
  regression: LinearRegressionSummary | null,
): Array<{ x: number; y: number }> {
  if (!regression) return [];

  return [
    {
      x: regression.minX,
      y: regression.slope * regression.minX + regression.intercept,
    },
    {
      x: regression.maxX,
      y: regression.slope * regression.maxX + regression.intercept,
    },
  ];
}

/**
 * Builds the y = x reference line, clipped to the shared visible x-domain.
 */
export function idealCaptureLine(
  minX: number,
  maxX: number,
): Array<{ x: number; y: number }> {
  return [
    { x: minX, y: minX },
    { x: maxX, y: maxX },
  ];
}

/**
 * Computes the x/y domain bounds for a set of plotted points.
 */
export function buildTradeDistributionDomains(
  mode: TradeDistributionMode,
  points: Array<{ x: number; y: number }>,
): TradeDistributionDomains {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/**
 * Builds win/loss scatter series plus regression and (MFE-only) ideal-45-degree
 * reference line for the given mode. `pointIndex` on each datum indexes back into
 * `detail.points` for tooltip lookups.
 */
export function buildTradeDistributionSeries(
  mode: TradeDistributionMode,
  detail: TradeDistributionDetail,
): TradeDistributionSeries {
  if (!detail.available) {
    return { hasData: false, data: [], series: [], regression: null };
  }

  const data: DistributionDatum[] = detail.points.flatMap((point, pointIndex) => {
    const x = getModeX(mode, point);
    if (x == null || !Number.isFinite(x)) return [];
    return [{ x, y: point.netPnl, pointIndex }];
  });

  const wins = data.filter((datum) => datum.y > 0);
  const losses = data.filter((datum) => datum.y <= 0);
  const regression = getModeRegression(mode, detail.regressions);

  const series: TradeDistributionSeriesEntry[] = [
    {
      name: "Profit",
      type: "scatter",
      data: wins.map(({ x, y }) => ({ x, y })),
    },
    {
      name: "Loss",
      type: "scatter",
      data: losses.map(({ x, y }) => ({ x, y })),
    },
    {
      name: "Regression",
      type: "line",
      data: regressionLine(regression),
    },
  ];

  if (mode === "mfe-profit" && data.length > 0) {
    const domain = buildTradeDistributionDomains(
      mode,
      data.map(({ x, y }) => ({ x, y })),
    );
    series.push({
      name: "Ideal 45°",
      type: "line",
      data: idealCaptureLine(domain.minX, domain.maxX),
    });
  }

  return { hasData: data.length > 0, data, series, regression };
}

/**
 * Formats a holding duration in seconds, adapting the unit to the magnitude.
 */
export function formatHoldingDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${seconds / 60 < 10 ? (seconds / 60).toFixed(1) : Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${seconds / 3600 < 10 ? (seconds / 3600).toFixed(1) : Math.round(seconds / 3600)}h`;
  return `${seconds / 86400 < 10 ? (seconds / 86400).toFixed(1) : Math.round(seconds / 86400)}d`;
}

/**
 * Returns display copy (title, axis labels, description) for a chart mode.
 */
export function getModeCopy(mode: TradeDistributionMode) {
  switch (mode) {
    case "mfe-profit":
      return {
        xAxis: "กำไรแล้ว",
        yAxis: "ทุน",
        description:
          "Shows how much favorable unrealized profit was available and how much was retained at close.",
      };
    case "mae-profit":
      return {
        xAxis: "ขาดทุนแล้ว",
        yAxis: "ทุน",
        description:
          "Shows the largest unrealized drawdown endured before the final closed result.",
      };
    case "profit-time":
      return {
        xAxis: "เวลา วินาที",
        yAxis: "ทุน",
        description:
          "Shows the relationship between full position lifetime and the final closed result.",
      };
  }
}
