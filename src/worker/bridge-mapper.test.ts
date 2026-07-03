import {
  mapDealPayload,
  mapDealPayloadToDeal,
  mapOrderPayload,
  mapOrderPayloadToOrder,
  mapPositionClosedPayload,
  mapPositionClosedPayloadToPosition,
} from "./bridge-mapper";
import assert from "node:assert/strict";
import test from "node:test";

test("mapDealPayload maps a raw deal to a BridgeDeal row", () => {
  const row = mapDealPayload("acct-1", {
    ticket: 555, order: 444, positionId: 333, symbol: "EURUSD", type: "sell",
    volume: 0.1, price: 1.085, commission: -0.5, fee: 0, swap: -0.2,
    profit: 12.34, time: 1751000000, comment: "tp",
  });
  assert.equal(row.tradingAccountId, "acct-1");
  assert.equal(row.dealNo, "555");
  assert.equal(row.orderId, "444");
  assert.equal(row.positionId, "333");
  assert.equal(row.symbol, "EURUSD");
  assert.equal(row.type, "sell");
  assert.equal(row.volume, 0.1);
  assert.equal(String(row.price), "1.085");
  assert.equal(String(row.commission), "-0.5");
  assert.equal(String(row.profit), "12.34");
  assert.equal(row.time.toISOString(), new Date(1751000000 * 1000).toISOString());
  assert.equal(row.comment, "tp");
});

test("mapDealPayloadToDeal maps a raw deal to a production Deal row", () => {
  const row = mapDealPayloadToDeal("acct-1", {
    ticket: 555, order: 444, positionId: 333, symbol: "EURUSD", type: "sell",
    volume: 0.1, price: 1.085, commission: -0.5, fee: 0, swap: -0.2,
    profit: 12.34, time: 1751000000, comment: "tp",
  });
  assert.equal(row.dealNo, "555");
  assert.equal(row.reportDate.toISOString(), new Date(1751000000 * 1000).toISOString());
});

test("mapOrderPayload maps a raw order to a BridgeOrder row", () => {
  const row = mapOrderPayload("acct-1", {
    ticket: 999, positionId: 333, symbol: "EURUSD", type: "sell",
    state: "FILLED", volume: 0.1, priceOpen: 1.085, sl: 1.09, tp: 1.08,
    timeSetup: 1751000000, timeDone: 1751000010, comment: "",
  });
  assert.equal(row.orderTicket, "999");
  assert.equal(row.positionId, "333");
  assert.equal(row.state, "FILLED");
  assert.equal(String(row.priceOpen), "1.085");
  assert.equal(row.timeSetup?.toISOString(), new Date(1751000000 * 1000).toISOString());
  assert.equal(row.timeDone?.toISOString(), new Date(1751000010 * 1000).toISOString());
});

test("mapOrderPayloadToOrder maps a raw order to a production Order row", () => {
  const row = mapOrderPayloadToOrder("acct-1", {
    ticket: 999, positionId: 333, symbol: "EURUSD", type: "sell",
    state: "FILLED", volume: 0.1, priceOpen: 1.085, sl: 1.09, tp: 1.08,
    timeSetup: 1751000000, timeDone: 1751000010, comment: "",
  });
  assert.equal(row.orderTicket, "999");
  assert.equal(row.priceCurrent, null);
  assert.equal(row.timeDone?.toISOString(), new Date(1751000010 * 1000).toISOString());
});

test("mapOrderPayload treats timeDone of 0 as null (order still pending)", () => {
  const row = mapOrderPayload("acct-1", {
    ticket: 999, positionId: null, symbol: "EURUSD", type: "buy limit",
    state: "PLACED", volume: 0.1, priceOpen: 1.08, sl: 0, tp: 0,
    timeSetup: 1751000000, timeDone: 0, comment: "",
  });
  assert.equal(row.timeDone, null);
});

test("mapPositionClosedPayload maps an enriched close event to a BridgePosition row", () => {
  const row = mapPositionClosedPayload("acct-1", {
    ticket: 777, symbol: "XAUUSD", positionType: 0, volume: 0.5,
    entryPrice: 3300.0, exitPrice: 3320.5, entryTime: 1750999000,
    exitTime: 1751000000, durationSeconds: 1000, mae: -15.0, mfe: 25.0,
    profit: 20.5, commission: -1.0, swap: -0.5, dealTicket: 555,
    orderTicket: 444, comment: "closed by tp",
  });
  assert.equal(row.tradingAccountId, "acct-1");
  assert.equal(row.positionNo, "777");
  assert.equal(row.symbol, "XAUUSD");
  assert.equal(row.type, "buy");
  assert.equal(row.volume, 0.5);
  assert.equal(String(row.openPrice), "3300");
  assert.equal(String(row.closePrice), "3320.5");
  assert.equal(row.openTime?.toISOString(), new Date(1750999000 * 1000).toISOString());
  assert.equal(row.closeTime?.toISOString(), new Date(1751000000 * 1000).toISOString());
  assert.equal(String(row.mae), "-15");
  assert.equal(String(row.mfe), "25");
  assert.equal(String(row.profit), "20.5");
  assert.equal(String(row.commission), "-1");
  assert.equal(String(row.swap), "-0.5");
  assert.equal(row.comment, "closed by tp");
});

test("mapPositionClosedPayloadToPosition maps an enriched close event to a production Position row", () => {
  const row = mapPositionClosedPayloadToPosition("acct-1", {
    ticket: 777, symbol: "XAUUSD", positionType: 0, volume: 0.5,
    entryPrice: 3300.0, exitPrice: 3320.5, entryTime: 1750999000,
    exitTime: 1751000000, durationSeconds: 1000, mae: -15.0, mfe: 25.0,
    profit: 20.5, commission: -1.0, swap: -0.5, dealTicket: 555,
    orderTicket: 444, comment: "closed by tp",
  });
  assert.equal(row.positionNo, "777");
  assert.equal(row.sl, null);
  assert.equal(row.tp, null);
  assert.equal(row.pips, null);
  assert.equal(row.reportDate.toISOString(), new Date(1751000000 * 1000).toISOString());
});

test("mapPositionClosedPayload handles a missing exit deal (null profit/price)", () => {
  const row = mapPositionClosedPayload("acct-1", {
    ticket: 778, symbol: "XAUUSD", positionType: 1, volume: 0.1,
    entryPrice: 3300.0, exitPrice: null, entryTime: 1750999000,
    exitTime: 1751000000, durationSeconds: 1000, mae: -5.0, mfe: 2.0,
    profit: null, commission: null, swap: null, dealTicket: null,
    orderTicket: null, comment: "",
  });
  assert.equal(row.closePrice, null);
  assert.equal(row.profit, 0);
});
