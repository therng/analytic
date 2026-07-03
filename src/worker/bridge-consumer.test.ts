import { processStreamEntry, type StreamKind } from "./bridge-consumer";
import assert from "node:assert/strict";
import test from "node:test";

function fakePrisma() {
  const calls: Array<{ model: string; args: unknown }> = [];
  return {
    calls,
    deal: { upsert: (args: unknown) => { calls.push({ model: "deal", args }); return Promise.resolve(); } },
    order: { upsert: (args: unknown) => { calls.push({ model: "order", args }); return Promise.resolve(); } },
    position: { upsert: (args: unknown) => { calls.push({ model: "position", args }); return Promise.resolve(); } },
  };
}

test("processStreamEntry upserts a Deal for a deals-stream entry", async () => {
  const prisma = fakePrisma();
  await processStreamEntry(prisma as never, "deals" as StreamKind, "acct-1", JSON.stringify({
    ticket: 1, order: 2, positionId: 3, symbol: "EURUSD", type: "buy",
    volume: 0.1, price: 1.1, commission: 0, fee: 0, swap: 0, profit: 5, time: 1751000000, comment: "",
  }));
  assert.equal(prisma.calls.length, 1);
  assert.equal(prisma.calls[0].model, "deal");
});

test("processStreamEntry upserts an Order for an orders-stream entry", async () => {
  const prisma = fakePrisma();
  await processStreamEntry(prisma as never, "orders" as StreamKind, "acct-1", JSON.stringify({
    ticket: 1, positionId: null, symbol: "EURUSD", type: "buy", state: "FILLED",
    volume: 0.1, priceOpen: 1.1, sl: 0, tp: 0, timeSetup: 1751000000, timeDone: 1751000010, comment: "",
  }));
  assert.equal(prisma.calls.length, 1);
  assert.equal(prisma.calls[0].model, "order");
});

test("processStreamEntry upserts a Position and recomputes account metrics for a position-closed-stream entry", async () => {
  const prisma = fakePrisma();
  const recomputeCalls: Array<{ accountId: string; reportDate?: Date | null }> = [];
  await processStreamEntry(prisma as never, "position-closed" as StreamKind, "acct-1", JSON.stringify({
    ticket: 1, symbol: "EURUSD", positionType: 0, volume: 0.1, entryPrice: 1.1,
    exitPrice: 1.12, entryTime: 1751000000, exitTime: 1751000100, durationSeconds: 100,
    mae: -2, mfe: 5, profit: 20, commission: -1, swap: 0, dealTicket: 9, orderTicket: 8, comment: "",
  }), async (accountId, reportDate) => {
    recomputeCalls.push({ accountId, reportDate });
  });
  assert.equal(prisma.calls.length, 1);
  assert.equal(prisma.calls[0].model, "position");
  assert.equal(recomputeCalls.length, 1);
  assert.equal(recomputeCalls[0].accountId, "acct-1");
  assert.equal(recomputeCalls[0].reportDate?.toISOString(), new Date(1751000100 * 1000).toISOString());
});

test("processStreamEntry throws on malformed JSON so the entry is retried, not silently dropped", async () => {
  const prisma = fakePrisma();
  await assert.rejects(() =>
    processStreamEntry(prisma as never, "deals" as StreamKind, "acct-1", "{not valid json")
  );
});
