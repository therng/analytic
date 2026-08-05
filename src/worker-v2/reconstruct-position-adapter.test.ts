import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { makeReconstructPosition } from "./reconstruct-position-adapter";
import { toDecimal, toDecimalOrZero } from "./decimal";
import type { DealForReconstruction } from "./position-reconstructor";

let ticket = 1;
function deal(overrides: Partial<DealForReconstruction> & { time: number }): DealForReconstruction {
  ticket += 1;
  return {
    dealNo: overrides.dealNo ?? String(ticket),
    time: new Date(overrides.time * 1000),
    symbol: overrides.symbol === undefined ? "XAUUSD" : overrides.symbol,
    type: overrides.type ?? "buy",
    direction: overrides.direction ?? "in",
    volume: overrides.volume ?? 1,
    price: overrides.price === null ? null : toDecimal((overrides.price as number) ?? 2000),
    commission: toDecimalOrZero(overrides.commission ?? 0),
    swap: toDecimalOrZero(overrides.swap ?? 0),
    profit: toDecimalOrZero(overrides.profit ?? 0),
    fee: toDecimalOrZero(overrides.fee ?? 0),
    comment: overrides.comment ?? null,
    magic: overrides.magic ?? null,
    reason: overrides.reason ?? null,
  };
}

function fakePrisma(deals: DealForReconstruction[]) {
  const client = {
    deal: { findMany: async () => deals },
    positionExcursion: {
      aggregate: async () => ({
        _min: { profit: null as Prisma.Decimal | null },
        _max: { profit: null as Prisma.Decimal | null },
      }),
    },
    position: {
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => args,
    },
  } as unknown as PrismaClient;
  return client;
}

test("makeReconstructPosition maps no-deals status", async () => {
  const reconstruct = makeReconstructPosition("acct-1", "1001");
  const result = await reconstruct(fakePrisma([]) as never, "pos-1");
  assert.deepEqual(result, { status: "no-deals" });
});

test("makeReconstructPosition maps open status", async () => {
  const reconstruct = makeReconstructPosition("acct-1", "1001");
  const deals = [deal({ dealNo: "1", time: 1000, direction: "in", type: "buy", volume: 1, price: 2000 })];
  const result = await reconstruct(fakePrisma(deals) as never, "pos-1");
  assert.deepEqual(result, { status: "open" });
});

test("makeReconstructPosition maps closed status without leaking fields", async () => {
  const reconstruct = makeReconstructPosition("acct-1", "1001");
  const deals = [
    deal({ dealNo: "1", time: 1000, direction: "in", type: "buy", volume: 1, price: 2000 }),
    deal({ dealNo: "2", time: 2000, direction: "out", type: "sell", volume: 1, price: 2010 }),
  ];
  const result = await reconstruct(fakePrisma(deals) as never, "pos-1");
  assert.deepEqual(result, { status: "closed" });
});

test("makeReconstructPosition maps ambiguous-reopen status with lastDealNo in reason", async () => {
  const reconstruct = makeReconstructPosition("acct-1", "1001");
  const deals = [
    deal({ dealNo: "1", time: 1000, direction: "in", type: "buy", volume: 1, price: 2000 }),
    deal({ dealNo: "2", time: 2000, direction: "out", type: "sell", volume: 1, price: 2010 }),
    deal({ dealNo: "3", time: 3000, direction: "in", type: "buy", volume: 1, price: 2020 }),
  ];
  const result = await reconstruct(fakePrisma(deals) as never, "pos-1");
  assert.equal(result.status, "ambiguous-reopen");
  if (result.status === "ambiguous-reopen") {
    assert.equal(result.reason, "lastDealNo=3");
  }
});

test("makeReconstructPosition maps corrupted status with underlying reason", async () => {
  const reconstruct = makeReconstructPosition("acct-1", "1001");
  const deals = [
    deal({ dealNo: "1", time: 1000, direction: "in", type: "buy", volume: 1, price: 2000, symbol: null }),
    deal({ dealNo: "2", time: 2000, direction: "out", type: "sell", volume: 1, price: 2010, symbol: null }),
  ];
  const result = await reconstruct(fakePrisma(deals) as never, "pos-1");
  assert.equal(result.status, "corrupted");
  if (result.status === "corrupted") {
    assert.match(result.reason, /missing symbol/i);
  }
});
