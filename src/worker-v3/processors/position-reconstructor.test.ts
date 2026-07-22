import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  computePositionLifecycle,
  reconstructPositionIfClosed,
  type DealForReconstruction,
} from "./position-reconstructor";
import { toDecimal, toDecimalOrZero } from "../decimal";

interface DealInput {
  dealNo?: string;
  time: number;
  symbol?: string | null;
  type?: string;
  direction?: string | null;
  volume?: number | null;
  price?: number | null;
  commission?: number;
  swap?: number;
  profit?: number;
  fee?: number;
  comment?: string | null;
}

let ticket = 1;
function deal(overrides: DealInput): DealForReconstruction {
  ticket += 1;
  return {
    dealNo: overrides.dealNo ?? String(ticket),
    time: new Date(overrides.time * 1000),
    symbol: overrides.symbol === null ? null : (overrides.symbol ?? "XAUUSD"),
    type: overrides.type ?? "buy",
    volume: overrides.volume ?? 1,
    price: overrides.price === null ? null : toDecimal(overrides.price ?? 2000),
    commission: toDecimalOrZero(overrides.commission ?? 0),
    swap: toDecimalOrZero(overrides.swap ?? 0),
    profit: toDecimalOrZero(overrides.profit ?? 0),
    fee: toDecimalOrZero(overrides.fee ?? 0),
    comment: overrides.comment ?? null,
  };
}

test("one entry + one exit closes the position", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
      profit: 10,
    }),
  ]);
  assert.equal(result.status, "closed");
  if (result.status !== "closed") return;
  assert.equal(result.fields.side, "buy");
  assert.equal(result.fields.totalOpenedVolume, 1);
  assert.equal(result.fields.openPrice.toString(), "2000");
  assert.equal(result.fields.closePrice.toString(), "2010");
  assert.equal(result.fields.netPnl.toString(), "10");
  assert.equal(result.fields.durationSeconds, 1000);
});

test("netPnl excludes fee, only profit, swap, and commission", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
      profit: 10,
      commission: -2,
      swap: -1,
      fee: -0.5,
    }),
  ]);
  assert.equal(result.status, "closed");
  if (result.status !== "closed") return;
  assert.equal(result.fields.netPnl.toString(), "7");
});

test("partial close leaves the position open until fully closed", () => {
  const partial = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 2,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
    }),
  ]);
  assert.equal(partial.status, "open");

  const full = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 2,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
    }),
    deal({
      dealNo: "3",
      time: 3000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2020,
    }),
  ]);
  assert.equal(full.status, "closed");
  if (full.status !== "closed") return;
  assert.equal(full.fields.totalOpenedVolume, 2);
  // weighted exit: (1*2010 + 1*2020) / 2 = 2015
  assert.equal(full.fields.closePrice.toString(), "2015");
});

test("multiple entries produce a volume-weighted average entry price", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 1500,
      direction: "in",
      type: "buy",
      volume: 3,
      price: 2100,
    }),
    deal({
      dealNo: "3",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 4,
      price: 2200,
    }),
  ]);
  assert.equal(result.status, "closed");
  if (result.status !== "closed") return;
  // (1*2000 + 3*2100) / 4 = 2075
  assert.equal(result.fields.openPrice.toString(), "2075");
  assert.equal(result.fields.totalOpenedVolume, 4);
});

test("out_by closes the position the same as out", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out_by",
      type: "sell",
      volume: 1,
      price: 2050,
    }),
  ]);
  assert.equal(result.status, "closed");
  if (result.status !== "closed") return;
  assert.equal(result.fields.closePrice.toString(), "2050");
});

test("inout reversal closes the old side and opens the new side from one deal", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    // reversal: closes the 1-lot long and opens a 1.5-lot short, all at 2010
    deal({
      dealNo: "2",
      time: 2000,
      direction: "inout",
      type: "sell",
      volume: 2.5,
      price: 2010,
    }),
    deal({
      dealNo: "3",
      time: 3000,
      direction: "out",
      type: "buy",
      volume: 1.5,
      price: 1990,
    }),
  ]);
  assert.equal(result.status, "closed");
  if (result.status !== "closed") return;
  // lifecycle spans the whole thing: opened 1 (buy@2000) then 1.5 (sell@2010) = 2.5 total opened
  assert.equal(result.fields.totalOpenedVolume, 2.5);
  assert.equal(result.fields.side, "sell"); // final side after the reversal
  // exit weighted: (1*2010 + 1.5*1990) / 2.5 = 1998
  assert.equal(result.fields.closePrice.toString(), "1998");
  assert.equal(result.fields.openTime.getTime(), 1000 * 1000);
  assert.equal(result.fields.closeTime.getTime(), 3000 * 1000);
});

test("zero-volume commission/swap rows contribute P/L but do not affect state", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 1500,
      direction: null,
      type: "commission",
      volume: 0,
      price: null,
      commission: -2,
    }),
    deal({
      dealNo: "3",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
      profit: 10,
    }),
  ]);
  assert.equal(result.status, "closed");
  if (result.status !== "closed") return;
  assert.equal(result.fields.commission.toString(), "-2");
  assert.equal(result.fields.netPnl.toString(), "8"); // 10 profit - 2 commission
});

test("duplicate replay is idempotent (same deal set in, same result out)", () => {
  const deals = [
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
    }),
  ];
  const first = computePositionLifecycle(deals);
  const second = computePositionLifecycle(deals);
  assert.deepEqual(first, second);
});

test("out-of-order arrival is resolved by sorting on time then dealNo, not input order", () => {
  const inOrder = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
    }),
  ]);
  const reversed = computePositionLifecycle([
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
    }),
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
  ]);
  assert.deepEqual(inOrder, reversed);
});

test("still-open position must not produce a closed record", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
  ]);
  assert.equal(result.status, "open");
});

test("no deals for the group returns no-deals, not a false close", () => {
  assert.deepEqual(computePositionLifecycle([]), { status: "no-deals" });
});

test("entry deal missing price is reported corrupted, not a silently wrong average", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      type: "buy",
      volume: 1,
      price: null,
    }),
    deal({
      dealNo: "2",
      time: 1500,
      type: "buy",
      volume: 3,
      price: 2100,
    }),
    deal({
      dealNo: "3",
      time: 2000,
      type: "sell",
      volume: 4,
      price: 2200,
    }),
  ]);
  assert.deepEqual(result, {
    status: "corrupted",
    reason: "missing-price",
    lastDealNo: "3",
  });
});

test("all entry deals missing price is reported corrupted", () => {
  const result = computePositionLifecycle([
    deal({ dealNo: "1", time: 1000, type: "buy", volume: 1, price: null }),
    deal({ dealNo: "2", time: 2000, type: "sell", volume: 1, price: 2010 }),
  ]);
  assert.deepEqual(result, {
    status: "corrupted",
    reason: "missing-price",
    lastDealNo: "2",
  });
});

test("partial close is still open even if an earlier fill was missing price", () => {
  const result = computePositionLifecycle([
    deal({ dealNo: "1", time: 1000, type: "buy", volume: 2, price: null }),
    deal({ dealNo: "2", time: 2000, type: "sell", volume: 1, price: 2010 }),
  ]);
  assert.equal(result.status, "open");
});

test("missing symbol on every deal is reported corrupted, not open", () => {
  const result = computePositionLifecycle([
    deal({ dealNo: "1", time: 1000, symbol: null, type: "buy", volume: 1, price: 2000 }),
    deal({ dealNo: "2", time: 2000, symbol: null, type: "sell", volume: 1, price: 2010 }),
  ]);
  assert.deepEqual(result, {
    status: "corrupted",
    reason: "missing-symbol",
    lastDealNo: "2",
  });
});

test("position_id reused after a full close is reported, not silently merged into one row", () => {
  const result = computePositionLifecycle([
    deal({
      dealNo: "1",
      time: 1000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2000,
    }),
    deal({
      dealNo: "2",
      time: 2000,
      direction: "out",
      type: "sell",
      volume: 1,
      price: 2010,
    }),
    // same position_id trades again after the ticket was already fully closed
    deal({
      dealNo: "3",
      time: 3000,
      direction: "in",
      type: "buy",
      volume: 1,
      price: 2020,
    }),
  ]);
  assert.deepEqual(result, { status: "ambiguous-reopen", lastDealNo: "3" });
});

function fakePrisma(
  deals: DealForReconstruction[],
  excursion: { _min: { profit: Prisma.Decimal | null }; _max: { profit: Prisma.Decimal | null } },
) {
  const positionUpserts: Array<{ create: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const aggregateCalls: unknown[] = [];
  const client = {
    deal: { findMany: async () => deals },
    positionExcursion: {
      aggregate: async (args: unknown) => {
        aggregateCalls.push(args);
        return excursion;
      },
    },
    position: {
      upsert: (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        positionUpserts.push(args);
        return Promise.resolve(args);
      },
    },
  } as unknown as PrismaClient;
  return { client, positionUpserts, aggregateCalls };
}

const closingDeals: DealForReconstruction[] = [
  deal({
    dealNo: "1",
    time: 1000,
    direction: "in",
    type: "buy",
    volume: 1,
    price: 2000,
  }),
  deal({
    dealNo: "2",
    time: 2000,
    direction: "out",
    type: "sell",
    volume: 1,
    price: 2010,
    profit: 10,
  }),
];

test("a fully closed position calls the excursion helper and persists mae/mfe on create and update", async () => {
  const mae = new Prisma.Decimal("-5");
  const mfe = new Prisma.Decimal("15");
  const { client, positionUpserts, aggregateCalls } = fakePrisma(closingDeals, {
    _min: { profit: mae },
    _max: { profit: mfe },
  });

  const result = await reconstructPositionIfClosed(
    client,
    "acct-1",
    "1000001",
    "555",
  );

  assert.equal(result.status, "closed");
  assert.equal(aggregateCalls.length, 1);
  assert.equal(positionUpserts.length, 1);
  assert.equal(positionUpserts[0].create.mae, mae);
  assert.equal(positionUpserts[0].create.mfe, mfe);
  assert.equal(positionUpserts[0].update.mae, mae);
  assert.equal(positionUpserts[0].update.mfe, mfe);
});

test("a position that never closes does not touch the excursion helper or upsert", async () => {
  const { client, positionUpserts, aggregateCalls } = fakePrisma(
    [
      deal({
        dealNo: "1",
        time: 1000,
        direction: "in",
        type: "buy",
        volume: 1,
        price: 2000,
      }),
    ],
    { _min: { profit: null }, _max: { profit: null } },
  );

  const result = await reconstructPositionIfClosed(
    client,
    "acct-1",
    "1000001",
    "555",
  );

  assert.equal(result.status, "open");
  assert.equal(aggregateCalls.length, 0);
  assert.equal(positionUpserts.length, 0);
});

test("no excursion samples for the ticket persists mae/mfe as null, not zero", async () => {
  const { client, positionUpserts } = fakePrisma(closingDeals, {
    _min: { profit: null },
    _max: { profit: null },
  });

  await reconstructPositionIfClosed(client, "acct-1", "1000001", "555");

  assert.equal(positionUpserts[0].create.mae, null);
  assert.equal(positionUpserts[0].create.mfe, null);
});

test("reprocessing the same close event is idempotent", async () => {
  const mae = new Prisma.Decimal("-5");
  const mfe = new Prisma.Decimal("15");
  const { client, positionUpserts } = fakePrisma(closingDeals, {
    _min: { profit: mae },
    _max: { profit: mfe },
  });

  await reconstructPositionIfClosed(client, "acct-1", "1000001", "555");
  await reconstructPositionIfClosed(client, "acct-1", "1000001", "555");

  assert.equal(positionUpserts.length, 2);
  assert.deepEqual(positionUpserts[0].create, positionUpserts[1].create);
  assert.deepEqual(positionUpserts[0].update, positionUpserts[1].update);
});
