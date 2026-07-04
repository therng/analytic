import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { getDatabaseErrorDetails } from "../src/lib/database-errors";

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning database...");

  // Using TRUNCATE with CASCADE is significantly faster than deleteMany() 
  // because it removes all rows without scanning and is a single operation.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "Deal", 
      "Position", 
      "OpenPosition", 
      "AccountSnapshot", 
      "AccountReportResult",
      "EquitySnapshot",
      "PositionExcursion",
      "Order",
      "BridgeDeal",
      "BridgeOrder",
      "BridgePosition",
      "Account" 
    RESTART IDENTITY CASCADE;
  `);

  console.log("Cleanup complete.");
}

main()
  .catch((error) => {
    const details = getDatabaseErrorDetails(error, "Cleanup failed.");
    console.error(details.message);
    if (details.status !== 503) {
      console.error(error);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
