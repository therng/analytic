import assert from "node:assert/strict";
import test from "node:test";

import {
  paginatePositionsResponse,
  parsePositionHistoryPageOptions,
  type PositionHistoryPageOptions,
} from "./preaggregated-cache";
import type { PositionsResponse } from "./types";

type PositionFixture = {
  positionId: string;
  closedAt?: Date | null;
  openedAt?: Date | null;
};

function makePositionsResponse(positions: Array<string | PositionFixture>): PositionsResponse {
  const positionFixtures = positions.map((position, index): PositionFixture => {
    if (typeof position !== "string") {
      return position;
    }

    return {
      positionId: position,
      closedAt: new Date(Date.UTC(2026, 6, 4, 12, 0, 0) - index * 60_000),
    };
  });

  return {
    timeframe: "1d",
    account: {
      id: "account-1",
      account_number: "1001",
      owner_name: null,
      currency: "USD",
      server: "Demo",
      status: "Active",
      last_updated: null,
      today_growth_percent: 0,
      week_growth_percent: 0,
      today_net_profit: 0,
      today_net_pips: 0,
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
    },
    summary: {
      dealCount: 0,
      totalTrades: positionFixtures.length,
      tradeActivityPercent: null,
      algoTradingPercent: null,
      tradesPerWeek: null,
      averageProfitTrade: null,
      averageLossTrade: null,
      longTradesTotal: null,
      shortTradesTotal: null,
      longTradeWin: null,
      shortTradeWin: null,
      averageHoldHours: null,
      profitFactor: null,
      recoveryFactor: null,
      sharpeRatio: null,
      expectedPayoff: null,
      maxConsecutiveProfitAmount: null,
      maxConsecutiveLossAmount: null,
      largestProfitTrade: null,
      largestLossTrade: null,
      maximumConsecutiveWins: null,
      maximumConsecutiveLosses: null,
      profitTradesCount: null,
      lossTradesCount: null,
      symbolTradePercent: [],
      totalWinningPips: 0,
      totalLosingPips: 0,
      netPips: 0,
      averageWinningPips: null,
      totalVolume: 0,
      openCount: 0,
      floatingProfit: 0,
    },
    openPositions: [],
    workingOrders: [],
    openBySymbol: [],
    historyPositions: positionFixtures.map((position) => ({
      positionId: position.positionId,
      symbol: "XAUUSD",
      type: "buy",
      volume: 0.1,
      openedAt: position.openedAt ?? null,
      closedAt: position.closedAt ?? null,
      openPrice: null,
      closePrice: null,
      marketPrice: null,
      profit: 0,
      sl: null,
      tp: null,
      swap: null,
      commission: null,
      pips: null,
      comment: null,
      exitReason: null,
    })),
    historyPage: {
      total: positionFixtures.length,
      limit: positionFixtures.length,
      hasMore: false,
      nextCursor: null,
    },
    recentDeals: [],
  };
}

function ids(page: PositionsResponse) {
  return page.historyPositions.map((position) => position.positionId);
}

test("parsePositionHistoryPageOptions defaults to history with a bounded page size", () => {
  const options = parsePositionHistoryPageOptions(new URLSearchParams());

  assert.deepEqual(options, {
    includeHistory: true,
    limit: 50,
    cursor: null,
  });
});

test("parsePositionHistoryPageOptions supports summary-only mode and preserves cursor text", () => {
  const options = parsePositionHistoryPageOptions(new URLSearchParams("history=0&limit=25&cursor=123%3Ap1"));

  assert.deepEqual(options, {
    includeHistory: false,
    limit: 25,
    cursor: "123:p1",
  });
});

test("parsePositionHistoryPageOptions clamps invalid and boundary limits", () => {
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=0")).limit, 1);
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=-20")).limit, 1);
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=1")).limit, 1);
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=250")).limit, 250);
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=251")).limit, 250);
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=not-a-number")).limit, 50);
  assert.equal(parsePositionHistoryPageOptions(new URLSearchParams("limit=2.8")).limit, 2);
});

test("paginatePositionsResponse can return summary-only metadata without history rows", () => {
  const payload = makePositionsResponse(["p3", "p2", "p1"]);
  const options: PositionHistoryPageOptions = {
    includeHistory: false,
    limit: 50,
    cursor: null,
  };

  const page = paginatePositionsResponse(payload, options);

  assert.equal(page.historyPositions.length, 0);
  assert.equal(page.historyPage.total, 3);
  assert.equal(page.historyPage.limit, 0);
  assert.equal(page.historyPage.hasMore, true);
  assert.equal(page.historyPage.nextCursor, null);
  assert.deepEqual(page.summary, payload.summary);
  assert.deepEqual(page.openPositions, payload.openPositions);
  assert.deepEqual(page.recentDeals, payload.recentDeals);
  assert.deepEqual(ids(payload), ["p3", "p2", "p1"]);
});

test("paginatePositionsResponse returns deterministic cursor pages", () => {
  const payload = makePositionsResponse(["p4", "p3", "p2", "p1"]);
  const firstPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 2,
    cursor: null,
  });
  const secondPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 2,
    cursor: firstPage.historyPage.nextCursor,
  });

  assert.deepEqual(ids(firstPage), ["p4", "p3"]);
  assert.equal(firstPage.historyPage.total, 4);
  assert.equal(firstPage.historyPage.limit, 2);
  assert.equal(firstPage.historyPage.hasMore, true);
  assert.deepEqual(ids(secondPage), ["p2", "p1"]);
  assert.equal(secondPage.historyPage.total, 4);
  assert.equal(secondPage.historyPage.limit, 2);
  assert.equal(secondPage.historyPage.hasMore, false);
  assert.equal(secondPage.historyPage.nextCursor, null);
});

test("paginatePositionsResponse treats malformed cursors as the first page", () => {
  const payload = makePositionsResponse(["p3", "p2", "p1"]);

  for (const cursor of ["missing-separator", "not-a-number:p2", "100:%E0%A4%A"]) {
    const page = paginatePositionsResponse(payload, {
      includeHistory: true,
      limit: 2,
      cursor,
    });

    assert.deepEqual(ids(page), ["p3", "p2"]);
    assert.equal(page.historyPage.total, 3);
    assert.equal(page.historyPage.hasMore, true);
    assert.equal(typeof page.historyPage.nextCursor, "string");
  }
});

test("paginatePositionsResponse handles a cursor beyond the last row", () => {
  const payload = makePositionsResponse(["p3", "p2", "p1"]);
  const firstPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 3,
    cursor: null,
  });
  const emptyPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 3,
    cursor: "0:p0",
  });

  assert.deepEqual(ids(firstPage), ["p3", "p2", "p1"]);
  assert.deepEqual(ids(emptyPage), []);
  assert.equal(emptyPage.historyPage.total, 3);
  assert.equal(emptyPage.historyPage.limit, 3);
  assert.equal(emptyPage.historyPage.hasMore, false);
  assert.equal(emptyPage.historyPage.nextCursor, null);
});

test("paginatePositionsResponse advances through same-timestamp rows by position id", () => {
  const closedAt = new Date("2026-07-04T12:00:00.000Z");
  const payload = makePositionsResponse([
    { positionId: "p3", closedAt },
    { positionId: "p2", closedAt },
    { positionId: "p1", closedAt },
  ]);

  const firstPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 1,
    cursor: null,
  });
  const secondPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 1,
    cursor: firstPage.historyPage.nextCursor,
  });
  const thirdPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 1,
    cursor: secondPage.historyPage.nextCursor,
  });

  assert.deepEqual(ids(firstPage), ["p3"]);
  assert.deepEqual(ids(secondPage), ["p2"]);
  assert.deepEqual(ids(thirdPage), ["p1"]);
  assert.equal(thirdPage.historyPage.hasMore, false);
});

test("paginatePositionsResponse falls back to openedAt for cursor timestamps", () => {
  const payload = makePositionsResponse([
    { positionId: "p2", closedAt: null, openedAt: new Date("2026-07-04T12:00:00.000Z") },
    { positionId: "p1", closedAt: null, openedAt: new Date("2026-07-04T11:00:00.000Z") },
  ]);
  const firstPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 1,
    cursor: null,
  });
  const secondPage = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 1,
    cursor: firstPage.historyPage.nextCursor,
  });

  assert.deepEqual(ids(firstPage), ["p2"]);
  assert.deepEqual(ids(secondPage), ["p1"]);
});

test("paginatePositionsResponse keeps the API response shape stable", () => {
  const payload = makePositionsResponse(["p2", "p1"]);
  const page = paginatePositionsResponse(payload, {
    includeHistory: true,
    limit: 1,
    cursor: null,
  });

  assert.deepEqual(Object.keys(page).sort(), [
    "account",
    "historyPage",
    "historyPositions",
    "openBySymbol",
    "openPositions",
    "recentDeals",
    "summary",
    "timeframe",
    "workingOrders",
  ]);
  assert.deepEqual(Object.keys(page.historyPage).sort(), ["hasMore", "limit", "nextCursor", "total"]);
  assert.equal(page.historyPage.total, 2);
  assert.equal(page.historyPage.limit, 1);
  assert.equal(page.historyPage.hasMore, true);
  assert.equal(typeof page.historyPage.nextCursor, "string");
});
