import assert from "node:assert/strict";
import test from "node:test";

import { filterHistoryPositionsByTimeframe } from "./position-timeframe";

type Position = {
  closedAt: Date | string | null;
};

test("filterHistoryPositionsByTimeframe limits closed positions to the selected timeframe", () => {
  const now = new Date("2026-06-20T12:00:00.000Z");
  const positions: Position[] = [
    { closedAt: "2026-06-19T10:00:00.000Z" },
    { closedAt: "2026-05-10T10:00:00.000Z" },
    { closedAt: null },
  ];

  const filtered = filterHistoryPositionsByTimeframe(positions, "1m", now);

  assert.deepEqual(filtered, [positions[0]]);
});

test("filterHistoryPositionsByTimeframe keeps all closed positions for all-time", () => {
  const now = new Date("2026-06-20T12:00:00.000Z");
  const positions: Position[] = [
    { closedAt: "2026-06-19T10:00:00.000Z" },
    { closedAt: "2026-05-10T10:00:00.000Z" },
    { closedAt: null },
  ];

  const filtered = filterHistoryPositionsByTimeframe(positions, "all", now);

  assert.deepEqual(filtered, positions);
});
