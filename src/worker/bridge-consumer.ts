import { prisma } from "../lib/prisma";
import { getRedisSocialClient } from "../lib/redis-social";
import {
  mapDealPayload, mapOrderPayload, mapPositionClosedPayload,
  type RawDealPayload, type RawOrderPayload, type RawPositionClosedPayload,
} from "./bridge-mapper";

export type StreamKind = "deals" | "orders" | "position-closed";

const CONSUMER_GROUP = "worker";
const CONSUMER_NAME = "worker-1";
const BLOCK_MS = 5000;
const CLAIM_IDLE_MS = 60_000;

function streamKey(accountNo: string, kind: StreamKind): string {
  if (kind === "deals") return `mt5:account:${accountNo}:deals-stream`;
  if (kind === "orders") return `mt5:account:${accountNo}:orders-stream`;
  return `mt5:account:${accountNo}:position-closed-stream`;
}

type PrismaLike = {
  // Method syntax (not arrow-property syntax) is intentional: it enables
  // bivariant parameter checking so the real PrismaClient — whose upsert
  // methods take specific generated arg types — is assignable to PrismaLike
  // when drainStream calls processStreamEntry(prisma, ...). The unit tests
  // still inject a structurally-compatible fake.
  bridgeDeal: { upsert(args: unknown): Promise<unknown> };
  bridgeOrder: { upsert(args: unknown): Promise<unknown> };
  bridgePosition: { upsert(args: unknown): Promise<unknown> };
};

export async function processStreamEntry(
  client: PrismaLike,
  kind: StreamKind,
  tradingAccountId: string,
  rawJson: string,
): Promise<void> {
  const raw = JSON.parse(rawJson);

  if (kind === "deals") {
    const row = mapDealPayload(tradingAccountId, raw as RawDealPayload);
    await client.bridgeDeal.upsert({
      where: { tradingAccountId_dealNo: { tradingAccountId, dealNo: row.dealNo } },
      create: row,
      update: row,
    });
    return;
  }

  if (kind === "orders") {
    const row = mapOrderPayload(tradingAccountId, raw as RawOrderPayload);
    await client.bridgeOrder.upsert({
      where: { tradingAccountId_orderTicket: { tradingAccountId, orderTicket: row.orderTicket } },
      create: row,
      update: row,
    });
    return;
  }

  const row = mapPositionClosedPayload(tradingAccountId, raw as RawPositionClosedPayload);
  await client.bridgePosition.upsert({
    where: { tradingAccountId_positionNo: { tradingAccountId, positionNo: row.positionNo } },
    create: row,
    update: row,
  });
}

async function ensureGroup(redis: Awaited<ReturnType<typeof getRedisSocialClient>>, key: string) {
  try {
    await redis.xGroupCreate(key, CONSUMER_GROUP, "0", { MKSTREAM: true });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
  }
}

async function drainStream(
  redis: Awaited<ReturnType<typeof getRedisSocialClient>>,
  accountNo: string,
  tradingAccountId: string,
  kind: StreamKind,
) {
  const key = streamKey(accountNo, kind);
  await ensureGroup(redis, key);

  const response = await redis.xReadGroup(
    CONSUMER_GROUP, CONSUMER_NAME,
    [{ key, id: ">" }],
    { COUNT: 50, BLOCK: BLOCK_MS },
  );
  if (!response) return;

  for (const stream of response) {
    for (const entry of stream.messages) {
      try {
        await processStreamEntry(prisma, kind, tradingAccountId, entry.message.data);
        await redis.xAck(key, CONSUMER_GROUP, entry.id);
      } catch (error) {
        console.error(`[bridge-consumer] Failed to process ${kind} entry ${entry.id} for ${accountNo}:`, error);
      }
    }
  }

  // Reclaim entries left pending too long (e.g. a prior consumer crashed
  // mid-processing) so they are retried instead of stuck forever.
  const pending = await redis.xPendingRange(key, CONSUMER_GROUP, "-", "+", 50);
  for (const p of pending) {
    if (p.millisecondsSinceLastDelivery < CLAIM_IDLE_MS) continue;
    const claimed = await redis.xClaim(key, CONSUMER_GROUP, CONSUMER_NAME, CLAIM_IDLE_MS, [p.id]);
    for (const entry of claimed) {
      if (!entry) continue;
      try {
        await processStreamEntry(prisma, kind, tradingAccountId, entry.message.data);
        await redis.xAck(key, CONSUMER_GROUP, entry.id);
      } catch (error) {
        console.error(`[bridge-consumer] Failed to reprocess claimed ${kind} entry ${entry.id} for ${accountNo}:`, error);
      }
    }
  }
}

export function startBridgeConsumer(): () => void {
  let stopped = false;

  async function loop() {
    const redis = await getRedisSocialClient();
    while (!stopped) {
      try {
        const accounts = await prisma.tradingAccount.findMany({ select: { id: true, accountNo: true } });
        for (const account of accounts) {
          if (stopped) break;
          await drainStream(redis, account.accountNo, account.id, "deals");
          await drainStream(redis, account.accountNo, account.id, "orders");
          await drainStream(redis, account.accountNo, account.id, "position-closed");
        }
      } catch (error) {
        console.error("[bridge-consumer] loop error:", error);
      }
    }
  }

  loop().catch((error) => console.error("[bridge-consumer] fatal error:", error));

  return () => { stopped = true; };
}
