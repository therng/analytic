import assert from "node:assert/strict";
import test from "node:test";

import { DASHBOARD_METRICS, getDashboardMetric } from "./metric-registry";

test("dashboard metrics have unique ids and labels", () => {
  assert.ok(DASHBOARD_METRICS.length > 0);

  const ids = new Set<string>();
  for (const metric of DASHBOARD_METRICS) {
    assert.ok(metric.id, "metric id must be non-empty");
    assert.ok(metric.label, `${metric.id} must have a label`);
    assert.ok(!ids.has(metric.id), `duplicate metric id ${metric.id}`);
    ids.add(metric.id);
  }
});

test("required dashboard KPI chips are registered", () => {
  for (const id of ["gain", "dd", "pips", "trades", "opens"]) {
    assert.ok(getDashboardMetric(id), `missing required metric ${id}`);
  }
});

test("every registered dashboard metric documents its data contract", () => {
  for (const metric of DASHBOARD_METRICS) {
    for (const field of ["source", "formula", "apiField", "displayTarget"] as const) {
      assert.equal(
        typeof metric[field],
        "string",
        `${metric.id}.${field} must be documented`,
      );
      assert.ok(metric[field].trim(), `${metric.id}.${field} must be non-empty`);
    }
  }
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
