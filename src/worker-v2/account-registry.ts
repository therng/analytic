import type { PrismaClient, TradingAccount } from "@prisma/client";

export type AccountRegistry = Map<string, TradingAccount>;

export async function loadAccountRegistry(prisma: PrismaClient): Promise<AccountRegistry> {
  const rows = await prisma.tradingAccount.findMany();
  const registry: AccountRegistry = new Map();
  for (const row of rows) {
    if (row.brokerUtcOffsetMinutes === null || row.brokerUtcOffsetMinutes === undefined) continue;
    registry.set(row.accountNo, row);
  }
  return registry;
}

export function resolveAccountByLogin(
  registry: AccountRegistry,
  login: number | string,
): TradingAccount | null {
  return registry.get(String(login)) ?? null;
}
