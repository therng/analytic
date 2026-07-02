import { prisma } from "../src/lib/prisma";

const PROFIT_TOLERANCE = 0.01;

async function comparePositions(tradingAccountId: string, accountNo: string) {
  const [ftpRows, bridgeRows] = await Promise.all([
    prisma.position.findMany({ where: { tradingAccountId } }),
    prisma.bridgePosition.findMany({ where: { tradingAccountId } }),
  ]);

  const bridgeByPositionNo = new Map(bridgeRows.map((r) => [r.positionNo, r]));
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const ftpRow of ftpRows) {
    const bridgeRow = bridgeByPositionNo.get(ftpRow.positionNo);
    if (!bridgeRow) {
      missing.push(ftpRow.positionNo);
      continue;
    }
    const profitDelta = Math.abs(Number(ftpRow.profit) - Number(bridgeRow.profit));
    if (profitDelta > PROFIT_TOLERANCE) {
      mismatched.push(`${ftpRow.positionNo} (ftp=${ftpRow.profit}, bridge=${bridgeRow.profit})`);
    }
  }

  console.log(`\n[${accountNo}] Position comparison:`);
  console.log(`  FTP rows: ${ftpRows.length}, Bridge rows: ${bridgeRows.length}`);
  console.log(`  Missing from bridge: ${missing.length ? missing.join(", ") : "none"}`);
  console.log(`  Profit mismatches (> $${PROFIT_TOLERANCE}): ${mismatched.length ? mismatched.join(", ") : "none"}`);

  return { missing: missing.length, mismatched: mismatched.length };
}

async function compareDeals(tradingAccountId: string, accountNo: string) {
  const [ftpRows, bridgeRows] = await Promise.all([
    prisma.deal.findMany({ where: { tradingAccountId } }),
    prisma.bridgeDeal.findMany({ where: { tradingAccountId } }),
  ]);

  const bridgeByDealNo = new Map(bridgeRows.map((r) => [r.dealNo, r]));
  const missing = ftpRows.filter((r) => !bridgeByDealNo.has(r.dealNo)).map((r) => r.dealNo);

  console.log(`[${accountNo}] Deal comparison:`);
  console.log(`  FTP rows: ${ftpRows.length}, Bridge rows: ${bridgeRows.length}`);
  console.log(`  Missing from bridge: ${missing.length ? missing.join(", ") : "none"}`);

  return { missing: missing.length };
}

async function main() {
  const accounts = await prisma.tradingAccount.findMany({ select: { id: true, accountNo: true } });
  let totalIssues = 0;

  for (const account of accounts) {
    const posResult = await comparePositions(account.id, account.accountNo);
    const dealResult = await compareDeals(account.id, account.accountNo);
    totalIssues += posResult.missing + posResult.mismatched + dealResult.missing;
  }

  console.log(`\nTotal issues across ${accounts.length} account(s): ${totalIssues}`);
  process.exit(totalIssues > 0 ? 1 : 0);
}

main()
  .catch((error) => {
    console.error("compare-bridge-ftp failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
