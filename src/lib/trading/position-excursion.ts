import type { Prisma } from "@prisma/client";

interface PositionExcursionClient {
  positionExcursion: {
    aggregate: (args: {
      where: {
        tradingAccountId: string;
        positionTicket: string;
        ts: { gte: Date; lte: Date };
      };
      _min: { profit: true };
      _max: { profit: true };
    }) => Promise<{
      _min: { profit: Prisma.Decimal | null };
      _max: { profit: Prisma.Decimal | null };
    }>;
  };
}

export async function computePositionMaeMfe(
  db: PositionExcursionClient,
  tradingAccountId: string,
  positionTicket: string,
  openTime: Date,
  closeTime: Date,
): Promise<{ mae: Prisma.Decimal | null; mfe: Prisma.Decimal | null }> {
  const result = await db.positionExcursion.aggregate({
    where: {
      tradingAccountId,
      positionTicket,
      ts: { gte: openTime, lte: closeTime },
    },
    _min: { profit: true },
    _max: { profit: true },
  });

  return {
    mae: result._min.profit ?? null,
    mfe: result._max.profit ?? null,
  };
}
