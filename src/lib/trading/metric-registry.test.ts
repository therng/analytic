import assert from "node:assert/strict";
import test from "node:test";

import { DASHBOARD_METRICS, isBridgeMetricSource } from "./metric-registry";

test("dashboard metrics are backed only by active Bridge/Redis sources", () => {
  assert.ok(DASHBOARD_METRICS.length > 0);

  for (const metric of DASHBOARD_METRICS) {
    assert.ok(isBridgeMetricSource(metric.source), `${metric.id} has unsupported source ${metric.source}`);
    assert.doesNotMatch(metric.source, /ftp|html|report-import|manual/i);
    assert.doesNotMatch(metric.formula, /ftp|html|report import|manual import/i);
  }
});

test("fast-scan KPI mapping covers the required dashboard chips", () => {
  const chipIds = new Set(
    DASHBOARD_METRICS
      .filter((metric) => metric.display.kind === "primary-kpi")
      .map((metric) => metric.id),
  );

  assert.deepEqual([...chipIds].sort(), ["dd", "gain", "opens", "pips", "trades"]);
});
