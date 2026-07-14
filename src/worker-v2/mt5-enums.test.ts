import test from "node:test";
import assert from "node:assert/strict";
import { decodeDealType, decodeDealEntry, decodeOrderType, decodePositionSide, isFundingDealType } from "./mt5-enums";

test("decodeDealType maps known codes and falls back for unknown", () => {
  const cases: Array<[unknown, string]> = [
    [0, "buy"], [1, "sell"], [2, "balance"], [3, "credit"], [7, "commission"],
    [17, "tax"], [99, "deal_type_99"], ["not-a-number", "deal_type_not-a-number"],
  ];
  for (const [input, expected] of cases) assert.equal(decodeDealType(input), expected);
});

test("decodeDealEntry maps known codes and returns null for unknown/missing", () => {
  const cases: Array<[unknown, string | null]> = [
    [0, "in"], [1, "out"], [2, "inout"], [3, "out_by"], [99, null], [null, null], [undefined, null],
  ];
  for (const [input, expected] of cases) assert.equal(decodeDealEntry(input), expected);
});

test("decodeOrderType maps known codes and falls back for unknown", () => {
  const cases: Array<[unknown, string]> = [
    [0, "buy"], [1, "sell"], [2, "buy_limit"], [7, "sell_stop_limit"], [42, "order_type_42"],
  ];
  for (const [input, expected] of cases) assert.equal(decodeOrderType(input), expected);
});

test("decodePositionSide accepts 0/1 and buy/sell, rejects everything else", () => {
  const okCases: Array<[unknown, "buy" | "sell"]> = [
    [0, "buy"], [1, "sell"], ["0", "buy"], ["1", "sell"], ["buy", "buy"], ["SELL", "sell"],
  ];
  for (const [input, expected] of okCases) assert.equal(decodePositionSide(input), expected);
  for (const bad of [2, "long", null, undefined, ""]) assert.equal(decodePositionSide(bad), null);
});

test("isFundingDealType flags balance/credit/correction/bonus/interest/dividend/tax, not buy/sell", () => {
  for (const code of [2, 3, 5, 6, 12, 15, 16, 17]) assert.equal(isFundingDealType(code), true);
  for (const code of [0, 1, 4, 7]) assert.equal(isFundingDealType(code), false);
});
