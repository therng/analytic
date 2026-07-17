import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { computePositionMaeMfe } from "./position-excursion";

function fakeClient(aggregateResult: {
  _min: { profit: Prisma.Decimal | null };
  _max: { profit: Prisma.Decimal | null };
}) {
  const calls: unknown[] = [];
  return {
    client: {
      positionExcursion: {
        aggregate: async (args: unknown) => {
          calls.push(args);
          return aggregateResult;
        },
      },
    },
    calls,
  };
}

test("maps _min.profit to mae and _max.profit to mfe", async () => {
  const mae = new Prisma.Decimal("-12.5");
  const mfe = new Prisma.Decimal("40.25");
  const { client } = fakeClient({ _min: { profit: mae }, _max: { profit: mfe } });

  const result = await computePositionMaeMfe(
    client,
    "acct-1",
    "555",
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-07-01T01:00:00Z"),
  );

  assert.equal(result.mae, mae);
  assert.equal(result.mfe, mfe);
  assert.equal(result.mae?.toString(), "-12.5");
  assert.equal(result.mfe?.toString(), "40.25");
});

test("returns null for both when no samples match", async () => {
  const { client } = fakeClient({ _min: { profit: null }, _max: { profit: null } });

  const result = await computePositionMaeMfe(
    client,
    "acct-1",
    "555",
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-07-01T01:00:00Z"),
  );

  assert.equal(result.mae, null);
  assert.equal(result.mfe, null);
});

test("filters by tradingAccountId, positionTicket, and an inclusive ts range", async () => {
  const openTime = new Date("2026-07-01T00:00:00Z");
  const closeTime = new Date("2026-07-01T01:00:00Z");
  const { client, calls } = fakeClient({
    _min: { profit: null },
    _max: { profit: null },
  });

  await computePositionMaeMfe(client, "acct-1", "555", openTime, closeTime);

  assert.equal(calls.length, 1);
  const args = calls[0] as {
    where: {
      tradingAccountId: string;
      positionTicket: string;
      ts: { gte: Date; lte: Date };
    };
    _min: { profit: true };
    _max: { profit: true };
  };
  assert.equal(args.where.tradingAccountId, "acct-1");
  assert.equal(args.where.positionTicket, "555");
  assert.equal(args.where.ts.gte, openTime);
  assert.equal(args.where.ts.lte, closeTime);
  assert.deepEqual(args._min, { profit: true });
  assert.deepEqual(args._max, { profit: true });
});
