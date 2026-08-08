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
  let lastKnownSize = registry.size;
  while (!opts.signal.aborted) {
    await abortableDelay(opts.intervalMs, opts.signal);
    if (opts.signal.aborted) return;
    try {
      await opts.provisionAccounts();
      replaceAccountRegistry(registry, await loadAccountRegistry(prisma));
      // Log only on a 0<->N transition, not every refresh cycle — this loop
      // is expected to run every WORKER_V2_ACCOUNT_REFRESH_MS (default 60s)
      // indefinitely, so per-cycle logging at steady state would be noise.
      // The transition is the actionable signal: it tells an operator
      // staring at a "deals/orders stale, accounts tracked: 0" health
      // snapshot whether the registry ever recovers on its own.
      if (lastKnownSize === 0 && registry.size > 0) {
        console.info(
          `[worker-v2] account registry populated: 0 -> ${registry.size} accounts; deals/orders history-stream fleet will start consuming on the next poll`,
        );
      } else if (lastKnownSize > 0 && registry.size === 0) {
        console.warn(
          `[worker-v2] account registry became empty: ${lastKnownSize} -> 0 accounts`,
        );
      }
      lastKnownSize = registry.size;
    } catch (error) {
      console.error("[worker-v2] account registry refresh failed:", error);
    }
  }
}
