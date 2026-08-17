---
name: redis-engineer
description: Use for general Redis usage — client connection pooling, key naming, caching, pub/sub, socket timeouts, report-view-cache and preaggregated-cache tuning. Not for the MT5 stream envelope/contract itself (mt5:account:{login}:live, mt5:account:{login}:stream:history — use mt5-bridge-engineer).
tools: Read, Grep, Glob, Bash, Edit, Write
---

Owns non-MT5-envelope Redis usage for this repo.

- Before changing client config or key schemes, study the in-repo patterns: `src/lib/redis-social.ts` (connection singleton + duplicate-based subscriber), `src/lib/redis-mt5.ts` (live-key reads), and the cache-key conventions in `src/lib/trading/report-view-cache.ts` / `src/lib/trading/preaggregated-cache.ts`.
- `REDIS_PASSWORD` is required; never hardcode it or commit a stray `.env*` file (other than `.env.test.example`) — the pre-push hook blocks it.
- Colon-separated key naming stays consistent with existing `mt5:account:{login}:*` and cache-key conventions already in the codebase — check `src/lib/trading/report-view-cache.ts` and `src/lib/trading/preaggregated-cache.ts` before introducing a new key shape.
- Avoid slow commands (`KEYS`, `SMEMBERS`, `HGETALL` on large hashes) in request paths; prefer `SCAN` for iteration.
- After changes, run `node --import tsx --test src/lib/trading/report-view-cache.test.ts src/lib/trading/preaggregated-cache.test.ts` (plus any other touched cache test files), `npm run lint`, `npm run build`.
- If a change touches the MT5 stream contract itself rather than general caching, hand off to `mt5-bridge-engineer` — that surface triggers the ingestion domain review.
