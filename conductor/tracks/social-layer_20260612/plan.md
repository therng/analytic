# Plan: Social Layer — Shouts & Reactions

## Phase 1: Data Layer

- [x] Task 1.1: Prisma schema — SocialUser, Shout, Reaction models
- [x] Task 1.2: Migrations — social_layer + indexes
- [x] Task 1.3: redis-social.ts — pub/sub client สำหรับ SSE stream
- [x] Verification: Build passes, schema valid

## Phase 2: Auth

- [x] Task 2.1: next-auth setup (Google + Apple providers)
- [x] Task 2.2: signIn callback — upsert SocialUser (temp username user_XXXX)
- [x] Task 2.3: session callback — inject socialId, username, needsUsername
- [x] Task 2.4: next-auth.d.ts type extensions
- [x] Task 2.5: /api/auth/[...nextauth]/route.ts
- [x] Verification: Auth flow works end-to-end

## Phase 3: API Routes

- [x] Task 3.1: GET/POST /api/social/shouts
- [x] Task 3.2: GET /api/social/shouts/stream (SSE)
- [x] Task 3.3: GET/POST /api/social/reactions
- [x] Task 3.4: POST /api/social/username
- [x] Verification: All routes return correct status codes

## Phase 4: Hooks & Components

- [x] Task 4.1: useShouts — fetch + SSE listener + expiry pruning
- [x] Task 4.2: useReactions — fetch, optimistic toggle, revert on fail
- [x] Task 4.3: useSocialSession — typed session state
- [x] Task 4.4: UsernameSetup — fullscreen modal for first-time username
- [x] Task 4.5: ShoutTicker — always-visible bar, opens ShoutModal
- [x] Task 4.6: ShoutModal — feed list + compose + Google/Apple sign-in buttons
- [x] Task 4.7: EmojiReactionBar — compact & full mode, 5 emoji
- [x] Verification: Components render without errors, build passes

## Phase 5: Integration

- [x] Task 5.1: ShoutTicker ใน DashboardClient (เหนือ account list)
- [x] Task 5.2: EmojiReactionBar (compact) บน DashboardCard
- [x] Task 5.3: EmojiReactionBar (compact) บนแต่ละ shout ใน ShoutModal
- [x] Task 5.4: UsernameSetup ใน layout.tsx
- [x] Task 5.5: SessionProvider ใน Providers component
- [x] Verification: npm run build ผ่าน, ไม่มี type error
