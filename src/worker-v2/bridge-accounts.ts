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
  };
};

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
    const account = await db.tradingAccount.upsert({
      where: { accountNo },
      update: {
        accountName: optionalBridgeText(data.live?.name),
        company: optionalBridgeText(data.live?.company),
        currency: data.live?.currency || "USD",
        serverName: optionalBridgeText(data.live?.server),
        reportDate: ts ?? undefined,
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
      },
      select: { id: true, accountNo: true },
    });
    accounts.push(account);
  }

  return accounts;
}
