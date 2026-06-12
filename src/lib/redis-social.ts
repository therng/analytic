import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;
let _promise: Promise<RedisClient> | null = null;

export function getRedisSocialClient() {
  if (!_promise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on("error", () => {});
    _promise = client.connect().then(() => client as RedisClient);
  }
  return _promise;
}

export const SHOUT_CHANNEL = "social:shouts";
