import { PrismaClient } from "@prisma/client";
import { loadServerEnv, requireEnv } from "./server-env";

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

  prismaClient = new PrismaClient({
    log: ["error"],
  });

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
