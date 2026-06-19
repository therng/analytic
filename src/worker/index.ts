import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import { Client } from "basic-ftp";
import { Prisma } from "@prisma/client";

import { parseReport } from "../lib/parser";
import { prisma } from "../lib/prisma";
import { recomputeAccountReportResult } from "../lib/trading/calculate-report-results";
import { startHealthServer, WorkerHeartbeat } from "./health";

const prismaClient = prisma as any;

const FTP_HOST = process.env.FTP_HOST || "therng.thddns.net";
const FTP_PORT = Number.parseInt(process.env.FTP_PORT || "21", 10);
const FTP_USER = process.env.FTP_USER || "supachai";
const FTP_PASS = process.env.FTP_PASS || "9717";
const FTP_PATH = process.env.FTP_PATH ?? "";
const REPORT_SOURCE = process.env.REPORT_SOURCE || "ftp";
const LOCAL_REPORT_DIR = process.env.LOCAL_REPORT_DIR || path.join(process.cwd(), "data", "source-reports");
const WORKER_POLL_MS = Number.parseInt(process.env.WORKER_POLL_MS || "150000", 10);
const FILE_STABLE_MS = Number.parseInt(process.env.WORKER_FILE_STABLE_MS || "60000", 10);
const MIN_FILE_SIZE_BYTES = Number.parseInt(process.env.WORKER_MIN_FILE_SIZE_BYTES || "1024", 10);
const RUN_ONCE = process.env.WORKER_RUN_ONCE === "true";
const FORCE_REIMPORT = process.env.WORKER_FORCE_REIMPORT === "true";
const HEALTH_PORT = Number.parseInt(process.env.WORKER_HEALTH_PORT || "9100", 10);
// Allow one in-flight poll plus a margin before declaring the loop stale.
const HEALTH_STALE_MS = Number.parseInt(
  process.env.WORKER_HEALTH_STALE_MS || String(WORKER_POLL_MS * 2 + 60_000),
  10,
);
const LEGACY_REPORT_TIME_SHIFT_MS = 7 * 60 * 60 * 1000;

function decodeReportBuffer(buffer: Buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le");
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let index = 0; index < swapped.length - 1; index += 2) {
      [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
    }
    return swapped.toString("utf16le");
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf8", 3);
  }

  return buffer.toString("utf8");
}

async function downloadFile(client: Client, fileName: string) {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  await client.downloadTo(writable, fileName);
  return Buffer.concat(chunks);
}

function isHtmlReportFile(file: { name: string }) {
  return file.name.endsWith(".html") && !file.name.startsWith("._");
}

function shouldReadFile(file: { name: string; size?: number; modifiedAt?: Date }) {
  if (!isHtmlReportFile(file)) {
    return false;
  }

  if (typeof file.size === "number" && file.size > 0 && file.size < MIN_FILE_SIZE_BYTES) {
    return false;
  }

  if (file.modifiedAt instanceof Date && Number.isFinite(file.modifiedAt.getTime())) {
    const ageMs = Date.now() - file.modifiedAt.getTime();
    if (ageMs < FILE_STABLE_MS) {
      return false;
    }
  }

  return true;
}

function toDecimal(value: number | null | undefined) {
  const normalized = Number(value);
  return new Prisma.Decimal(Number.isFinite(normalized) ? normalized : 0);
}

function toDecimalOrNull(value: number | null | undefined) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return new Prisma.Decimal(normalized);
}

function normalizeRequiredText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = normalizeRequiredText(value);
  return normalized ? normalized : null;
}

function normalizeDate(value: Date | null | undefined) {
  if (!(value instanceof Date)) {
    return null;
  }

  return Number.isFinite(value.getTime()) ? value : null;
}

function normalizeNumber(value: number | null | undefined, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function isSameInstant(left: Date | null | undefined, right: Date | null | undefined) {
  if (!(left instanceof Date) || !(right instanceof Date)) {
    return false;
  }

  const delta = Math.abs(left.getTime() - right.getTime());
  return delta === 0 || delta === LEGACY_REPORT_TIME_SHIFT_MS;
}

function compareInstants(left: Date | null | undefined, right: Date | null | undefined) {
  const leftTime = left instanceof Date ? left.getTime() : Number.NaN;
  const rightTime = right instanceof Date ? right.getTime() : Number.NaN;

  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
    return 0;
  }

  if (!Number.isFinite(leftTime)) {
    return -1;
  }

  if (!Number.isFinite(rightTime)) {
    return 1;
  }

  return leftTime - rightTime;
}

function isSameOrNewerReportDate(incoming: Date, existing: Date | null | undefined) {
  if (compareInstants(incoming, existing) >= 0) {
    return true;
  }

  return isSameInstant(incoming, existing);
}

async function importReport(fileName: string, htmlContent: string) {
  const parsedData = parseReport(htmlContent);
  const accountNumber = normalizeRequiredText(parsedData.metadata.account_number);
  if (!accountNumber) {
    console.warn(`Skipping ${fileName}: account number is missing from report metadata.`);
    return "skipped" as const;
  }

  const reportDate = normalizeDate(parsedData.metadata.report_timestamp);
  if (!reportDate) {
    console.warn(`Skipping ${fileName}: report timestamp is missing or invalid for account ${accountNumber}.`);
    return "skipped" as const;
  }

  const ownerName = normalizeOptionalText(parsedData.metadata.owner_name);
  const company = normalizeOptionalText(parsedData.metadata.company);
  const currency = normalizeRequiredText(parsedData.metadata.currency) || "USD";
  const server = normalizeRequiredText(parsedData.metadata.server) || "UNKNOWN";
  const fileHash = createHash("sha256").update(htmlContent).digest("hex");

  console.log(
    `Parsed ${fileName}: account=${accountNumber} reportDate=${reportDate.toISOString()} open=${parsedData.openPositions.length} positions=${parsedData.positions.length} deals=${parsedData.dealLedger.length}`,
  );

  const existingAccount = await prismaClient.tradingAccount.findUnique({
    where: { accountNo: accountNumber },
    select: {
      id: true,
      reportDate: true,
      accountSnapshot: {
        select: {
          reportDate: true,
        },
      },
      reportImports: {
        where: { fileHash },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!FORCE_REIMPORT && existingAccount?.reportImports.length) {
    console.log(
      `Skipping ${fileName}: duplicate file hash for account=${accountNumber} reportDate=${reportDate.toISOString()} hash=${fileHash}.`,
    );
    return "skipped" as const;
  }

  const replacingCurrentSnapshot = isSameInstant(existingAccount?.accountSnapshot?.reportDate, reportDate);
  if (replacingCurrentSnapshot) {
    console.log(
      `Refreshing ${fileName}: replacing current snapshot for account=${accountNumber} reportDate=${reportDate.toISOString()}.`,
    );
  }

  const shouldRefreshCurrentSnapshot = isSameOrNewerReportDate(reportDate, existingAccount?.accountSnapshot?.reportDate);
  const shouldAdvanceAccountReportDate = isSameOrNewerReportDate(reportDate, existingAccount?.reportDate);

  if (!shouldRefreshCurrentSnapshot) {
    console.log(
      `Historical import ${fileName}: keeping current snapshot for account=${accountNumber} at ${existingAccount?.accountSnapshot?.reportDate?.toISOString() ?? "n/a"} because incoming reportDate=${reportDate.toISOString()} is older.`,
    );
  }

  const importedAccountId = await prismaClient.$transaction(async (tx: any) => {
    const account = await tx.tradingAccount.upsert({
      where: { accountNo: accountNumber },
      update: {
        accountName: ownerName,
        company,
        currency,
        serverName: server,
        reportDate: shouldAdvanceAccountReportDate ? reportDate : existingAccount?.reportDate ?? null,
      },
      create: {
        accountNo: accountNumber,
        accountName: ownerName,
        company,
        currency,
        serverName: server,
        reportDate,
      },
    });

    await tx.reportImport.upsert({
      where: {
        tradingAccountId_fileHash: {
          tradingAccountId: account.id,
          fileHash,
        },
      },
      update: {
        fileName,
        reportDate,
      },
      create: {
        tradingAccountId: account.id,
        fileName,
        fileHash,
        reportDate,
      },
    });

    await tx.equityHistory.upsert({
      where: {
        tradingAccountId_reportDate: {
          tradingAccountId: account.id,
          reportDate,
        },
      },
      update: {
        equity: toDecimal(parsedData.accountSummary.equity),
        balance: toDecimal(parsedData.accountSummary.balance),
        floatingPl: toDecimal(parsedData.accountSummary.floating_pl),
      },
      create: {
        tradingAccountId: account.id,
        reportDate,
        equity: toDecimal(parsedData.accountSummary.equity),
        balance: toDecimal(parsedData.accountSummary.balance),
        floatingPl: toDecimal(parsedData.accountSummary.floating_pl),
      },
    });

    if (shouldRefreshCurrentSnapshot) {
      await tx.accountSnapshot.upsert({
        where: { tradingAccountId: account.id },
        update: {
          sourceFileName: fileName,
          balance: toDecimal(parsedData.accountSummary.balance),
          creditFacility: toDecimal(parsedData.accountSummary.credit_facility ?? 0),
          freeMargin: toDecimal(parsedData.accountSummary.free_margin),
          margin: toDecimal(parsedData.accountSummary.margin),
          floatingPl: toDecimal(parsedData.accountSummary.floating_pl),
          marginLevel:
            Number.isFinite(parsedData.accountSummary.margin_level) && parsedData.accountSummary.margin_level !== 0
              ? parsedData.accountSummary.margin_level
              : null,
          equity: toDecimal(parsedData.accountSummary.equity),
          reportDate,
        },
        create: {
          tradingAccountId: account.id,
          sourceFileName: fileName,
          balance: toDecimal(parsedData.accountSummary.balance),
          creditFacility: toDecimal(parsedData.accountSummary.credit_facility ?? 0),
          freeMargin: toDecimal(parsedData.accountSummary.free_margin),
          margin: toDecimal(parsedData.accountSummary.margin),
          floatingPl: toDecimal(parsedData.accountSummary.floating_pl),
          marginLevel:
            Number.isFinite(parsedData.accountSummary.margin_level) && parsedData.accountSummary.margin_level !== 0
              ? parsedData.accountSummary.margin_level
              : null,
          equity: toDecimal(parsedData.accountSummary.equity),
          reportDate,
        },
      });

      await tx.openPosition.deleteMany({
        where: { tradingAccountId: account.id },
      });

      if (parsedData.openPositions.length) {
        await tx.openPosition.createMany({
          data: parsedData.openPositions.map((position) => ({
            tradingAccountId: account.id,
            positionNo: position.positionId,
            openTime: position.openedAt,
            symbol: position.symbol || "UNKNOWN",
            type: position.side || "UNKNOWN",
            volume: normalizeNumber(position.volume),
            price: toDecimal(position.openPrice),
            sl: toDecimalOrNull(position.sl),
            tp: toDecimalOrNull(position.tp),
            marketPrice: toDecimal(position.marketPrice),
            swap: toDecimal(position.swap ?? 0),
            profit: toDecimal(position.floatingProfit ?? 0),
            comment: position.comment ?? null,
            reportDate,
          })),
        });
      }
    }

    const incomingPositionIds = parsedData.positions.map((position) => position.positionNo);
    const existingPositions = incomingPositionIds.length
      ? await tx.position.findMany({
          where: {
            tradingAccountId: account.id,
            positionNo: { in: incomingPositionIds },
          },
          select: {
            positionNo: true,
            reportDate: true,
          },
        })
      : [];

    const existingPositionReportDates = new Map<string, Date>(
      existingPositions.map((position: { positionNo: string; reportDate: Date }) => [position.positionNo, position.reportDate]),
    );

    const positionsToCreate = [];
    const positionsToUpdate = [];

    for (const position of parsedData.positions) {
      const payload = {
        symbol: position.symbol || "UNKNOWN",
        type: position.type || "UNKNOWN",
        volume: normalizeNumber(position.volume),
        openTime: position.openTime ?? null,
        openPrice: toDecimalOrNull(position.openPrice),
        sl: toDecimalOrNull(position.sl),
        tp: toDecimalOrNull(position.tp),
        closeTime: position.closeTime ?? null,
        closePrice: toDecimalOrNull(position.closePrice),
        commission: toDecimal(position.commission ?? 0),
        swap: toDecimal(position.swap ?? 0),
        profit: toDecimal(position.profit ?? 0),
        comment: position.comment ?? null,
        reportDate,
      };

      const existingReportDate = existingPositionReportDates.get(position.positionNo);
      if (!existingReportDate) {
        positionsToCreate.push({
          tradingAccountId: account.id,
          positionNo: position.positionNo,
          ...payload,
        });
        continue;
      }

      if (isSameOrNewerReportDate(reportDate, existingReportDate)) {
        positionsToUpdate.push({
          positionNo: position.positionNo,
          payload,
        });
      }
    }

    if (positionsToCreate.length) {
      await tx.position.createMany({
        data: positionsToCreate,
        skipDuplicates: true,
      });
    }

    for (const position of positionsToUpdate) {
      await tx.position.update({
        where: {
          tradingAccountId_positionNo: {
            tradingAccountId: account.id,
            positionNo: position.positionNo,
          },
        },
        data: position.payload,
      });
    }

    const incomingDealIds = parsedData.dealLedger.map((deal) => deal.dealId);
    const existingDeals = incomingDealIds.length
      ? await tx.deal.findMany({
          where: {
            tradingAccountId: account.id,
            dealNo: { in: incomingDealIds },
          },
          select: {
            dealNo: true,
            reportDate: true,
          },
        })
      : [];

    const existingDealReportDates = new Map<string, Date>(
      existingDeals.map((deal: { dealNo: string; reportDate: Date }) => [deal.dealNo, deal.reportDate]),
    );

    const dealsToCreate = [];
    const dealsToUpdate = [];

    for (const deal of parsedData.dealLedger) {
      const payload = {
        time: deal.time,
        symbol: deal.symbol ?? null,
        type: deal.type || "UNKNOWN",
        direction: deal.direction ?? null,
        volume: deal.volume ?? null,
        price: toDecimalOrNull(deal.price),
        commission: toDecimal(deal.commission ?? 0),
        fee: toDecimal(deal.fee ?? 0),
        swap: toDecimal(deal.swap ?? 0),
        profit: toDecimal(deal.profit ?? 0),
        balance: toDecimalOrNull(deal.balanceAfter),
        comment: deal.comment ?? null,
        reportDate,
      };

      const existingReportDate = existingDealReportDates.get(deal.dealId);
      if (!existingReportDate) {
        dealsToCreate.push({
          tradingAccountId: account.id,
          dealNo: deal.dealId,
          ...payload,
        });
        continue;
      }

      if (isSameOrNewerReportDate(reportDate, existingReportDate)) {
        dealsToUpdate.push({
          dealNo: deal.dealId,
          payload,
        });
      }
    }

    if (dealsToCreate.length) {
      await tx.deal.createMany({
        data: dealsToCreate,
        skipDuplicates: true,
      });
    }

    // Large historical reports can carry tens of thousands of deals to
    // update. Awaiting each update sequentially blows past the interactive
    // transaction timeout, so apply them in bounded-concurrency batches.
    const DEAL_UPDATE_BATCH = 100;
    for (let i = 0; i < dealsToUpdate.length; i += DEAL_UPDATE_BATCH) {
      const batch = dealsToUpdate.slice(i, i + DEAL_UPDATE_BATCH);
      await Promise.all(
        batch.map((deal) =>
          tx.deal.update({
            where: {
              tradingAccountId_dealNo: {
                tradingAccountId: account.id,
                dealNo: deal.dealNo,
              },
            },
            data: deal.payload,
          }),
        ),
      );
    }

    return account.id as string;
  }, {
    maxWait: 15_000,
    timeout: 120_000,
  });

  await recomputeAccountReportResult(importedAccountId, reportDate);

  console.log(`Successfully saved ${fileName}.`);
  return "imported" as const;
}

type ReportStats = {
  found: number;
  ready: number;
  deferred: number;
  imported: number;
  skipped: number;
  failed: number;
};

type ReportFile = {
  name: string;
  size?: number;
  modifiedAt?: Date;
};

async function listLocalReportFiles() {
  let entries;
  try {
    entries = await readdir(LOCAL_REPORT_DIR, {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      console.warn(`Local report directory ${LOCAL_REPORT_DIR} does not exist yet. Nothing to import.`);
      return [];
    }
    throw error;
  }

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(LOCAL_REPORT_DIR, entry.name);
        const stats = await stat(filePath);
        return {
          name: entry.name,
          size: stats.size,
          modifiedAt: stats.mtime,
        } satisfies ReportFile;
      }),
  );

  return files.sort((left, right) => left.name.localeCompare(right.name));
}

async function readLocalReportFile(fileName: string) {
  const filePath = path.join(LOCAL_REPORT_DIR, fileName);
  return readFile(filePath);
}

export async function processReports(): Promise<ReportStats | null> {
  if (REPORT_SOURCE === "local") {
    console.log(`Reading reports from local directory ${LOCAL_REPORT_DIR}...`);

    let files: ReportFile[];
    try {
      files = await listLocalReportFiles();
    } catch (error) {
      console.error(`Could not read local report directory ${LOCAL_REPORT_DIR}:`, error);
      return null;
    }

    const htmlFiles = files.filter(isHtmlReportFile);
    const readyFiles = htmlFiles.filter(shouldReadFile);
    const deferredFiles = htmlFiles.filter((file) => !shouldReadFile(file));

    const stats = {
      found: htmlFiles.length,
      ready: readyFiles.length,
      deferred: deferredFiles.length,
      imported: 0,
      skipped: 0,
      failed: 0,
    };

    console.log(
      `Found ${htmlFiles.length} local HTML reports. Ready=${readyFiles.length} deferred=${deferredFiles.length} stableMs=${FILE_STABLE_MS}`,
    );

    if (deferredFiles.length > 0) {
      console.log(`Deferring recent or incomplete local files: ${deferredFiles.map((file) => file.name).join(", ")}`);
    }

    for (const file of readyFiles) {
      console.log(`Processing ${file.name}...`);

      try {
        const contentBuffer = await readLocalReportFile(file.name);
        const htmlContent = decodeReportBuffer(contentBuffer);
        const result = await importReport(file.name, htmlContent);
        stats[result] += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(`Failed to process ${file.name}:`, error);
      }
    }

    console.log(
      `Local report pass complete. Found=${stats.found} ready=${stats.ready} deferred=${stats.deferred} imported=${stats.imported} skipped=${stats.skipped} failed=${stats.failed}`,
    );

    return stats;
  }

  const client = new Client();
  client.ftp.verbose = false;

  try {
    console.log(`Connecting to FTP ${FTP_HOST}:${FTP_PORT}...`);
    try {
      await client.access({
        host: FTP_HOST,
        port: FTP_PORT,
        user: FTP_USER,
        password: FTP_PASS,
        secure: false,
      });
    } catch (error) {
      console.error(`Could not connect to FTP ${FTP_HOST}:${FTP_PORT}:`, error);
      return null;
    }

    if (FTP_PATH) {
      console.log(`Connected. Changing working directory to ${FTP_PATH}...`);
      try {
        await client.cd(FTP_PATH);
      } catch (error) {
        console.error(`Failed to change directory to ${FTP_PATH}:`, error);
        return null;
      }
    } else {
      console.log("Connected. Using FTP root directory.");
    }

    const files = await client.list();
    const htmlFiles = files.filter(isHtmlReportFile).sort((left, right) => left.name.localeCompare(right.name));
    const readyFiles = htmlFiles.filter(shouldReadFile);
    const deferredFiles = htmlFiles.filter((file) => !shouldReadFile(file));

    const stats = {
      found: htmlFiles.length,
      ready: readyFiles.length,
      deferred: deferredFiles.length,
      imported: 0,
      skipped: 0,
      failed: 0,
    };

    console.log(
      `Found ${htmlFiles.length} HTML reports. Ready=${readyFiles.length} deferred=${deferredFiles.length} stableMs=${FILE_STABLE_MS}`,
    );

    if (deferredFiles.length > 0) {
      console.log(`Deferring recent or incomplete files: ${deferredFiles.map((file) => file.name).join(", ")}`);
    }

    for (const file of readyFiles) {
      console.log(`Processing ${file.name}...`);

      try {
        const contentBuffer = await downloadFile(client, file.name);
        const htmlContent = decodeReportBuffer(contentBuffer);
        const result = await importReport(file.name, htmlContent);
        stats[result] += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(`Failed to process ${file.name}:`, error);
      }
    }

    console.log(
      `Report pass complete. Found=${stats.found} ready=${stats.ready} deferred=${stats.deferred} imported=${stats.imported} skipped=${stats.skipped} failed=${stats.failed}`,
    );

    return stats;
  } finally {
    client.close();
  }
}

async function runWorker() {
  console.log("Starting ingestion worker...");

  if (RUN_ONCE) {
    console.log(
      `Run-once mode enabled (force reimport: ${FORCE_REIMPORT ? "on" : "off"}, source: ${REPORT_SOURCE}).`,
    );
    const result = await processReports();
    if (!result) {
      if (REPORT_SOURCE === "local") {
        console.log("Run-once import stopped because the local report source could not be read.");
      } else {
        console.log("Run-once import skipped because the FTP server could not be reached.");
      }
    } else if (result.failed > 0) {
      throw new Error(`Run-once import finished with ${result.failed} failed report(s).`);
    }
    console.log("Run-once mode complete. Exiting.");
    return;
  }

  const heartbeat = new WorkerHeartbeat(HEALTH_STALE_MS);
  if (HEALTH_PORT > 0) {
    startHealthServer(heartbeat, HEALTH_PORT);
  }

  while (true) {
    heartbeat.markPollStart();
    try {
      const stats = await processReports();
      if (stats === null) {
        // A null result means the source was unreachable (FTP connect/cd
        // failed, or the local dir could not be read) rather than a clean
        // pass, so record it as a failed poll instead of a success.
        heartbeat.markPollFailure(new Error("Report source unreachable (processReports returned null)"));
      } else {
        heartbeat.markPollSuccess(stats);
      }
    } catch (error) {
      heartbeat.markPollFailure(error);
      console.error("Worker cycle failed:", error);
    }

    console.log(`Waiting ${WORKER_POLL_MS / 1000} seconds before next poll...`);
    await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_MS));
  }
}

if (require.main === module) {
  void runWorker()
    .catch((error) => {
      console.error("Worker crashed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prismaClient.$disconnect();
    });
}
