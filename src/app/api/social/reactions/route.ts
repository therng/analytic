import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REACTION_EMOJIS, VALID_TARGET_TYPES } from "@/lib/social";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get("targetType");
  const targetId = searchParams.get("targetId");

  if (!targetType || !targetId || !VALID_TARGET_TYPES.has(targetType)) {
    return NextResponse.json({ error: "targetType and targetId required" }, { status: 400 });
  }

  const session = await auth();
  const viewerId = session?.user?.socialId ?? null;

  const grouped = await prisma.reaction.groupBy({
    by: ["emoji"],
    where: { targetType, targetId },
    _count: { emoji: true },
  });

  const counts: Record<string, number> = {};
  for (const row of grouped) {
    counts[row.emoji] = row._count.emoji;
  }

  let mine: string[] = [];
  if (viewerId) {
    const myReactions = await prisma.reaction.findMany({
      where: { authorId: viewerId, targetType, targetId },
      select: { emoji: true },
    });
    mine = myReactions.map((r) => r.emoji);
  }

  return NextResponse.json({ counts, mine });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.socialId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const { targetType, targetId, emoji } = body as Record<string, unknown>;

  if (
    typeof emoji !== "string" ||
    typeof targetType !== "string" ||
    typeof targetId !== "string" ||
    !REACTION_EMOJIS.has(emoji) ||
    !VALID_TARGET_TYPES.has(targetType)
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const authorId = session.user.socialId;

  // Explicit toggle: findUnique → create or delete (no P2002 race)
  const existing = await prisma.reaction.findUnique({
    where: { authorId_targetType_targetId_emoji: { authorId, targetType, targetId, emoji } },
  });

  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ action: "removed" });
  }

  await prisma.reaction.create({ data: { authorId, targetType, targetId, emoji } });
  return NextResponse.json({ action: "added" });
}
