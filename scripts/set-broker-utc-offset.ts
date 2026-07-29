// Sets TradingAccount.brokerUtcOffsetMinutes, used to correct MT5's raw epochs
// (broker trade server's own wall clock, not UTC) to true UTC before every
// Deal/Order/Position/OpenPosition write (src/lib/time.ts epochSecondsToDate)
// and to bound bridge_v2's history sync window in the same broker-local space
// (bridge_v2/main.py --broker-utc-offset-minutes, threaded from
// bridge_v2/run_all_v2.py --broker-offset LOGIN=MINUTES). Keep the bridge's
// service startup args in sync with this value manually — bridge_v2 has no DB
// access by design.
//
// Usage:
//   node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>
//   node --import tsx scripts/set-broker-utc-offset.ts 123456 180   # broker server = UTC+3
//   node --import tsx scripts/set-broker-utc-offset.ts 123456 --list

import { prisma } from "../src/lib/prisma";

async function main() {
  const [accountNo, rawOffset] = process.argv.slice(2);

  if (!accountNo || rawOffset === undefined) {
    console.error(
      "Usage: node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes|--list>",
    );
    process.exitCode = 1;
    return;
  }

  if (rawOffset === "--list") {
    const accounts = await prisma.tradingAccount.findMany({
      select: {
        accountNo: true,
        accountName: true,
        serverName: true,
        brokerUtcOffsetMinutes: true,
      },
      orderBy: { accountNo: "asc" },
    });
    for (const account of accounts) {
      console.log(
        `${account.accountNo}\t${account.serverName ?? "-"}\t${account.accountName ?? "-"}\toffset=${account.brokerUtcOffsetMinutes ?? "UNSET"}`,
      );
    }
    return;
  }

  const offsetMinutes = Number(rawOffset);
  if (!Number.isFinite(offsetMinutes) || !Number.isInteger(offsetMinutes)) {
    console.error(
      `Invalid offsetMinutes: ${rawOffset} (expected an integer, e.g. 180 for UTC+3)`,
    );
    process.exitCode = 1;
    return;
  }

  const account = await prisma.tradingAccount.update({
    where: { accountNo },
    data: { brokerUtcOffsetMinutes: offsetMinutes },
    select: { accountNo: true, brokerUtcOffsetMinutes: true },
  });

  console.log(
    `Set ${account.accountNo} brokerUtcOffsetMinutes=${account.brokerUtcOffsetMinutes}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
