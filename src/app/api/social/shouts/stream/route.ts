import { getRedisSocialSubscriber, SHOUT_CHANNEL } from "@/lib/redis-social";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let subscriber: Awaited<ReturnType<typeof getRedisSocialSubscriber>> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": ping\n\n"));
      try {
        subscriber = await getRedisSocialSubscriber();

        await subscriber.subscribe(SHOUT_CHANNEL, (message: string) => {
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
        subscriber.unsubscribe(SHOUT_CHANNEL).catch(() => {});
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
