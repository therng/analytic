import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import {
  HISTORY_START,
  countAccountStreamEntries,
  recoverInitialHistoryState,
  type RedisRecoveryClient,
} from "../src/worker-v2/history-recovery";

const CONFIRMATION = "RESET_HISTORY";

type CliOptions = {
  accountNos: string[];
  confirmed: boolean;
  help: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run history:reset -- [--account <accountNo>] [--confirm RESET_HISTORY]",
    "",
    "Without --confirm, prints a read-only preview.",
    "Repeat --account to target multiple accounts; omit it to target all accounts.",
    "Stop MT5Bridge, worker, and worker-v2 before a confirmed reset.",
  ].join("\n");
}

export function parseArgs(args: string[]): CliOptions {
  const accountNos: string[] = [];
  let confirmed = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--account") {
      const accountNo = args[index + 1];
      if (!accountNo || accountNo.startsWith("--")) {
        throw new Error("--account requires an account number");
      }
      accountNos.push(accountNo);
      index += 1;
      continue;
    }
    if (arg === "--confirm") {
      const value = args[index + 1];
      if (value !== CONFIRMATION) {
        throw new Error(`--confirm must be exactly ${CONFIRMATION}`);
      }
      confirmed = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { accountNos: [...new Set(accountNos)], confirmed, help };
}

async function loadAccounts(
  prisma: PrismaClient,
  accountNos: string[],
) {
  const accounts = await prisma.tradingAccount.findMany({
    where:
      accountNos.length > 0
        ? { accountNo: { in: accountNos } }
        : undefined,
    include: {
      bridgeHistoryCheckpoint: true,
      _count: { select: { bridgeHistoryChunks: true } },
    },
    orderBy: { accountNo: "asc" },
  });
  const found = new Set(accounts.map((account) => account.accountNo));
  const missing = accountNos.filter((accountNo) => !found.has(accountNo));
  if (missing.length > 0) {
    throw new Error(`unknown account number(s): ${missing.join(", ")}`);
  }
  if (accounts.length === 0) {
    throw new Error("no trading accounts found");
  }
  return accounts;
}

function printPreview(
  accounts: Awaited<ReturnType<typeof loadAccounts>>,
): void {
  console.table(
    accounts.map((account) => ({
      accountNo: account.accountNo,
      phase: account.bridgeHistoryCheckpoint?.phase ?? "missing",
      completedThrough:
        account.bridgeHistoryCheckpoint?.completedThroughServerTime?.toString() ??
        "missing",
      chunks: account._count.bridgeHistoryChunks,
      resetTo: HISTORY_START.toString(),
    })),
  );
}

async function verifyReset(
  prisma: PrismaClient,
  redis: ReturnType<typeof createClient>,
  accountNos: string[],
): Promise<void> {
  const rows = await prisma.tradingAccount.findMany({
    where: { accountNo: { in: accountNos } },
    include: {
      bridgeHistoryCheckpoint: true,
      _count: { select: { bridgeHistoryChunks: true } },
    },
  });

  for (const account of rows) {
    const checkpoint = account.bridgeHistoryCheckpoint;
    if (
      !checkpoint ||
      checkpoint.completedThroughServerTime !== HISTORY_START ||
      checkpoint.lastCompletedChunkId !== null ||
      account._count.bridgeHistoryChunks !== 0
    ) {
      throw new Error(
        `PostgreSQL verification failed for account ${account.accountNo}`,
      );
    }
    const rawAck = await redis.get(
      `mt5:v2:history:${account.accountNo}:ack`,
    );
    const ack = rawAck ? JSON.parse(rawAck) : null;
    if (
      !ack ||
      String(ack.completedThroughServerTime) !== HISTORY_START.toString() ||
      ack.lastCompletedChunkId !== null
    ) {
      throw new Error(
        `Redis acknowledgement verification failed for account ${account.accountNo}`,
      );
    }
    const staleKeys = await Promise.all(
      ["pending-window", "cursor", "watermark"].map((suffix) =>
        redis.exists(`mt5:v2:history:${account.accountNo}:${suffix}`),
      ),
    );
    if (staleKeys.some((exists) => exists !== 0)) {
      throw new Error(
        `Redis stale-key verification failed for account ${account.accountNo}`,
      );
    }
    const streamEntries = await countAccountStreamEntries(
      redis as unknown as RedisRecoveryClient,
      account.accountNo,
    );
    if (streamEntries !== 0) {
      throw new Error(
        `Redis stream verification found ${streamEntries} stale entries for account ${account.accountNo}`,
      );
    }
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }

  const prisma = new PrismaClient();
  let redis: ReturnType<typeof createClient> | null = null;
  try {
    const accounts = await loadAccounts(prisma, options.accountNos);
    printPreview(accounts);
    if (!options.confirmed) {
      console.log(
        `Preview only. Re-run with --confirm ${CONFIRMATION} after stopping MT5Bridge, worker, and worker-v2.`,
      );
      return;
    }
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is required for a confirmed history reset");
    }

    redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    const repaired = await recoverInitialHistoryState(
      prisma,
      redis as unknown as RedisRecoveryClient,
      accounts,
      { force: true, clearWatermark: true },
    );
    if (repaired !== accounts.length) {
      throw new Error(
        `history reset repaired ${repaired}/${accounts.length} accounts`,
      );
    }
    const accountNos = accounts.map((account) => account.accountNo);
    await verifyReset(prisma, redis, accountNos);
    console.log(
      `History reset verified for ${accountNos.length} account(s): ${accountNos.join(", ")}`,
    );
  } finally {
    await Promise.allSettled([
      redis?.isOpen ? redis.quit() : Promise.resolve(),
      prisma.$disconnect(),
    ]);
  }
}

const invokedPath = process.argv[1] ?? "";
if (invokedPath.endsWith("/scripts/reset-history.ts")) {
  main().catch((error) => {
    console.error(
      "History reset failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
