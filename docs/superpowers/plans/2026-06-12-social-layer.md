# Social Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Shout Ticker (ephemeral 12h broadcasts) and Emoji Reactions to the trading dashboard with Google/Apple sign-in via NextAuth v5.

**Architecture:** Separate `src/components/social/` directory for all social UI; new `src/app/api/social/` and `src/app/api/auth/` routes; three new Prisma models (`SocialUser`, `Shout`, `Reaction`); SSE stream for real-time shout delivery reusing Redis pub/sub.

**Tech Stack:** next-auth@5 (beta), Prisma 6 + PostgreSQL, Redis pub/sub (existing), Next.js 16 App Router, React 19, framer-motion (existing).

---

## File Map

**New files:**
- `src/lib/auth.ts` — NextAuth config (Google + Apple providers, Prisma adapter)
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth route handler
- `src/app/api/social/username/route.ts` — POST: claim/set username
- `src/app/api/social/shouts/route.ts` — GET active shouts, POST create/replace
- `src/app/api/social/shouts/stream/route.ts` — GET SSE stream for real-time shouts
- `src/app/api/social/reactions/route.ts` — GET counts, POST toggle
- `src/components/social/ShoutTicker.tsx` — scrolling strip shown on dashboard
- `src/components/social/ShoutModal.tsx` — full list + compose modal
- `src/components/social/EmojiReactionBar.tsx` — reusable emoji row (ACCOUNT + SHOUT)
- `src/hooks/useSocialSession.ts` — thin wrapper: session state + username prompt needed
- `src/hooks/useShouts.ts` — SSE subscription + shout list state
- `src/hooks/useReactions.ts` — optimistic reaction toggle state

**Modified files:**
- `prisma/schema.prisma` — add SocialUser, Shout, Reaction models
- `src/components/trading-monitor/DashboardClient.tsx` — insert `<ShoutTicker>` below header
- `package.json` — add next-auth, @auth/prisma-adapter

---

## Task 1: Install Dependencies + Prisma Schema

**Files:**
- Modify: `package.json`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Install packages**

```bash
npm install next-auth@beta @auth/prisma-adapter
```

Expected: packages added to `node_modules`. `next-auth` version should be `5.x.x-beta.*`.

- [ ] **Step 2: Add models to prisma/schema.prisma**

Append after the last model in `prisma/schema.prisma`:

```prisma
model SocialUser {
  id          String     @id @default(cuid())
  oauthId     String
  provider    String
  email       String?
  username    String     @unique
  displayName String
  createdAt   DateTime   @default(now()) @map("created_at")
  shouts      Shout[]
  reactions   Reaction[]

  @@unique([oauthId, provider])
  @@map("social_users")
}

model Shout {
  id        String     @id @default(cuid())
  authorId  String     @map("author_id")
  author    SocialUser @relation(fields: [authorId], references: [id])
  message   String
  expiresAt DateTime   @map("expires_at")
  createdAt DateTime   @default(now()) @map("created_at")

  @@map("social_shouts")
}

model Reaction {
  id         String     @id @default(cuid())
  authorId   String     @map("author_id")
  author     SocialUser @relation(fields: [authorId], references: [id])
  targetType String     @map("target_type")
  targetId   String     @map("target_id")
  emoji      String
  createdAt  DateTime   @default(now()) @map("created_at")

  @@unique([authorId, targetType, targetId, emoji])
  @@index([targetType, targetId])
  @@map("social_reactions")
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name social_layer
```

Expected: `migrations/YYYYMMDDHHMMSS_social_layer/migration.sql` created. No errors.

- [ ] **Step 4: Regenerate client**

```bash
npx prisma generate
```

Expected: `@prisma/client` updated, types for `SocialUser`, `Shout`, `Reaction` available.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ package.json package-lock.json
git commit -m "feat(social): add SocialUser, Shout, Reaction prisma models"
```

---

## Task 2: NextAuth Config + Route Handler

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

NextAuth v5 does not use a Prisma adapter for this simple case — we do our own user upsert in the `signIn` callback to keep `SocialUser` separate from the NextAuth internal tables.

- [ ] **Step 1: Create `src/lib/auth.ts`**

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Apple({
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || !profile) return false;
      const oauthId = profile.sub ?? account.providerAccountId;
      const provider = account.provider;
      const email = typeof profile.email === "string" ? profile.email : null;
      const displayName =
        (typeof profile.name === "string" ? profile.name : null) ??
        email ??
        "Trader";

      const existing = await prisma.socialUser.findUnique({
        where: { oauthId_provider: { oauthId, provider } },
      });

      if (!existing) {
        // username is set later via /api/social/username — use placeholder
        const tempUsername = `user_${oauthId.slice(0, 8)}`;
        await prisma.socialUser.create({
          data: { oauthId, provider, email, displayName, username: tempUsername },
        });
      }
      return true;
    },
    async session({ session, token }) {
      if (token.sub && token.provider) {
        const socialUser = await prisma.socialUser.findUnique({
          where: {
            oauthId_provider: {
              oauthId: token.sub,
              provider: token.provider as string,
            },
          },
        });
        if (socialUser) {
          session.user.socialId = socialUser.id;
          session.user.username = socialUser.username;
          session.user.needsUsername = socialUser.username.startsWith("user_");
        }
      }
      return session;
    },
    async jwt({ token, account }) {
      if (account) {
        token.provider = account.provider;
      }
      return token;
    },
  },
});
```

- [ ] **Step 2: Extend NextAuth types**

Create `src/types/next-auth.d.ts`:

```ts
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      socialId?: string;
      username?: string;
      needsUsername?: boolean;
    };
  }
}
```

- [ ] **Step 3: Create route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 4: Add env vars to `.env.local`**

```
NEXTAUTH_SECRET=<generate with: openssl rand -hex 32>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
```

Document in `.env.example` (if it exists) with same keys but empty values.

- [ ] **Step 5: Verify prisma client has the `oauthId_provider` compound unique**

```bash
grep -A2 "oauthId_provider" node_modules/.prisma/client/index.d.ts | head -5
```

Expected: type definition present. If absent, re-run `npx prisma generate`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth/ src/types/next-auth.d.ts
git commit -m "feat(social): add NextAuth config with Google + Apple providers"
```

---

## Task 3: Username API

**Files:**
- Create: `src/app/api/social/username/route.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/social/username/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auth and prisma
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { socialUser: { update: vi.fn(), findUnique: vi.fn() } },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("POST /api/social/username", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ username: "testuser" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for username longer than 20 chars", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { socialId: "uid1", username: "user_abc", needsUsername: true },
    } as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ username: "a".repeat(21) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("updates username and returns 200 on valid input", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { socialId: "uid1", username: "user_abc", needsUsername: true },
    } as any);
    vi.mocked(prisma.socialUser.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.socialUser.update).mockResolvedValue({} as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ username: "validname" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.socialUser.update).toHaveBeenCalledWith({
      where: { id: "uid1" },
      data: { username: "validname" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/api/social/username/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/social/username/route.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/api/social/username/route.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/social/username/
git commit -m "feat(social): add username claim API"
```

---

## Task 4: Shouts API (GET + POST)

**Files:**
- Create: `src/app/api/social/shouts/route.ts`
- Create: `src/lib/redis-social.ts`

- [ ] **Step 1: Create Redis social helper**

Create `src/lib/redis-social.ts`:

```ts
import { createClient } from "redis";

let _client: ReturnType<typeof createClient> | null = null;

export async function getRedisSocialClient() {
  if (!_client) {
    _client = createClient({ url: process.env.REDIS_URL });
    _client.on("error", () => {}); // suppress unhandled
    await _client.connect();
  }
  return _client;
}

export const SHOUT_CHANNEL = "social:shouts";
```

- [ ] **Step 2: Write failing tests for shouts route**

Create `src/app/api/social/shouts/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { shout: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() } },
}));
vi.mock("@/lib/redis-social", () => ({
  getRedisSocialClient: vi.fn().mockResolvedValue({ publish: vi.fn() }),
  SHOUT_CHANNEL: "social:shouts",
}));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("GET /api/social/shouts", () => {
  it("returns active shouts without auth", async () => {
    vi.mocked(prisma.shout.findMany).mockResolvedValue([
      { id: "s1", message: "hello", author: { username: "alice", displayName: "Alice" }, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } as any,
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].message).toBe("hello");
  });
});

describe("POST /api/social/shouts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for empty message", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { socialId: "uid1" } } as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ message: "   " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates shout, expires old one, publishes to Redis", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { socialId: "uid1" } } as any);
    const newShout = { id: "s2", message: "yolo", authorId: "uid1", expiresAt: new Date(), createdAt: new Date() };
    vi.mocked(prisma.shout.create).mockResolvedValue(newShout as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ message: "yolo" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(prisma.shout.updateMany).toHaveBeenCalled();
    expect(prisma.shout.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/app/api/social/shouts/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the route**

Create `src/app/api/social/shouts/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRedisSocialClient, SHOUT_CHANNEL } from "@/lib/redis-social";

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

  const body = await req.json();
  const message: string = (body.message ?? "").trim().slice(0, 120);
  if (!message) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Expire existing active shout for this user
  await prisma.shout.updateMany({
    where: { authorId: session.user.socialId, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const shout = await prisma.shout.create({
    data: { authorId: session.user.socialId, message, expiresAt },
    include: { author: { select: { username: true, displayName: true } } },
  });

  // Publish to Redis for SSE stream
  try {
    const redis = await getRedisSocialClient();
    await redis.publish(SHOUT_CHANNEL, JSON.stringify(shout));
  } catch {
    // non-fatal — SSE clients will fetch on next poll
  }

  return NextResponse.json(shout);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/app/api/social/shouts/route.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/social/shouts/route.ts src/lib/redis-social.ts src/app/api/social/shouts/route.test.ts
git commit -m "feat(social): add shouts API (GET + POST)"
```

---

## Task 5: Shout SSE Stream

**Files:**
- Create: `src/app/api/social/shouts/stream/route.ts`

This endpoint uses Server-Sent Events so the `ShoutTicker` gets real-time updates without polling.

- [ ] **Step 1: Implement SSE route**

Create `src/app/api/social/shouts/stream/route.ts`:

```ts
import { SHOUT_CHANNEL, getRedisSocialClient } from "@/lib/redis-social";
import { createClient } from "redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial ping
      controller.enqueue(encoder.encode(": ping\n\n"));

      let subscriber: ReturnType<typeof createClient> | null = null;
      try {
        const base = await getRedisSocialClient();
        // Duplicate connection for subscribe mode
        subscriber = (base as any).duplicate();
        await subscriber.connect();

        await subscriber.subscribe(SHOUT_CHANNEL, (message) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${message}\n\n`)
            );
          } catch {
            // stream closed
          }
        });

        // Keep alive every 25s
        const interval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            clearInterval(interval);
          }
        }, 25_000);
      } catch {
        controller.close();
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
```

- [ ] **Step 2: Verify route is reachable**

Start dev server (`npm run dev`) and in a separate terminal:

```bash
curl -N http://localhost:3000/api/social/shouts/stream
```

Expected: `: ping` line appears immediately, then `: keepalive` every 25s.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/social/shouts/stream/
git commit -m "feat(social): add SSE stream for real-time shout delivery"
```

---

## Task 6: Reactions API (GET + POST toggle)

**Files:**
- Create: `src/app/api/social/reactions/route.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/api/social/reactions/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    reaction: {
      groupBy: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_EMOJIS = ["🔥", "💎", "🎯", "👏", "😱"];

describe("GET /api/social/reactions", () => {
  it("returns counts grouped by emoji", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    vi.mocked(prisma.reaction.groupBy).mockResolvedValue([
      { emoji: "🔥", _count: { emoji: 3 } } as any,
    ]);
    vi.mocked(prisma.reaction.findMany).mockResolvedValue([]);
    const req = new Request("http://x?targetType=ACCOUNT&targetId=acc1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts["🔥"]).toBe(3);
  });
});

describe("POST /api/social/reactions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ targetType: "ACCOUNT", targetId: "a1", emoji: "🔥" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid emoji", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { socialId: "uid1" } } as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ targetType: "ACCOUNT", targetId: "a1", emoji: "🤡" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates reaction if not exists", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { socialId: "uid1" } } as any);
    vi.mocked(prisma.reaction.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.reaction.create).mockResolvedValue({} as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ targetType: "ACCOUNT", targetId: "a1", emoji: "🔥" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("added");
  });

  it("deletes reaction if already exists (toggle off)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { socialId: "uid1" } } as any);
    vi.mocked(prisma.reaction.findUnique).mockResolvedValue({ id: "r1" } as any);
    vi.mocked(prisma.reaction.delete).mockResolvedValue({} as any);
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ targetType: "ACCOUNT", targetId: "a1", emoji: "🔥" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("removed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/api/social/reactions/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/social/reactions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_EMOJIS = new Set(["🔥", "💎", "🎯", "👏", "😱"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get("targetType");
  const targetId = searchParams.get("targetId");

  if (!targetType || !targetId) {
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

  const body = await req.json();
  const { targetType, targetId, emoji } = body;

  if (!VALID_EMOJIS.has(emoji)) {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400 });
  }
  if (!targetType || !targetId) {
    return NextResponse.json({ error: "targetType and targetId required" }, { status: 400 });
  }

  const authorId = session.user.socialId;
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/api/social/reactions/route.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/social/reactions/
git commit -m "feat(social): add reactions API with toggle (GET + POST)"
```

---

## Task 7: `useSocialSession` + `useShouts` Hooks

**Files:**
- Create: `src/hooks/useSocialSession.ts`
- Create: `src/hooks/useShouts.ts`

- [ ] **Step 1: Create `useSocialSession.ts`**

```ts
"use client";
import { useSession, signIn, signOut } from "next-auth/react";

export type SocialSession =
  | { status: "unauthenticated"; signIn: () => void }
  | { status: "needsUsername"; socialId: string; signOut: () => void }
  | { status: "authenticated"; socialId: string; username: string; signOut: () => void };

export function useSocialSession(): SocialSession {
  const { data: session, status } = useSession();

  if (status !== "authenticated" || !session?.user?.socialId) {
    return { status: "unauthenticated", signIn: () => signIn() };
  }

  if (session.user.needsUsername) {
    return { status: "needsUsername", socialId: session.user.socialId, signOut: () => signOut() };
  }

  return {
    status: "authenticated",
    socialId: session.user.socialId,
    username: session.user.username!,
    signOut: () => signOut(),
  };
}
```

- [ ] **Step 2: Create `useShouts.ts`**

```ts
"use client";
import { useEffect, useRef, useState } from "react";

export interface ShoutItem {
  id: string;
  message: string;
  expiresAt: string;
  createdAt: string;
  author: { username: string; displayName: string };
}

export function useShouts() {
  const [shouts, setShouts] = useState<ShoutItem[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Initial fetch
    fetch("/api/social/shouts")
      .then((r) => r.json())
      .then(setShouts)
      .catch(() => {});

    // SSE for real-time updates
    const es = new EventSource("/api/social/shouts/stream");
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const shout: ShoutItem = JSON.parse(e.data);
        setShouts((prev) => {
          const filtered = prev.filter(
            (s) => s.author.username !== shout.author.username
          );
          return [shout, ...filtered];
        });
      } catch {
        // ignore malformed
      }
    };

    return () => {
      es.close();
    };
  }, []);

  // Prune expired shouts every minute
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setShouts((prev) => prev.filter((s) => new Date(s.expiresAt).getTime() > now));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  return shouts;
}
```

- [ ] **Step 3: Create `useReactions.ts`**

```ts
"use client";
import { useCallback, useEffect, useState } from "react";

interface ReactionState {
  counts: Record<string, number>;
  mine: string[];
  loading: boolean;
}

export function useReactions(targetType: "ACCOUNT" | "SHOUT", targetId: string) {
  const [state, setState] = useState<ReactionState>({ counts: {}, mine: [], loading: true });

  useEffect(() => {
    if (!targetId) return;
    fetch(`/api/social/reactions?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`)
      .then((r) => r.json())
      .then((data) => setState({ counts: data.counts, mine: data.mine, loading: false }))
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, [targetType, targetId]);

  const toggle = useCallback(
    async (emoji: string) => {
      // Optimistic update
      const alreadyMine = state.mine.includes(emoji);
      setState((prev) => ({
        ...prev,
        mine: alreadyMine ? prev.mine.filter((e) => e !== emoji) : [...prev.mine, emoji],
        counts: {
          ...prev.counts,
          [emoji]: (prev.counts[emoji] ?? 0) + (alreadyMine ? -1 : 1),
        },
      }));

      try {
        await fetch("/api/social/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, emoji }),
        });
      } catch {
        // revert on failure by re-fetching
        fetch(`/api/social/reactions?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`)
          .then((r) => r.json())
          .then((data) => setState({ counts: data.counts, mine: data.mine, loading: false }))
          .catch(() => {});
      }
    },
    [state, targetType, targetId]
  );

  return { ...state, toggle };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSocialSession.ts src/hooks/useShouts.ts src/hooks/useReactions.ts
git commit -m "feat(social): add useSocialSession, useShouts, useReactions hooks"
```

---

## Task 8: `EmojiReactionBar` Component

**Files:**
- Create: `src/components/social/EmojiReactionBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";
import { useReactions } from "@/hooks/useReactions";
import { useSocialSession } from "@/hooks/useSocialSession";

const EMOJIS = ["🔥", "💎", "🎯", "👏", "😱"] as const;

interface EmojiReactionBarProps {
  targetType: "ACCOUNT" | "SHOUT";
  targetId: string;
  compact?: boolean;
}

export function EmojiReactionBar({ targetType, targetId, compact = false }: EmojiReactionBarProps) {
  const { counts, mine, toggle } = useReactions(targetType, targetId);
  const session = useSocialSession();

  const canReact = session.status === "authenticated";

  return (
    <div
      style={{
        display: "flex",
        gap: compact ? "4px" : "6px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {EMOJIS.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const active = mine.includes(emoji);
        if (compact && count === 0) return null;
        return (
          <button
            key={emoji}
            onClick={() => canReact && toggle(emoji)}
            disabled={!canReact}
            aria-label={`React with ${emoji}, ${count} reactions`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "2px",
              padding: compact ? "2px 5px" : "3px 7px",
              borderRadius: "12px",
              border: active ? "1px solid var(--accent-blue, #3b82f6)" : "1px solid rgba(255,255,255,0.12)",
              background: active ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.05)",
              cursor: canReact ? "pointer" : "default",
              fontSize: compact ? "12px" : "13px",
              color: "inherit",
              opacity: !canReact && count === 0 ? 0.4 : 1,
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <span>{emoji}</span>
            {count > 0 && (
              <span style={{ fontSize: "11px", fontVariantNumeric: "tabular-nums" }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify component renders in isolation**

Start dev server and navigate to any page that imports it (will add to account card in Task 10).

- [ ] **Step 3: Commit**

```bash
git add src/components/social/EmojiReactionBar.tsx
git commit -m "feat(social): add EmojiReactionBar component"
```

---

## Task 9: `ShoutModal` + `ShoutTicker` Components

**Files:**
- Create: `src/components/social/ShoutModal.tsx`
- Create: `src/components/social/ShoutTicker.tsx`

- [ ] **Step 1: Create `ShoutModal.tsx`**

```tsx
"use client";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSocialSession } from "@/hooks/useSocialSession";
import type { ShoutItem } from "@/hooks/useShouts";

const MAX_CHARS = 120;

interface ShoutModalProps {
  shouts: ShoutItem[];
  open: boolean;
  onClose: () => void;
  onPosted: (shout: ShoutItem) => void;
}

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function ShoutModal({ shouts, open, onClose, onPosted }: ShoutModalProps) {
  const session = useSocialSession();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handlePost() {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/social/shouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });
      if (res.ok) {
        const shout: ShoutItem = await res.json();
        onPosted(shout);
        setText("");
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.6)",
              zIndex: 900,
            }}
            onClick={onClose}
          />
          <motion.div
            key="modal"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0,
              background: "var(--surface-elevated, #1c1c1e)",
              borderRadius: "16px 16px 0 0",
              padding: "20px 16px calc(20px + env(safe-area-inset-bottom))",
              zIndex: 901,
              maxHeight: "75vh",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: "16px" }}>📢 Shouts</span>
              <button onClick={onClose} style={{ background: "none", border: "none", color: "inherit", fontSize: "20px", cursor: "pointer" }}>×</button>
            </div>

            {/* Compose */}
            {session.status === "authenticated" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                  placeholder="What's your shout? (12h)"
                  rows={2}
                  style={{
                    resize: "none", borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "inherit", padding: "8px 10px", fontSize: "14px",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", opacity: 0.5 }}>{text.length}/{MAX_CHARS}</span>
                  <button
                    onClick={handlePost}
                    disabled={!text.trim() || posting}
                    style={{
                      padding: "6px 16px", borderRadius: "8px",
                      background: "var(--accent-blue, #3b82f6)",
                      border: "none", color: "#fff", cursor: "pointer",
                      opacity: (!text.trim() || posting) ? 0.5 : 1,
                    }}
                  >
                    {posting ? "…" : "Shout"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => session.status === "unauthenticated" && session.signIn()}
                style={{
                  padding: "10px", borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent", color: "inherit", cursor: "pointer",
                }}
              >
                Sign in to shout
              </button>
            )}

            {/* List */}
            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              {shouts.length === 0 && (
                <p style={{ opacity: 0.5, fontSize: "13px", textAlign: "center" }}>No shouts yet — be the first</p>
              )}
              {shouts.map((s) => (
                <div key={s.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <div style={{
                    width: "32px", height: "32px", borderRadius: "50%",
                    background: "var(--accent-blue, #3b82f6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: "14px", flexShrink: 0,
                  }}>
                    {s.author.username[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>@{s.author.username}</span>
                      <span style={{ fontSize: "11px", opacity: 0.45 }}>{timeAgo(s.createdAt)}</span>
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: "14px", lineHeight: 1.4 }}>{s.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Create `ShoutTicker.tsx`**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useShouts } from "@/hooks/useShouts";
import { ShoutModal } from "@/components/social/ShoutModal";

export function ShoutTicker() {
  const shouts = useShouts();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (shouts.length <= 1) return;
    timerRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % shouts.length);
    }, 5_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [shouts.length]);

  if (shouts.length === 0) return null;

  const current = shouts[activeIdx % shouts.length];
  const diffH = Math.floor((new Date(current.expiresAt).getTime() - Date.now()) / 3_600_000);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open shout feed"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "6px 12px",
          background: "rgba(255,255,255,0.04)",
          border: "none",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "13px",
          lineHeight: 1.3,
          overflow: "hidden",
        }}
      >
        <span style={{ opacity: 0.55, flexShrink: 0 }}>📢</span>
        <span style={{ fontWeight: 600, opacity: 0.75, flexShrink: 0 }}>
          @{current.author.username}
        </span>
        <span style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {current.message}
        </span>
        <span style={{ opacity: 0.35, flexShrink: 0, fontSize: "11px" }}>
          {diffH > 0 ? `${diffH}h` : "<1h"}
        </span>
      </button>

      <ShoutModal
        shouts={shouts}
        open={open}
        onClose={() => setOpen(false)}
        onPosted={(newShout) => {
          // useShouts handles SSE; just close
          setOpen(false);
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/social/ShoutTicker.tsx src/components/social/ShoutModal.tsx
git commit -m "feat(social): add ShoutTicker and ShoutModal components"
```

---

## Task 10: Wire into Dashboard

**Files:**
- Modify: `src/components/trading-monitor/DashboardClient.tsx`
- Modify: `src/app/layout.tsx` (add SessionProvider)

- [ ] **Step 1: Wrap app with SessionProvider**

Find `src/app/layout.tsx`. Add `SessionProvider` from `next-auth/react`:

```tsx
// At top of file, add:
import { SessionProvider } from "next-auth/react";

// Wrap the {children} with SessionProvider:
<SessionProvider>
  {children}
</SessionProvider>
```

- [ ] **Step 2: Add `ShoutTicker` to `DashboardClient.tsx`**

Find the import section of `DashboardClient.tsx` and add:

```ts
import { ShoutTicker } from "@/components/social/ShoutTicker";
```

Find the main return JSX. Inside the outermost `<div className="app-scroll ...">` or at the top of the card list, add `<ShoutTicker />` as the first child, before the account cards loop:

```tsx
<div className="app-scroll dashboard-scroll" ...>
  <ShoutTicker />
  {/* existing content */}
</div>
```

- [ ] **Step 3: Add `EmojiReactionBar` to account card**

In `DashboardClient.tsx`, find the account card render (the `<article className="card account-card ...">` block). After the header section (`sp-header`), add:

```tsx
import { EmojiReactionBar } from "@/components/social/EmojiReactionBar";

// Inside the card, after the header:
<div style={{ padding: "4px 0 6px" }}>
  <EmojiReactionBar targetType="ACCOUNT" targetId={account.id} compact />
</div>
```

- [ ] **Step 4: Build to verify no type errors**

```bash
npm run build
```

Expected: successful build, no TypeScript errors.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/components/trading-monitor/DashboardClient.tsx
git commit -m "feat(social): wire ShoutTicker + EmojiReactionBar into dashboard"
```

---

## Task 11: Username Setup Flow

**Files:**
- Create: `src/components/social/UsernameSetup.tsx`
- Modify: `src/app/layout.tsx`

Users who sign in for the first time have `needsUsername: true` on their session. We show a modal to set it.

- [ ] **Step 1: Create `UsernameSetup.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";

export function UsernameSetup() {
  const { data: session, update } = useSession();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!session?.user?.needsUsername) return null;

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/social/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value.trim() }),
      });
      if (res.ok) {
        await update(); // refresh session with new username
      } else {
        const body = await res.json();
        setError(body.error ?? "Failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
      padding: "24px",
    }}>
      <div style={{
        background: "var(--surface-elevated, #1c1c1e)",
        borderRadius: "16px",
        padding: "24px",
        width: "100%",
        maxWidth: "360px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Choose your username</h2>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "13px" }}>
          3–20 characters, letters/numbers/underscore
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. forex_king"
          maxLength={20}
          style={{
            padding: "10px 12px", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "inherit", fontSize: "16px",
          }}
        />
        {error && <p style={{ margin: 0, color: "var(--tone-negative, #f87171)", fontSize: "13px" }}>{error}</p>}
        <button
          onClick={handleSave}
          disabled={!value.trim() || saving}
          style={{
            padding: "12px", borderRadius: "8px",
            background: "var(--accent-blue, #3b82f6)",
            border: "none", color: "#fff", cursor: "pointer",
            fontWeight: 600, fontSize: "15px",
            opacity: (!value.trim() || saving) ? 0.5 : 1,
          }}
        >
          {saving ? "Saving…" : "Set Username"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to layout**

In `src/app/layout.tsx`, inside `SessionProvider`:

```tsx
import { UsernameSetup } from "@/components/social/UsernameSetup";

// Inside SessionProvider, after {children}:
<UsernameSetup />
```

- [ ] **Step 3: Build + lint**

```bash
npm run build && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/social/UsernameSetup.tsx src/app/layout.tsx
git commit -m "feat(social): add username setup modal for new OAuth users"
```

---

## Task 12: End-to-End Smoke Test

Manual checklist — run `npm run dev` and verify:

- [ ] **Auth flow**
  - Navigate to any page → sign in button visible (if SessionProvider wired)
  - Sign in with Google → redirected back to app
  - Username setup modal appears for new user
  - Set username → modal disappears

- [ ] **Shout Ticker**
  - With no shouts: ticker not rendered (no empty strip)
  - Post a shout via `/api/social/shouts` curl:
    ```bash
    curl -X POST http://localhost:3000/api/social/shouts \
      -H "Content-Type: application/json" \
      -d '{"message":"test shout"}'
    ```
    (will return 401 — use Postman/cookie after logging in)
  - After posting: strip appears at top of dashboard
  - Tap strip → modal opens, shout visible

- [ ] **Emoji Reactions**
  - Account cards show emoji row (compact mode)
  - Without sign-in: tapping emoji does nothing
  - After sign-in: tap 🔥 → count increments immediately (optimistic)
  - Tap 🔥 again → count decrements (toggle off)
  - Reactions visible on shout messages inside ShoutModal

- [ ] **Expiry**
  - Verify `expiresAt` is 12h from `createdAt` in DB

- [ ] **Final build**

```bash
npm run build
```

Expected: success.

- [ ] **Commit**

```bash
git add -A
git commit -m "feat(social): social layer v1 — Shout Ticker + Emoji Reactions complete"
```
