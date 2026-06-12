import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.socialId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const username: string = (body.username ?? "").trim();

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3–20 alphanumeric/underscore characters" },
      { status: 400 }
    );
  }

  const conflict = await prisma.socialUser.findUnique({ where: { username } });
  if (conflict && conflict.id !== session.user.socialId) {
    return NextResponse.json({ error: "Username taken" }, { status: 409 });
  }

  await prisma.socialUser.update({
    where: { id: session.user.socialId },
    data: { username },
  });

  return NextResponse.json({ username });
}
