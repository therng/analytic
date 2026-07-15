import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";

import { getDatabaseErrorDetails } from "../src/lib/database-errors";

const prisma = new PrismaClient();
const ZERO = new Prisma.Decimal(0);
const APPLY = process.argv.includes("--apply");
const PREVIEW_LIMIT = 20;

const zeroPriceWhere = {
  closeTime: {
    not: null,
  },
  openPrice: ZERO,
  closePrice: ZERO,
} as const;

const slTpCorruptionSql = Prisma.sql`
  "close_time" IS NOT NULL
  AND "profit" = 0
  AND "comment" IS NOT NULL
  AND (
    "comment" ILIKE '[sl %'
    OR "comment" ILIKE '[tp %'
  )
  AND "open_price" IS NOT NULL
  AND "close_price" IS NOT NULL
  AND "open_price" = "close_price"
  AND "commission" = "close_price"
`;

const combinedCorruptionSql = Prisma.sql`
  (
    "close_time" IS NOT NULL
    AND "open_price" = 0
    AND "close_price" = 0
  )
  OR (
    ${slTpCorruptionSql}
  )
`;

async function getZeroPriceMetrics() {
  const [count, sampleRows] = await Promise.all([
    prisma.position.count({ where: zeroPriceWhere }),
    prisma.position.findMany({
      where: zeroPriceWhere,
      take: Math.floor(PREVIEW_LIMIT / 2),
      orderBy: [{ reportDate: "desc" }, { positionNo: "asc" }],
      select: {
        id: true,
        positionNo: true,
        reportDate: true,
        comment: true,
        tradingAccount: {
          select: { accountNo: true },
        },
      },
    }),
  ]);
  return { count, sampleRows };
}

async function getSlTpMetrics() {
  const [countResult, previewRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "Position"
      WHERE ${slTpCorruptionSql}
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        positionNo: string;
        reportDate: Date;
        comment: string | null;
        accountNo: string;
      }>
    >(Prisma.sql`
      SELECT
        p."id",
        p."position_no" AS "positionNo",
        p."report_date" AS "reportDate",
        p."comment",
        a."account_number" AS "accountNo"
      FROM "Position" p
      JOIN "Account" a ON a."id" = p."account_id"
      WHERE ${slTpCorruptionSql}
      ORDER BY p."report_date" DESC, p."position_no" ASC
      LIMIT ${Math.ceil(PREVIEW_LIMIT / 2)}
    `),
  ]);

  const count = Number(countResult[0]?.count ?? 0n);
  return { count, previewRows };
}

function displayPreview(zeroMetrics: any, slTpMetrics: any) {
  const previewRows = [
    ...zeroMetrics.sampleRows.map((row: any) => ({
      accountNo: row.tradingAccount.accountNo,
      comment: row.comment,
      id: row.id,
      positionNo: row.positionNo,
      reportDate: row.reportDate,
    })),
    ...slTpMetrics.previewRows,
  ].slice(0, PREVIEW_LIMIT);

  if (previewRows.length > 0) {
    console.log(`Previewing up to ${PREVIEW_LIMIT} affected row(s):`);
    for (const row of previewRows) {
      console.log(
        `- account=${row.accountNo} position=${row.positionNo} reportDate=${row.reportDate.toISOString()} id=${row.id} comment=${row.comment ?? ""}`,
      );
    }
  }
}

async function performRemediation() {
  const deleted = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "Position"
    WHERE ${combinedCorruptionSql}
  `);

  const [remainingZeroPrice, remainingSlTp] = await Promise.all([
    prisma.position.count({ where: zeroPriceWhere }),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "Position"
      WHERE ${slTpCorruptionSql}
    `),
  ]);
  const remaining = remainingZeroPrice + Number(remainingSlTp[0]?.count ?? 0n);

  console.log(
    `Deleted ${deleted} corrupted Position row(s). Remaining=${remaining}.`,
  );

  if (remaining > 0) {
    throw new Error(
      `Remediation incomplete: ${remaining} corrupted Position row(s) still remain.`,
    );
  }
}

async function main() {
  console.log(
    `Scanning for corrupted closed Position rows${APPLY ? " (apply mode)" : " (dry run)"}...`,
  );

  const [zeroMetrics, slTpMetrics] = await Promise.all([
    getZeroPriceMetrics(),
    getSlTpMetrics(),
  ]);

  const total = zeroMetrics.count + slTpMetrics.count;

  console.log(`Matched ${total} corrupted closed Position row(s).`);
  console.log(`- zero-price signature: ${zeroMetrics.count}`);
  console.log(
    `- stop-loss/take-profit misaligned signature: ${slTpMetrics.count}`,
  );

  displayPreview(zeroMetrics, slTpMetrics);

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to delete these rows.");
    return;
  }

  if (total === 0) {
    console.log("Nothing to delete.");
    return;
  }

  await performRemediation();
}

void main()
  .catch((error) => {
    const details = getDatabaseErrorDetails(
      error,
      "Position remediation failed.",
    );
    console.error(details.message);
    if (details.status !== 503) {
      console.error("Position remediation failed:", error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
