import { getRedisSocialClient, SHOUT_CHANNEL } from "@/lib/redis-social";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": ping\n\n"));

      let closed = false;

      try {
        const base = await getRedisSocialClient();
        const subscriber = (base as any).duplicate();
        await subscriber.connect();

        await subscriber.subscribe(SHOUT_CHANNEL, (message: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${message}\n\n`));
          } catch {
            // stream closed by client
          }
        });

        const interval = setInterval(() => {
          if (closed) {
            clearInterval(interval);
            return;
          }
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            clearInterval(interval);
          }
        }, 25_000);
      } catch {
        if (!closed) controller.close();
      }
    },
    cancel() {
      // Client disconnected — cleanup happens via closed flag
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
