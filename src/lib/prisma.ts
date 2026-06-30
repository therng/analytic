import { PrismaClient } from "@prisma/client";
import { loadServerEnv, requireEnv } from "./server-env";

declare global {
  var prisma: PrismaClient | undefined;
}

let prismaClient: PrismaClient | undefined;

function buildDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL!;
  const url = new URL(raw);

  // PostgreSQL-level statement timeout: cancels the query server-side and
  // releases the connection back to the pool. This prevents the connection
  // pool from filling up with orphaned connections from timed-out queries.
  // Promise.race() alone only rejects the JS promise — the underlying query
  // and its pool slot remain held until the query finishes.
  if (!url.searchParams.has("options")) {
    url.searchParams.set("options", "--statement_timeout=12000");
  }

  // Reduce per-process pool size so web + worker together stay well under
  // PostgreSQL's max_connections (default 100). Default Prisma pool is
  // num_cpus*2+1 which can be 21+ per service.
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", "10");
  }

  // Wait longer before giving "could not get connection from pool" error,
  // since our queries should complete (or be cancelled by PG) within 12s.
  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set("pool_timeout", "30");
  }

  return url.toString();
}

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

  const base = new PrismaClient({
    log: ["error"],
    datasources: { db: { url: buildDatabaseUrl() } },
  });

  // Cast back so existing callers that type against PrismaClient still work.
  prismaClient = base as unknown as PrismaClient;

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
