import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAverageProfitLossBar,
  buildLongShortTradeBar,
  buildQualityRiskMetrics,
} from "./PerformanceQualityPanel";

test("buildQualityRiskMetrics formats performance and risk tiles", () => {
  const metrics = buildQualityRiskMetrics({
    relativeDrawdownPct: 12.345,
    maximalDrawdownAmount: 12345.67,
    expectedPayoff: 45.678,
    averageLossTrade: 89.12,
    maximumConsecutiveLossAmount: -345.67,
    maximalDepositLoad: 4.56,
  });

  assert.deepEqual(
    metrics.map(({ label, value, tone, fullValue }) => ({ label, value, tone, fullValue })),
    [
      { label: "REL DD", value: "12.3%", tone: "warning", fullValue: "12.3%" },
      { label: "MAX DD", value: "12.35K", tone: "negative", fullValue: "$12,345.67" },
      { label: "EXPECT", value: "+45.7", tone: "positive", fullValue: "+$45.68" },
      { label: "AVG LOSS", value: "89.1", tone: "warning", fullValue: "-$89.12" },
      { label: "LOSS RUN", value: "345.7", tone: "negative", fullValue: "-$345.67" },
      { label: "DEP LOAD", value: "4.6%", tone: "positive", fullValue: "4.6%" },
    ],
  );
});

test("buildQualityRiskMetrics keeps unavailable values muted", () => {
  const metrics = buildQualityRiskMetrics({});

  assert.equal(metrics.length, 6);
  assert.ok(metrics.every((metric) => metric.value === "-"));
  assert.ok(metrics.every((metric) => metric.tone === "muted"));
});

test("buildAverageProfitLossBar formats profit and loss comparison", () => {
  const bar = buildAverageProfitLossBar({
    averageProfitTrade: 120.4,
    averageLossTrade: 80.1,
  });

  assert.deepEqual(
    {
      title: bar.title,
      left: bar.left,
      right: bar.right,
      leftWidth: Math.round(bar.leftWidth),
      rightWidth: Math.round(bar.rightWidth),
      hasValue: bar.hasValue,
    },
    {
      title: "AVG P/L",
      left: { value: "+120.4", tone: "positive" },
      right: { value: "-80.1", tone: "negative" },
      leftWidth: 60,
      rightWidth: 40,
      hasValue: true,
    },
  );
});

test("buildLongShortTradeBar formats long and short trade totals", () => {
  const bar = buildLongShortTradeBar({
    longTradesTotal: 12,
    shortTradesTotal: 8,
  });

  assert.deepEqual(
    {
      title: bar.title,
      meta: bar.meta,
      left: bar.left,
      right: bar.right,
      leftWidth: Math.round(bar.leftWidth),
      rightWidth: Math.round(bar.rightWidth),
      hasValue: bar.hasValue,
    },
    {
      title: "LONG / SHORT",
      meta: "TOTAL 20",
      left: { value: "12", tone: "neutral" },
      right: { value: "8", tone: "neutral" },
      leftWidth: 60,
      rightWidth: 40,
      hasValue: true,
    },
  );
});
