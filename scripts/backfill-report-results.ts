import { getDatabaseErrorDetails } from "../src/lib/database-errors";
import { prisma } from "../src/lib/prisma";
import { recomputeAccountReportResult } from "../src/lib/trading/calculate-report-results";

const prismaClient = prisma as any;

async function main() {
  const accounts = await prismaClient.tradingAccount.findMany({
    select: {
      id: true,
      accountNo: true,
      reportDate: true,
    },
    orderBy: {
      accountNo: "asc",
    },
  });

  console.log(
    `Backfilling report results for ${accounts.length} account(s)...`,
  );

  for (const account of accounts) {
    console.log(`Recomputing account ${account.accountNo}...`);
    await recomputeAccountReportResult(account.id, account.reportDate ?? null);
  }

  console.log("Backfill complete.");
}

void main()
  .catch((error) => {
    const details = getDatabaseErrorDetails(error, "Backfill failed.");
    console.error(details.message);
    if (details.status !== 503) {
      console.error("Backfill failed:", error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
