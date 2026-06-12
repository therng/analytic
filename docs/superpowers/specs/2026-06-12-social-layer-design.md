# Social Layer Design — Shout Ticker + Reactions

**Date:** 2026-06-12  
**Status:** Approved  
**Scope:** v1 — Shout Ticker + Emoji Reactions (no leaderboard)

---

## Overview

Add a lightweight social layer to the trading dashboard that lets traders broadcast ephemeral messages (Shouts) and react to each other's account activity with emoji. No leaderboard in v1.

**User type:** Independent traders who share the same dashboard instance and want lightweight community interaction.

---

## Identity & Auth

- Sign in via **Google** or **Apple ID** using **NextAuth.js** (App Router route handler)
- No password, no email/password form
- No MT5 account linking required — social profile is fully independent
- On first sign-in → prompted to choose a display username (unique, ≤20 chars)
- **Read** (view shouts, view reactions) → no sign-in required
- **Write** (post shout, toggle reaction) → sign-in required

---

## Feature 1: Shout Ticker

### What it is
A horizontally scrolling strip displayed below the dashboard header. Shows active trader Shouts in real-time. Shouts expire after 12 hours.

### Behavior
- Strip auto-scrolls through active shouts every 5 seconds
- Each shout displays: avatar initial + username + message + relative time (e.g. "3h ago")
- Tap strip → opens **ShoutModal** (full list + compose)
- ShoutModal: signed-in users see a compose input; guests see a "Sign in to shout" prompt
- Message limit: 120 characters
- Each user may have at most 1 active shout at a time (posting a new one replaces the old)

### Real-time
- New shouts pushed via existing **Redis pub/sub** channel (`social:shouts`)
- Frontend subscribes via existing WebSocket infrastructure
- No polling needed

### Expiry
- `expiresAt = createdAt + 12h` stored in DB
- Redis key also set with 12h TTL for pub/sub cleanup
- API filters `WHERE expiresAt > NOW()` on read

---

## Feature 2: Emoji Reactions

### What it is
A row of 5 emoji reactions that can appear on two surfaces:
1. **Account cards** on the dashboard
2. **Shout messages** in the ShoutModal

### Emoji set
🔥 💎 🎯 👏 😱

### Behavior
- Tap an emoji → toggle on/off (requires sign-in)
- Shows total count per emoji, e.g. `🔥 4`
- A user can react with multiple different emojis on the same target
- A user cannot react with the same emoji twice on the same target (unique constraint)
- Counts update optimistically on the client; server is source of truth

---

## Data Model

### New Prisma tables

```prisma
model SocialUser {
  id          String     @id @default(cuid())
  oauthId     String
  provider    String     // "google" | "apple"
  email       String?
  username    String     @unique
  displayName String
  createdAt   DateTime   @default(now())
  shouts      Shout[]
  reactions   Reaction[]

  @@unique([oauthId, provider])
}

model Shout {
  id        String     @id @default(cuid())
  authorId  String
  author    SocialUser @relation(fields: [authorId], references: [id])
  message   String     // max 120 chars
  expiresAt DateTime
  createdAt DateTime   @default(now())
  // reactions queried via Reaction(targetType="SHOUT", targetId=id) — polymorphic, no direct relation
}

model Reaction {
  id         String     @id @default(cuid())
  authorId   String
  author     SocialUser @relation(fields: [authorId], references: [id])
  targetType String     // "ACCOUNT" | "SHOUT"
  targetId   String     // accountId or shoutId
  emoji      String     // "🔥" | "💎" | "🎯" | "👏" | "😱"
  createdAt  DateTime   @default(now())

  @@unique([authorId, targetType, targetId, emoji])
  @@index([targetType, targetId])
}
```

---

## API Routes

All under `src/app/api/`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET/POST` | `auth/[...nextauth]` | — | NextAuth handler (Google + Apple) |
| `POST` | `social/username` | required | Set username on first login |
| `GET` | `social/shouts` | none | Active shouts (`expiresAt > now`) |
| `POST` | `social/shouts` | required | Create/replace own shout |
| `GET` | `social/reactions` | none | `?targetType=&targetId=` counts + viewer's selections |
| `POST` | `social/reactions` | required | Toggle reaction on/off |

---

## UI Components

```
src/app/api/auth/[...nextauth]/route.ts
src/app/api/social/shouts/route.ts
src/app/api/social/reactions/route.ts
src/app/api/social/username/route.ts

src/components/social/ShoutTicker.tsx        ← strip embedded in DashboardClient
src/components/social/ShoutModal.tsx         ← full shout list + compose
src/components/social/EmojiReactionBar.tsx   ← reusable, used in account card + shout

prisma/migrations/YYYYMMDD_social_layer/
```

### ShoutTicker placement
Inserted in `DashboardClient.tsx` directly below the header bar, above the account list. Hidden when no active shouts exist (zero-height, no layout shift).

### EmojiReactionBar props
```ts
interface EmojiReactionBarProps {
  targetType: "ACCOUNT" | "SHOUT";
  targetId: string;
  compact?: boolean; // true = counts only, no labels
}
```

---

## Dependencies

- `next-auth` — OAuth (Google + Apple providers)
- No new chart or animation libraries needed
- Uses existing Redis pub/sub and WebSocket infrastructure

---

## Out of Scope (v1)

- Leaderboard / rankings
- Contest / weekly competitions
- Comments (text replies) — reactions only
- Notifications / push alerts
- MT5 account linking
- Moderation / report flow
