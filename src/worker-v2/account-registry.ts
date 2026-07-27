import type { PrismaClient, TradingAccount } from "@prisma/client";
import { abortableDelay } from "./background-loop";

export type AccountRegistry = Map<string, TradingAccount>;

export async function loadAccountRegistry(
  prisma: PrismaClient,
): Promise<AccountRegistry> {
  const rows = await prisma.tradingAccount.findMany();
  const registry: AccountRegistry = new Map();
  for (const row of rows) {
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

export function replaceAccountRegistry(
  registry: AccountRegistry,
  next: AccountRegistry,
): void {
  registry.clear();
  for (const [key, value] of next) {
    registry.set(key, value);
  }
}

export async function runAccountRegistryRefreshLoop(
  prisma: PrismaClient,
  registry: AccountRegistry,
  opts: {
    intervalMs: number;
    signal: AbortSignal;
    provisionAccounts: () => Promise<unknown>;
  },
): Promise<void> {
  while (!opts.signal.aborted) {
    await abortableDelay(opts.intervalMs, opts.signal);
    if (opts.signal.aborted) return;
    try {
      await opts.provisionAccounts();
      replaceAccountRegistry(registry, await loadAccountRegistry(prisma));
    } catch (error) {
      console.error("[worker-v2] account registry refresh failed:", error);
    }
  }
}
