import { createClient, type RedisClientType } from "redis";

type RedisClient = RedisClientType<Record<string, never>, Record<string, never>, Record<string, never>>;

let _promise: Promise<RedisClient> | null = null;

export async function getRedisSocialClient(): Promise<RedisClient> {
  if (!_promise) {
    const client = createClient({ url: process.env.REDIS_URL }) as RedisClient;
    client.on("error", (error) => {
      console.error("[Redis] client connection/operation error:", error);
    });
    _promise = client.connect().then(() => client);
  }
  return _promise;
}

// Returns a fresh connected duplicate suitable for pub/sub subscriptions.
export async function getRedisSocialSubscriber(): Promise<RedisClient> {
  const base = await getRedisSocialClient();
  const sub = base.duplicate() as RedisClient;
  await sub.connect();
  return sub;
}

export const SHOUT_CHANNEL = "social:shouts";
