import assert from "node:assert/strict";
import test from "node:test";

import { DASHBOARD_METRICS, getDashboardMetric } from "./metric-registry";

test("dashboard metrics have unique ids and labels", () => {
  assert.ok(DASHBOARD_METRICS.length > 0);

  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const metric of DASHBOARD_METRICS) {
    assert.ok(metric.id, "metric id must be non-empty");
    assert.ok(metric.label, `${metric.id} must have a label`);
    assert.ok(!ids.has(metric.id), `duplicate metric id ${metric.id}`);
    assert.ok(
      !labels.has(metric.label),
      `duplicate metric label ${metric.label}`,
    );
    ids.add(metric.id);
    labels.add(metric.label);
  }
});

test("required dashboard KPI chips are registered", () => {
  for (const id of ["gain", "dd", "pips", "trades", "opens"]) {
    assert.ok(getDashboardMetric(id), `missing required metric ${id}`);
  }
});

test("every registered dashboard metric matches its exact data contract", () => {
  const expected = [
    {
      id: "gain",
      source: "Deal",
      formula: "Sum profit + swap + commission for scoped trading deals, excluding balance operations",
      apiField: "overview.kpis.netProfit",
      displayTarget: "GAIN KPI chip",
    },
    {
      id: "dd",
      source: "Deal",
      formula: "Maximum peak-to-valley balance decline divided by peak balance over the scoped balance curve",
      apiField: "overview.kpis.drawdown",
      displayTarget: "DD KPI chip",
    },
    {
      id: "max-balance-drawdown",
      source: "Deal",
      formula: "Largest peak-to-valley decline on the scoped balance curve",
      apiField: "balanceDetail.summary.maximalDrawdownAmount",
      displayTarget: "DD detail MAX chip",
    },
    {
      id: "pips",
      source: "Position",
      formula: "Sum net pips from scoped closed positions",
      apiField: "overview.kpis.netPips",
      displayTarget: "PIPS KPI chip",
    },
    {
      id: "trades",
      source: "Position",
      formula: "Count scoped closed positions",
      apiField: "overview.kpis.trades",
      displayTarget: "TRADES KPI chip",
    },
    {
      id: "opens",
      source: "OpenPosition / Redis",
      formula: "Count current open positions, preferring the fresher live position snapshot",
      apiField: "live.positions.length / overview.kpis.openCount",
      displayTarget: "OPENS KPI chip",
    },
    {
      id: "commission",
      source: "Deal",
      formula: "Sum commission for scoped trading deals",
      apiField: "overview.kpis.totalCommission",
      displayTarget: "GAIN detail COMM. chip",
    },
    {
      id: "swap",
      source: "Deal",
      formula: "Sum swap for scoped trading deals",
      apiField: "overview.kpis.totalSwap",
      displayTarget: "GAIN detail SWAP chip",
    },
    {
      id: "deposit",
      source: "Deal",
      formula: "Sum positive scoped deposit balance operations",
      apiField: "overview.kpis.totalDeposit",
      displayTarget: "GAIN detail DEPOS. chip",
    },
    {
      id: "withdrawal",
      source: "Deal",
      formula: "Sum absolute values of negative scoped withdrawal balance operations",
      apiField: "overview.kpis.totalWithdrawal",
      displayTarget: "GAIN detail WITHD. chip",
    },
    {
      id: "floating-pl",
      source: "OpenPosition / AccountSnapshot / Redis",
      formula: "Current floating profit or loss from the freshest live snapshot",
      apiField: "live.profit / account.floating_pl",
      displayTarget: "OPENS detail P/L chip",
    },
    {
      id: "margin",
      source: "AccountSnapshot / Redis",
      formula: "Current broker-reported used margin from the freshest live snapshot",
      apiField: "live.margin / account.margin",
      displayTarget: "OPENS detail MARGIN chip",
    },
    {
      id: "free-margin",
      source: "AccountSnapshot / Redis",
      formula: "Current free margin, falling back to equity minus used margin",
      apiField: "live.freeMargin / (account.equity - account.margin)",
      displayTarget: "OPENS detail FREE chip",
    },
    {
      id: "margin-level",
      source: "AccountSnapshot / Redis",
      formula: "Current broker-reported margin level percentage from the freshest live snapshot",
      apiField: "live.marginLevel / account.margin_level",
      displayTarget: "OPENS detail LEVEL chip",
    },
    {
      id: "max-deposit-load",
      source: "EquitySnapshot.depositLoad / maxDepositLoad (interim historical path)",
      formula:
        "max(broker margin / equity) over scoped samples; \"all\" reads the persisted running high-water mark instead, since it survives 7-day row retention",
      apiField: "balanceDetail.summary.maximalDepositLoad",
      displayTarget: "Performance radar deposit-load axis",
    },
    {
      id: "max-balance-drawdown-pct",
      source: "Deal",
      formula:
        "Percentage of the running peak balance at the largest peak-to-valley decline on the scoped balance curve (the % paired with the maximal monetary drawdown, per MT5 Balance Drawdown Maximal; withdrawals count toward it). Radar axis inverts it (score = 100 - value)",
      apiField: "balanceDetail.summary.maximalDrawdownPct",
      displayTarget: "Performance radar drawdown axis",
    },
    {
      id: "win-percent",
      source: "Position",
      formula:
        "Closed positions with net profit + swap + commission strictly > 0, divided by all in-scope closed positions; break-even trades sit in the denominator only",
      apiField: "overview.kpis.winPercent",
      displayTarget: "Performance radar WIN%/LOSS% axes + DD detail WIN chip",
    },
    {
      id: "algo-trading",
      source: "Position",
      formula:
        "In-scope closed positions whose non-empty comment is not manual|balance|credit|deposit|withdrawal|correction|rebate, divided by all in-scope closed positions (comment blocklist; magic number not consulted)",
      apiField: "overview.kpis.performance.algoTradingPercent",
      displayTarget: "Performance radar ALGO axis",
    },
    {
      id: "trade-activity",
      source: "Position",
      formula:
        "Distinct Bangkok calendar days with a position held inside the scoped window (open->close spans clamped to the window) divided by the window's day count; \"all\" spans first open to report time",
      apiField: "overview.kpis.performance.tradeActivityPercent",
      displayTarget: "Performance radar ACTIVITY axis + positions summary",
    },
  ];

  assert.deepEqual(
    DASHBOARD_METRICS.map(({ id, source, formula, apiField, displayTarget }) => ({
      id,
      source,
      formula,
      apiField,
      displayTarget,
    })),
    expected,
  );
});

test("relative drawdown documents the scoped Deal balance curve", () => {
  const metric = getDashboardMetric("dd");
  assert.ok(metric);
  assert.equal(metric.meta, "Balance curve");
  assert.equal(metric.source, "Deal");
  assert.equal(metric.apiField, "overview.kpis.drawdown");
});

test("registry excludes metrics that have no display target", () => {
  assert.equal(getDashboardMetric("deposit-load-by-volume"), null);
});

test("maximum balance drawdown DD selector descriptor is registered", () => {
  assert.deepEqual(getDashboardMetric("max-balance-drawdown"), {
    id: "max-balance-drawdown",
    label: "MAX",
    meta: "Max balance DD",
    hint: "จำนวนเงินที่ Balance ลดลงสูงสุดจากจุดสูงสุดถึงจุดต่ำสุดในช่วงเวลา",
    source: "Deal",
    formula: "Largest peak-to-valley decline on the scoped balance curve",
    apiField: "balanceDetail.summary.maximalDrawdownAmount",
    displayTarget: "DD detail MAX chip",
  });
});
