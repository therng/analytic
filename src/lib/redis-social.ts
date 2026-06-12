import { createClient } from "redis";

let _client: ReturnType<typeof createClient> | null = null;

export async function getRedisSocialClient() {
  if (!_client) {
    _client = createClient({ url: process.env.REDIS_URL });
    _client.on("error", () => {});
    await _client.connect();
  }
  return _client;
}

export const SHOUT_CHANNEL = "social:shouts";
