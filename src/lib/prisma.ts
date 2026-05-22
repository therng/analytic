import { PrismaClient } from "@prisma/client";
import { loadServerEnv, requireEnv } from "./server-env";

loadServerEnv();
requireEnv("DATABASE_URL");

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
