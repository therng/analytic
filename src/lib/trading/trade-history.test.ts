import { test } from "node:test";
import assert from "node:assert";

import {
  buildTradeHistoryWhere,
  clampTradeHistoryLimit,
  decodeTradeHistoryCursor,
  DEFAULT_TRADE_HISTORY_LIMIT,
  encodeTradeHistoryCursor,
  MAX_TRADE_HISTORY_LIMIT,
  parseTradeHistoryPageOptions,
} from "./trade-history";

test("clampTradeHistoryLimit defaults on non-finite input", () => {
  assert.equal(clampTradeHistoryLimit(NaN), DEFAULT_TRADE_HISTORY_LIMIT);
  assert.equal(clampTradeHistoryLimit(Infinity), DEFAULT_TRADE_HISTORY_LIMIT);
});

test("clampTradeHistoryLimit clamps to [1, MAX]", () => {
  assert.equal(clampTradeHistoryLimit(0), 1);
  assert.equal(clampTradeHistoryLimit(-5), 1);
  assert.equal(clampTradeHistoryLimit(10000), MAX_TRADE_HISTORY_LIMIT);
  assert.equal(clampTradeHistoryLimit(50.9), 50);
});

test("parseTradeHistoryPageOptions applies default limit and passes cursor through", () => {
  const options = parseTradeHistoryPageOptions(new URLSearchParams());
  assert.equal(options.limit, DEFAULT_TRADE_HISTORY_LIMIT);
  assert.equal(options.cursor, null);

  const withParams = parseTradeHistoryPageOptions(
    new URLSearchParams("limit=25&cursor=abc"),
  );
  assert.equal(withParams.limit, 25);
  assert.equal(withParams.cursor, "abc");
});

test("encodeTradeHistoryCursor/decodeTradeHistoryCursor round-trip", () => {
  const closeTime = new Date("2026-07-01T12:34:56.000Z");
  const cursor = encodeTradeHistoryCursor(closeTime, "12345");
  const decoded = decodeTradeHistoryCursor(cursor);
  assert.ok(decoded);
  assert.equal(decoded?.closeTime.getTime(), closeTime.getTime());
  assert.equal(decoded?.positionNo, "12345");
});

test("encodeTradeHistoryCursor URI-encodes positionNo", () => {
  const closeTime = new Date("2026-07-01T00:00:00.000Z");
  const cursor = encodeTradeHistoryCursor(closeTime, "a:b/c");
  const decoded = decodeTradeHistoryCursor(cursor);
  assert.equal(decoded?.positionNo, "a:b/c");
});

test("decodeTradeHistoryCursor returns null for malformed input", () => {
  assert.equal(decodeTradeHistoryCursor(null), null);
  assert.equal(decodeTradeHistoryCursor(""), null);
  assert.equal(decodeTradeHistoryCursor("no-separator"), null);
  assert.equal(decodeTradeHistoryCursor("not-a-number:123"), null);
  assert.equal(decodeTradeHistoryCursor("123:"), null);
  assert.equal(decodeTradeHistoryCursor("%:123"), null);
});

test("buildTradeHistoryWhere excludes open positions (closeTime not null) with no cursor", () => {
  const where = buildTradeHistoryWhere("acct-1", null);
  assert.deepEqual(where, {
    tradingAccountId: "acct-1",
    closeTime: { not: null },
  });
});

test("buildTradeHistoryWhere applies keyset predicate matching ORDER BY closeTime DESC, positionNo DESC", () => {
  const closeTime = new Date("2026-07-01T00:00:00.000Z");
  const where = buildTradeHistoryWhere("acct-1", {
    closeTime,
    positionNo: "500",
  });
  assert.deepEqual(where, {
    tradingAccountId: "acct-1",
    closeTime: { not: null },
    OR: [
      { closeTime: { lt: closeTime } },
      { closeTime, positionNo: { lt: "500" } },
    ],
  });
});
