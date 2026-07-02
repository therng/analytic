import { processStreamEntry, type StreamKind } from "./bridge-consumer";
import assert from "node:assert/strict";
import test from "node:test";

function fakePrisma() {
  const calls: Array<{ model: string; args: unknown }> = [];
  return {
    calls,
    bridgeDeal: { upsert: (args: unknown) => { calls.push({ model: "bridgeDeal", args }); return Promise.resolve(); } },
    bridgeOrder: { upsert: (args: unknown) => { calls.push({ model: "bridgeOrder", args }); return Promise.resolve(); } },
    bridgePosition: { upsert: (args: unknown) => { calls.push({ model: "bridgePosition", args }); return Promise.resolve(); } },
  };
}

test("processStreamEntry upserts a BridgeDeal for a deals-stream entry", async () => {
  const prisma = fakePrisma();
  await processStreamEntry(prisma as never, "deals" as StreamKind, "acct-1", JSON.stringify({
    ticket: 1, order: 2, positionId: 3, symbol: "EURUSD", type: "buy",
    volume: 0.1, price: 1.1, commission: 0, fee: 0, swap: 0, profit: 5, time: 1751000000, comment: "",
  }));
  assert.equal(prisma.calls.length, 1);
  assert.equal(prisma.calls[0].model, "bridgeDeal");
});

test("processStreamEntry upserts a BridgeOrder for an orders-stream entry", async () => {
  const prisma = fakePrisma();
  await processStreamEntry(prisma as never, "orders" as StreamKind, "acct-1", JSON.stringify({
    ticket: 1, positionId: null, symbol: "EURUSD", type: "buy", state: "FILLED",
    volume: 0.1, priceOpen: 1.1, sl: 0, tp: 0, timeSetup: 1751000000, timeDone: 1751000010, comment: "",
  }));
  assert.equal(prisma.calls.length, 1);
  assert.equal(prisma.calls[0].model, "bridgeOrder");
});

test("processStreamEntry upserts a BridgePosition for a position-closed-stream entry", async () => {
  const prisma = fakePrisma();
  await processStreamEntry(prisma as never, "position-closed" as StreamKind, "acct-1", JSON.stringify({
    ticket: 1, symbol: "EURUSD", positionType: 0, volume: 0.1, entryPrice: 1.1,
    exitPrice: 1.12, entryTime: 1751000000, exitTime: 1751000100, durationSeconds: 100,
    mae: -2, mfe: 5, profit: 20, commission: -1, swap: 0, dealTicket: 9, orderTicket: 8, comment: "",
  }));
  assert.equal(prisma.calls.length, 1);
  assert.equal(prisma.calls[0].model, "bridgePosition");
});

test("processStreamEntry throws on malformed JSON so the entry is retried, not silently dropped", async () => {
  const prisma = fakePrisma();
  await assert.rejects(() =>
    processStreamEntry(prisma as never, "deals" as StreamKind, "acct-1", "{not valid json")
  );
});
