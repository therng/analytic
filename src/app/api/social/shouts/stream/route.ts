import { getRedisSocialClient, SHOUT_CHANNEL } from "@/lib/redis-social";
import type { RedisClientType } from "redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let subscriber: RedisClientType | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": ping\n\n"));
      try {
        const base = await getRedisSocialClient();
        subscriber = (base as any).duplicate() as RedisClientType;
        await subscriber.connect();

        await (subscriber as any).subscribe(SHOUT_CHANNEL, (message: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          } catch {
            // stream closed
          }
        });

        interval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // stream closed
          }
        }, 25_000);
      } catch {
        controller.close();
      }
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (subscriber) {
        (subscriber as any).unsubscribe(SHOUT_CHANNEL).catch(() => {});
        subscriber.disconnect().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
