import { prisma } from "@/lib/prisma";

export interface ResolvedTradingAccount {
  id: string;
  accountNo: string;
}

/**
 * Resolves a dashboard account identifier that may be either the internal
 * Prisma `id` (cuid) or the MT5 login (`accountNo`) into both. Every current
 * dashboard caller passes the cuid, but Redis keys and worker registries are
 * keyed on `accountNo` — this is the single place that bridges the two,
 * replacing what used to be 4 independent (and inconsistent) lookups.
 */
export async function resolveTradingAccount(
  idOrAccountNo: string,
): Promise<ResolvedTradingAccount | null> {
  return prisma.tradingAccount.findFirst({
    where: { OR: [{ id: idOrAccountNo }, { accountNo: idOrAccountNo }] },
    select: { id: true, accountNo: true },
  });
}
