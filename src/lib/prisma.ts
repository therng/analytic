import { PrismaClient } from "@prisma/client";
import { loadServerEnv, requireEnv } from "./server-env";

const DB_QUERY_TIMEOUT_MS = 10_000;

declare global {
  var prisma: PrismaClient | undefined;
}

let prismaClient: PrismaClient | undefined;

function getPrismaClient() {
  if (prismaClient) {
    return prismaClient;
  }

  if (globalThis.prisma) {
    prismaClient = globalThis.prisma;
    return prismaClient;
  }

  loadServerEnv();
  requireEnv("DATABASE_URL");

  const base = new PrismaClient({ log: ["error"] });

  // Wrap every query with a hard timeout so a slow/hung DB query
  // never stalls a Next.js API route indefinitely.
  const extended = base.$extends({
    query: {
      $allOperations({ args, query }) {
        return Promise.race([
          query(args),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("DB query timeout")),
              DB_QUERY_TIMEOUT_MS,
            ),
          ),
        ]);
      },
    },
  });

  // Cast back so existing callers that type against PrismaClient still work.
  prismaClient = extended as unknown as PrismaClient;

  if (process.env.NODE_ENV !== "production") {
    globalThis.prisma = prismaClient;
  }

  return prismaClient;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = client[property as keyof PrismaClient];

    return typeof value === "function" ? value.bind(client) : value;
  },
});
