import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.socialId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  const username: string = (typeof body.username === "string" ? body.username : "").trim();

  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3–20 alphanumeric/underscore characters" },
      { status: 400 }
    );
  }

  try {
    await prisma.socialUser.update({
      where: { id: session.user.socialId },
      data: { username },
    });
    return NextResponse.json({ username });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Username taken" }, { status: 409 });
    }
    throw err;
  }
}
