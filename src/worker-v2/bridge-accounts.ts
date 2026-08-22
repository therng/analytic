import { prisma } from "../lib/prisma";
import { getRedisSocialClient } from "../lib/redis-social";
import { getMt5LiveData } from "../lib/redis-mt5";
import {
  accountNoFromMt5LiveKey,
  MT5_LIVE_KEY_PREFIX,
  MT5_LIVE_KEY_SUFFIX,
} from "../lib/mt5-redis-keys";
export { accountNoFromMt5LiveKey };

const DEFAULT_BRIDGE_SERVER = "MT5 Bridge";
export const DEFAULT_BROKER_UTC_OFFSET_MINUTES = 180;

function optionalBridgeText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

export async function listBridgeAccountNos() {
  const redis = await getRedisSocialClient();
  const accountNos = new Set<string>();

  for await (const batch of redis.scanIterator({
    MATCH: `${MT5_LIVE_KEY_PREFIX}*${MT5_LIVE_KEY_SUFFIX}`,
    COUNT: 100,
  })) {
    const keys = Array.isArray(batch) ? batch : [batch];
    for (const key of keys) {
      const accountNo = accountNoFromMt5LiveKey(String(key));
      if (accountNo) {
        accountNos.add(accountNo);
      }
    }
  }

  return [...accountNos].sort((left, right) => left.localeCompare(right));
}

type BridgeAccountDb = {
  tradingAccount: {
    upsert(args: unknown): Promise<{ id: string; accountNo: string }>;
    findUnique(args: unknown): Promise<{
      id: string;
      accountNo: string;
      accountName: string | null;
      company: string | null;
      currency: string;
      serverName: string;
      reportDate: Date | null;
      updatedAt: Date;
    } | null>;
    update(args: unknown): Promise<{ id: string; accountNo: string }>;
  };
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// reportDate is the live snapshot timestamp and changes every bridge
// heartbeat (~seconds). Writing it on every refresh bumps updatedAt, which
// feeds the aggregate cache version key → pointless full rebuilds. Only
// propagate it when it moves by a meaningful margin (bridge restart /
// reconnect), same trick the equity tick throttle uses.
const REPORT_DATE_MIN_DRIFT_MS = 5 * 60 * 1000;

export async function ensureBridgeAccounts(
  deps: {
    db?: BridgeAccountDb;
    listAccountNos?: () => Promise<string[]>;
    readLive?: typeof getMt5LiveData;
  } = {},
) {
  const db = deps.db ?? (prisma as unknown as BridgeAccountDb);
  const accountNos = await (deps.listAccountNos ?? listBridgeAccountNos)();
  const readLive = deps.readLive ?? getMt5LiveData;
  const accounts = [];

  for (const accountNo of accountNos) {
    const data = await readLive(accountNo);
    const ts =
      data.live?.timestamp != null && Number.isFinite(data.live.timestamp)
        ? new Date(data.live.timestamp * 1000)
        : null;

    // Skip the upsert entirely when nothing material changed: identity
    // fields identical AND reportDate drift below threshold AND the account
    // was seen recently. Keeps updatedAt stable across idle heartbeats.
    const existing = await db.tradingAccount.findUnique({
      where: { accountNo },
      select: {
        id: true,
        accountNo: true,
        accountName: true,
        company: true,
        currency: true,
        serverName: true,
        reportDate: true,
        updatedAt: true,
      },
    });

    if (existing) {
      const identityUnchanged =
        normalizeText(existing.accountName) ===
          normalizeText(optionalBridgeText(data.live?.name) ?? null) &&
        normalizeText(existing.company) ===
          normalizeText(optionalBridgeText(data.live?.company) ?? null) &&
        existing.currency === (data.live?.currency || "USD") &&
        normalizeText(existing.serverName) ===
          normalizeText(optionalBridgeText(data.live?.server) ?? null);
      const reportDriftMs = existing.reportDate && ts
        ? Math.abs(ts.getTime() - existing.reportDate.getTime())
        : null;
      const reportDateUnchanged =
        reportDriftMs === null ||
        reportDriftMs < REPORT_DATE_MIN_DRIFT_MS;

      if (identityUnchanged && reportDateUnchanged) {
        // Pure liveness: keep lastSeenAt fresh without touching updatedAt
        // (write the row's current value back — Prisma @updatedAt would
        // otherwise auto-bump it on any update).
        await db.tradingAccount.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: new Date(),
            updatedAt: existing.updatedAt,
          },
        });
        accounts.push({ id: existing.id, accountNo: existing.accountNo });
        continue;
      }
    }

    const account = await db.tradingAccount.upsert({
      where: { accountNo },
      update: {
        accountName: optionalBridgeText(data.live?.name),
        company: optionalBridgeText(data.live?.company),
        currency: data.live?.currency || "USD",
        serverName: optionalBridgeText(data.live?.server),
        reportDate: ts ?? undefined,
        lastSeenAt: new Date(),
      },
      create: {
        accountNo,
        accountName: optionalBridgeText(data.live?.name) ?? null,
        company: optionalBridgeText(data.live?.company) ?? null,
        currency: data.live?.currency || "USD",
        serverName:
          optionalBridgeText(data.live?.server) ?? DEFAULT_BRIDGE_SERVER,
        brokerUtcOffsetMinutes: DEFAULT_BROKER_UTC_OFFSET_MINUTES,
        reportDate: ts,
        lastSeenAt: new Date(),
      },
      select: { id: true, accountNo: true },
    });
    accounts.push(account);
  }

  return accounts;
}
