import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedisSocialClient, SHOUT_CHANNEL } from "@/lib/redis-social";

export const dynamic = "force-dynamic";

export async function GET() {
  const shouts = await prisma.shout.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { author: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(shouts);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.socialId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const message: string = (typeof body.message === "string" ? body.message : "").trim().slice(0, 120);
  if (!message) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  const shout = await prisma.$transaction(async (tx) => {
    await tx.shout.updateMany({
      where: { authorId: session.user.socialId!, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return tx.shout.create({
      data: { authorId: session.user.socialId!, message, expiresAt },
      include: { author: { select: { username: true, displayName: true } } },
    });
  });

  try {
    const redis = await getRedisSocialClient();
    await redis.publish(SHOUT_CHANNEL, JSON.stringify(shout));
  } catch {
    // non-fatal: SSE clients miss this shout but DB is consistent
  }

  return NextResponse.json(shout);
}
