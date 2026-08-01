# Redis Key Namespace Redesign — Proposal (implemented, deployed, closed out)

Status: **retired and cut over — closed**. Approved, implemented, deployed to
production (bridge + worker-v2 restarted together), verified healthy across
all active accounts, and the legacy `mt5n:v1:*` namespace has been deleted
from production Redis (25 keys, zero failures). The namespace migration itself is closed. Separate post-migration verification tasks remain for historical Deal/Order ingestion and monitoring of the one-time stream-length gap.

One deviation from the original proposal below — the user's approval
explicitly directed removing `stream:live` from the contract entirely
(producer code, tests, docs), not keeping it as a documented write-only key
as §4 originally proposed. The implemented shape has 5 per-account keys, not
6; everywhere below that lists `stream:live` as kept, treat it as superseded
by that direction. See `docs/ARCHITECTURE.md` §10 for the as-built contract,
and `CHANGELOG.md` [8.19] for the closeout summary.

## 0. What happens to the prior `mt5n:v1` → `mt5:{login}:<resource>` pass

An earlier mechanical rename (`mt5n:v1:*` → `mt5:{login}:<resource>`) is sitting
uncommitted in the working tree (`bridge/redis_transport.py`,
`bridge/history.py`, 6 bridge test files, `src/lib/redis-mt5.ts`,
`src/worker-v2/bridge-accounts.ts`, `history-consumer.ts`, `live-sync.ts` +
tests, new `src/lib/mt5-redis-keys.ts`, and doc mentions). That pass preserved
the old flat shape and only swapped the prefix — it is superseded by this
proposal, not a stepping stone to it.

**Recommendation:** discard that diff once this design is approved and
implement the approved shape directly, rather than editing the mechanical
rename a second time. Two things must survive the discard — they are
unrelated, pre-existing uncommitted work from a prior session, not part of
this task: `bridge/discovery.py`, `bridge/supervisor.py`,
`bridge/tests/integration/test_supervisor.py`,
`bridge/tests/unit/test_discovery.py`. I will not run `git checkout` /
`restore` / `reset` on any of this without separately confirming scope —
say the word when the design below is approved and I'll stash or hand-revert
only the rename-touched paths.

## 1. Method

Every resource below is grounded in a repo grep, not inherited from prior
docs — `ARCHITECTURE.md` turned out to contain a phantom row (see §3.3).
Best-practice basis: the repo's `redis-core` skill (colon-separated
`{entity}:{id}:{attribute}` hierarchy, one convention per service, prefix
for scan/ACL scoping) plus the Redis Cluster hash-tag rule — the cluster
slot is computed from the substring between the **first** `{` and the next
`}` in the key, so literal text before the opening brace never affects
which slot a key lands on. That rule is what allows inserting an entity-type
segment ahead of `{login}` for free (§4, open question 1).

## 2. Inventory (verified against code)

| Resource | Type | Keyed by | Writer | Reader | TTL / lifecycle |
|---|---|---|---|---|---|
| lease | String (JSON) | login | `redis_transport.py` `mt5:acquire` Lua | bridge only | `PX` on acquire (`ttl_ms` arg) |
| lease-epoch | String | login | same | bridge only | none set explicitly — lives as long as lease coordination needs it |
| fence-counter | String (int) | login | same (`INCR`) | bridge only | none |
| live | String (JSON envelope) | login | `redis_transport.py` `mt5:publish-live`, fenced | `redis-mt5.ts` (`getMt5LiveData`), `live-sync.ts` | overwritten each publish, no TTL |
| stream:live | Stream | login | `mt5:append-live-stream`, fenced | **none** — grep confirms zero consumers; `docs/superpowers/specs/2026-07-30-bridge-main-entrypoint-design.md:1284` documents this independently | unbounded (no consumer to trim against) |
| stream:history | Stream | login | `mt5:append-stream`, fenced | `history-consumer.ts` via `WORKER_V2_GROUP` consumer group | unbounded, ack'd via consumer group |
| `report-view:v1:{accountId}:{timeframe}:{aggregateVersionKey}:{equityVersionKey}` | String (JSON) | accountId + timeframe + 2 version keys | `report-view-cache.ts` | same file | `setEx` 300s (`REPORT_VIEW_CACHE_TTL_SECONDS`) |
| `sparkline:reactions:{accountId}:{date}` | Hash (emoji→count) | accountId + date | `sparkline-reactions/route.ts` | same | 30d (`SPARKLINE_TTL`) |
| `sparkline:active:{sid}:{accountId}:{date}` | String | session + accountId + date | same | same | 1h (`HOURLY_VOTE_TTL`) |
| `social:shouts` | Pub/Sub channel | — | `redis-social.ts` exports `SHOUT_CHANNEL` | **nobody** — grep finds zero publish/subscribe callers anywhere | n/a, dead |
| `worker-v2` | Stream consumer group name (not a key) | — | `stream-consumer.ts` `WORKER_V2_GROUP` | history-consumer, history-recovery | n/a |

**Explicitly excluded — frozen legacy, do not rename:**

`mt5:v2:history:{accountNo}:ack` / `:pending-window` / `:cursor` / `:watermark`
(`history-checkpoint.ts:205`, `history-recovery.ts:195-199`). These are read
by `scripts/reset-history.ts`, a manual recovery tool for data written by the
**retired bridge_v2**, under names that already exist in production Redis
state (where any is left). Renaming the builder function doesn't rewrite
history — it only breaks the tool's ability to find what a real recovery
needs. Per `CLAUDE.md`, this code stays until a native-bridge replacement
exists; the redesign does not touch it.

## 3. Findings surfaced by this inventory (not proposals — facts)

**3.1 — `mt5:{producer_id}:health` does not exist.** The row appeared in
`ARCHITECTURE.md` describing "expiring health projection." Grepping
`bridge/*.py` for a Redis health key finds nothing; health is
`HealthStore(config.state_dir)` — a local filesystem store
(`bridge/supervisor.py:154`), unrelated to Redis. The earlier mechanical
rename renamed this phantom row along with everything else, propagating a
doc error. This proposal drops the row entirely; §5 recommends the
`ARCHITECTURE.md` fix ships with the implementation.

**3.2 — `stream:live` has no consumer.** Bridge publishes it, nothing reads
it. Confirmed independently by `docs/superpowers/specs/2026-07-30-bridge-main-entrypoint-design.md:1284`.
Not proposing removal here (out of scope for a naming redesign — that's a
product decision), but the spec below marks it write-only so it isn't
implicitly treated as a peer of `stream:history`.

**3.3 — `social:shouts` channel is dead.** Exported, never published or
subscribed. Same treatment as 3.2 — flagged, not removed.

**3.4 — the current namespace already mixes two unrelated top-level
conventions for the same feature**: `sparkline:*` and `social:shouts`. One
feature (social/engagement), two prefixes. This is the concrete instance of
"don't mix entity types" the redesign should fix regardless of what happens
to the mt5 side.

## 4. Proposed namespace

```
mt5:account:{login}:lease
mt5:account:{login}:lease-epoch
mt5:account:{login}:fence-counter
mt5:account:{login}:live
mt5:account:{login}:stream:live       # write-only, no consumer (§3.2)
mt5:account:{login}:stream:history

cache:report-view:{accountId}:{timeframe}:{aggregateVersionKey}:{equityVersionKey}

social:sparkline:reactions:{accountId}:{date}
social:sparkline:active:{sid}:{accountId}:{date}
social:shouts                          # pub/sub channel, currently dead (§3.3)
```

Consumer group name `worker-v2` (not a key — no hash-tag concerns, no
namespace clash with anything above) is left as-is; it lives in a separate
namespace (Redis Stream consumer-group names) that doesn't collide with the
key-naming convention.

### Why `mt5:` and not e.g. `trading:`

`mt5` names the actual integration boundary (bridge → worker-v2 pipeline is
specifically the MetaTrader 5 contract) — this is a product/domain name, not
an implementation detail like `mt5n` (bridge codename) or `v1` (a version
that was never incremented and had no compatibility target). Keeping it
matches how the rest of the codebase already talks about this system
(`CLAUDE.md`, `docs/ARCHITECTURE.md` §10, `src/worker-v2/*`).

### Why `cache:` and `social:` as siblings of `mt5:`, not nested under it

`report-view` and `sparkline` are not MT5-protocol resources — they're
derived/application-level state with their own lifecycle (5-minute cache
TTL; 30-day/1-hour social TTLs) owned by different code (`src/lib/trading/`,
`src/app/api/social/`) with no coordination requirement against the mt5
pipeline's fenced-lease keys. Nesting them under `mt5:` would say "this is
part of the bridge contract," which isn't true, and would make ACL/scan
scoping (`mt5:*` = "everything the bridge and worker touch") imprecise.

### Why `cache:report-view:...` drops the bare `v1`

The old `report-view:v1` prefix used a static version token for the same
anti-pattern the mt5n rename was fixing: a version segment nobody plans to
increment via string change. The key already carries two real version
tokens — `aggregateVersionKey` and `equityVersionKey` — which is how this
cache actually invalidates. A third, unrelated `v1` token is dead weight;
removing it is consistent with "eliminate redundant naming," not a special
exception.

## 5. Open question — needs your decision, not mine

**Should `mt5:account:{login}:...` include the literal `account` segment?**

Verified: exactly **one** entity type exists in the mt5 pipeline today — the
trading account. There is no `producer`, `terminal`, or `worker` entity
with its own keys in this domain right now (§3.1 found the one candidate
was a documentation phantom, not real).

| | Flat: `mt5:{login}:<resource>` | Typed: `mt5:account:{login}:<resource>` |
|---|---|---|
| Matches "don't mix entity types" | Trivially — there's only one type today | Explicitly, in the key shape itself |
| Cost | None | One extra segment on every command, every key, forever |
| Room to grow | Adding a second entity type later means an inconsistent shape (some keys typed, some not) unless done as a breaking follow-up rename | A future `mt5:producer:{id}:...` or `mt5:terminal:{id}:...` slots in with zero shape change |
| Ponytail/YAGNI read | Correct — don't build structure for an entity that doesn't exist | Only defensible if a second entity type is a near-term, not speculative, plan |

I lean toward **typed** (`mt5:account:{login}:...`) specifically because your
stated rule was explicit about not mixing entity types, and the cost is one
literal word — cheap insurance against the exact mixing you flagged,
verified cluster-slot-neutral (§1). But this is a judgment call between two
defensible options, not a best-practice-mandated one — pick either and I'll
implement that shape.

## 6. Verification plan (before implementation, not yet run)

1. Confirm hash-tag slot equality for `mt5:account:{7998410}:lease` and
   `mt5:account:{7998410}:stream:history` — same slot, since both hash-tag
   substrings are identical (`7998410`). Will assert this with a CRC16
   hash-slot check in a unit test, not just cite the spec.
2. `bridge-accounts.ts`'s `SCAN MATCH` pattern (`prefix + "*" + suffix`)
   needs its prefix/suffix constants updated for the new shape
   (`mt5:account:{` / `}:live`) and a regression test that it still rejects
   retired shapes: `mt5:v2:account:...:live`, unbraced
   `mt5:account:7998410:live`, and — new, because the new prefix is closer
   to legacy strings than the old one was — anything starting `mt5:v2:`.
3. Re-run `pytest bridge/tests`, `node --test src/worker-v2/*.test.ts`,
   `npx tsc --noEmit`, `npm run build` after implementation, same as the
   prior pass.

## 7. Deploy note (unchanged from before)

Still a live rename: bridge (VPS) and worker-v2 must ship together or
in-flight lease/stream keys stop matching between producer and consumer.


## 8. Post-migration follow-up status

- **P0 — Open:** prove historical Deal/Order ingestion end-to-end from `mt5:account:{login}:stream:history` through worker-v2 into PostgreSQL. Empty `history.window` events alone do not close this item.
- **P1 — Monitoring:** the earlier Redis memory reduction was caused by the approved deletion of the legacy streams. Current stream growth is healthy. The original one-time `entries-added` versus `length` gap has no proven mechanism and remains observation-only unless it recurs.
- **P2 — Complete:** failed live polls are now observable through structured stderr logging and an in-process counter in `bridge/worker.py`, with dedicated regression tests. No `stream:live` key was reintroduced.
- **P3 — Complete:** legacy production keys and active-contract terminology were removed. Literal `namespace="mt5n:v1"` values used solely as deterministic event-ID hash salts remain frozen pending an explicit compatibility migration.

Investigation notes must not claim that `max-deleted-entry-id` can distinguish `XDEL` from `XTRIM`. For retention analysis, capture the exact Redis version, command, trim count, and before/after `XINFO STREAM` output.
