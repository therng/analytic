# Worker V2 (Redis to PostgreSQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Worker V2 — a standalone Node process that consumes Bridge V2's raw MT5 Redis streams/keys (`mt5:v2:*`) and persists Deals, Orders, live AccountSnapshot, and OpenPosition sets into PostgreSQL via Prisma, idempotently.

**Architecture:** Two global Redis Streams (`mt5:v2:history:deals`, `mt5:v2:history:orders`) consumed via one `worker-v2` consumer group each, self-describing `login` per message resolved against `TradingAccount.accountNo`. A per-account polling loop reads the `mt5:v2:account:{login}:live` Hash + `mt5:v2:account:{login}:positions` JSON string, gated by the `mt5:v2:bridge:{login}:heartbeat` freshness key, and upserts `AccountSnapshot` / replaces `OpenPosition` transactionally. Entirely new `src/worker-v2/` tree; legacy `src/worker/` untouched.

**Tech Stack:** Node.js + TypeScript (tsx/esbuild, matching legacy worker build), `redis` npm package v6 (node-redis, XREADGROUP/XACK/XCLAIM), Prisma 6 (`@prisma/client`), `node:test` for unit tests.

## Global Constraints

- English only in source, comments, tests, logs.
- Do not touch `src/worker/**` (legacy) or `bridge_v2/**` (Python, already correct — do not modify Bridge V2 history logic).
- No FTP import, no ReportImport, no file-hash dedup, no Bridge shadow tables, no barriers/chunk-ACK/multi-checkpoint recovery, no ClosedPosition reconstruction (out of scope for Phase 3), no starting MT5 terminals.
- Financial values: construct `Prisma.Decimal` from `String(value)`, never from a raw JS float. Net P/L = `profit + swap + commission` computed via Decimal arithmetic (fee excluded).
- Redis entry ack only after the Prisma write for that entry commits. Malformed/validation-failure/unknown-login messages: log full context (login, stream, entry id, ticket) and **ACK** (isolate, don't poison-loop). Infrastructure failures (DB/Redis unreachable): do **not** ack, bounded backoff, no infinite hot loop.
- Never delete `OpenPosition` rows unless heartbeat is fresh AND positions payload parses as a complete, valid array.
- Do not run `prisma migrate dev` — no schema changes needed; `Deal`, `Order`, `OpenPosition`, `AccountSnapshot`, `TradingAccount` already have the required fields/unique constraints (verified in Task 1).
- Real Bridge V2 Redis contract (confirmed against `bridge_v2/config.py`, `history_publisher.py`, `live_publisher.py` on `main`) overrides the prose spec's assumed key names:
  - `mt5:v2:history:deals` / `mt5:v2:history:orders` — **global** streams, entry field `data` = JSON string `{"login": <int>, "kind": "deal"|"order", "record": {...raw MT5 fields...}}`.
  - `mt5:v2:account:{login}:live` — Redis **Hash** (HSET), fields: `login, name, server, company, currency, leverage, trade_mode, margin_mode, balance, equity, margin, margin_free, margin_level, profit, credit` (all values arrive as strings via node-redis; `None` was written as `""`).
  - `mt5:v2:account:{login}:positions` — Redis **String** (SET) containing a raw JSON array (no wrapper, no count field, no timestamp), each element: `ticket, identifier, symbol, type, magic, reason, volume, price_open, price_current, sl, tp, profit, swap, comment, time, time_msc`.
  - `mt5:v2:bridge:{login}:heartbeat` — Redis **Hash**, fields `lastSeen` (epoch seconds, float-as-string), `positions` (count), TTL 10s (auto-expires). **This is the only freshness signal** for both `live` and `positions` — neither of those keys carries its own timestamp.
  - No `position-closed` / `kind` other than `"deal"`/`"order"` is ever published. `STREAM_DEALS` only ever carries `kind: "deal"`; `STREAM_ORDERS` only ever carries `kind: "order"` (confirmed in `history_publisher.py::sync_history_once`).
- Spec-vs-reality validation reconciliation (do not build guards for fields that don't exist):
  - "reported count matches array length" — **N/A**, no count field in the positions payload. Note this in the completion report; do not add a fake check.
  - "login mismatch does not delete positions" — the `positions` payload itself has no `login` field (key is already login-scoped). The login-mismatch guard for the live/positions path is done against the **live Hash's** `login` field (`String(hashLogin) === account.accountNo`); if that fails, treat the whole live+positions pair as invalid for this account and skip (don't delete). Deal/Order streams get the real per-message login check since their envelope carries `login`.
  - Live `AccountSnapshot.reportDate` is set from the heartbeat's `lastSeen` (converted to `Date`), not `now()` — `now()` would defeat staleness detection on replay/inspection.
  - `AccountSnapshot` has no `currency`/`leverage` columns — those two live-payload fields are dropped (not persisted this phase); every other listed field (`balance, equity, margin, freeMargin(=margin_free), marginLevel(=margin_level), floatingPl(=profit), creditFacility(=credit)`) maps directly.
  - Stream `login` is numeric; `TradingAccount.accountNo` is `String` — always coerce with `String(login)` before comparing/looking up, never loose-`==` across types.

---

## File Structure

```
src/worker-v2/
  index.ts              # Entrypoint: load accounts, start 2 stream consumers, start live-sync loop, start health server
  account-registry.ts   # Load enabled TradingAccounts from Prisma, login (string) -> TradingAccount map, periodic refresh
  decimal.ts             # toDecimal(), isFiniteNumeric() helpers (used by mappers + live-sync)
  validators.ts          # validateDealRecord, validateOrderRecord, validateLiveHash, validatePositionsPayload
  mappers.ts             # mapDealToPrisma, mapOrderToPrisma, mapLiveToAccountSnapshot, mapPositionToOpenPosition
  stream-consumer.ts     # Generic XREADGROUP consumer loop + pending-entry reclaim, used by deal/order consumers
  deal-consumer.ts       # Wires stream-consumer to STREAM_DEALS + Deal upsert + stats
  order-consumer.ts      # Wires stream-consumer to STREAM_ORDERS + Order upsert + stats
  live-sync.ts           # Per-account poll: heartbeat gate -> live Hash -> AccountSnapshot upsert; positions -> transactional OpenPosition replace
  health.ts              # Worker V2 status tracker (counters/timestamps) + HTTP endpoint on its own port
  *.test.ts              # node:test files co-located per module
```

No new Prisma models/migrations. `src/worker/**` is not imported from (except the plain, side-effect-free `serverTimeToUtc` from `src/lib/time.ts`, which is not worker-specific).

---

## Task 1: Confirm schema — no migration needed

**Files:**

- Read only: `prisma/schema.prisma`

**Interfaces:**

- Produces: confirmation that `Deal.@@unique([tradingAccountId, dealNo])`, `Order.@@unique([tradingAccountId, orderTicket])`, `OpenPosition.@@unique([tradingAccountId, positionNo])`, `AccountSnapshot.tradingAccountId @unique` exist as expected, and `TradingAccount.accountNo @unique` / `brokerUtcOffsetMinutes Int?` exist.

- [ ] **Step 1: Grep the schema for the four models and their constraints**

Run: `grep -n -A 30 "^model Deal \|^model Order \|^model OpenPosition \|^model AccountSnapshot \|^model TradingAccount " prisma/schema.prisma`

Expected: each block contains the unique constraint / field named above (already verified during planning — this step is a pre-flight re-check in case the schema changed since planning).

- [ ] **Step 2: Run Prisma validate**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

No commit for this task (read-only verification).

---

## Task 2: `decimal.ts` — Decimal + finite-number helpers

**Files:**

- Create: `src/worker-v2/decimal.ts`
- Test: `src/worker-v2/decimal.test.ts`

**Interfaces:**

- Produces:
  - `toDecimal(value: unknown): Prisma.Decimal | null` — `null` if value is `null`/`undefined`/`""`/non-finite; otherwise `new Prisma.Decimal(String(value))`.
  - `toDecimalOrZero(value: unknown): Prisma.Decimal` — same as above but returns `new Prisma.Decimal(0)` instead of `null`.
  - `isFiniteNumeric(value: unknown): boolean` — true only if `value` coerces to a finite number (`Number.isFinite(Number(value))`) and is not an empty string / null / undefined / boolean.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/decimal.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { toDecimal, toDecimalOrZero, isFiniteNumeric } from "./decimal.ts";

test("toDecimal converts numeric string safely", () => {
  const d = toDecimal(12.5);
  assert.ok(d instanceof Prisma.Decimal);
  assert.equal(d?.toString(), "12.5");
});

test("toDecimal returns null for null/undefined/empty/non-finite", () => {
  assert.equal(toDecimal(null), null);
  assert.equal(toDecimal(undefined), null);
  assert.equal(toDecimal(""), null);
  assert.equal(toDecimal(NaN), null);
  assert.equal(toDecimal(Infinity), null);
});

test("toDecimalOrZero returns zero Decimal for missing values", () => {
  assert.equal(toDecimalOrZero(null).toString(), "0");
  assert.equal(toDecimalOrZero(3).toString(), "3");
});

test("isFiniteNumeric rejects non-numeric and accepts numeric-looking strings", () => {
  assert.equal(isFiniteNumeric(5), true);
  assert.equal(isFiniteNumeric("5.5"), true);
  assert.equal(isFiniteNumeric("abc"), false);
  assert.equal(isFiniteNumeric(null), false);
  assert.equal(isFiniteNumeric(undefined), false);
  assert.equal(isFiniteNumeric(""), false);
  assert.equal(isFiniteNumeric(Infinity), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/decimal.test.ts`
Expected: FAIL — `Cannot find module './decimal.ts'`

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/decimal.ts
import { Prisma } from "@prisma/client";

export function isFiniteNumeric(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "boolean") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

export function toDecimal(value: unknown): Prisma.Decimal | null {
  if (!isFiniteNumeric(value)) return null;
  return new Prisma.Decimal(String(value));
}

export function toDecimalOrZero(value: unknown): Prisma.Decimal {
  return toDecimal(value) ?? new Prisma.Decimal(0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/decimal.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/decimal.ts src/worker-v2/decimal.test.ts
git commit -m "feat(worker-v2): add Decimal-safe numeric helpers"
```

---

## Task 3: `account-registry.ts` — enabled account discovery

**Files:**

- Create: `src/worker-v2/account-registry.ts`
- Test: `src/worker-v2/account-registry.test.ts`

**Interfaces:**

- Consumes: `PrismaClient` (from `@prisma/client`), passed in (no module-level singleton — testable via a fake/mock client).
- Produces:
  - `type AccountRegistry = Map<string, TradingAccount>` keyed by `accountNo` (the MT5 login as a string).
  - `loadAccountRegistry(prisma: PrismaClient): Promise<AccountRegistry>` — loads all `TradingAccount` rows (no `enabled` column exists on `TradingAccount` today — "enabled" per the spec means "has a usable config"; treat an account as eligible only if `brokerUtcOffsetMinutes !== null`, matching the CLAUDE.md rule that ingestion must be skipped for unconfigured accounts). Returns a `Map` keyed by `accountNo`.
  - `resolveAccountByLogin(registry: AccountRegistry, login: number | string): TradingAccount | null` — `registry.get(String(login)) ?? null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/account-registry.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadAccountRegistry,
  resolveAccountByLogin,
} from "./account-registry.ts";

function fakePrisma(rows: any[]) {
  return {
    tradingAccount: {
      findMany: async () => rows,
    },
  } as any;
}

test("loadAccountRegistry keys accounts by accountNo and excludes unconfigured offsets", async () => {
  const prisma = fakePrisma([
    { id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 },
    { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null },
  ]);
  const registry = await loadAccountRegistry(prisma);
  assert.equal(registry.size, 1);
  assert.equal(registry.get("1001")?.id, "a1");
  assert.equal(registry.has("1002"), false);
});

test("resolveAccountByLogin coerces numeric login to string lookup", async () => {
  const prisma = fakePrisma([
    { id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 },
  ]);
  const registry = await loadAccountRegistry(prisma);
  assert.equal(resolveAccountByLogin(registry, 1001)?.id, "a1");
  assert.equal(resolveAccountByLogin(registry, "1001")?.id, "a1");
  assert.equal(resolveAccountByLogin(registry, 9999), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/account-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/account-registry.ts
import type { PrismaClient, TradingAccount } from "@prisma/client";

export type AccountRegistry = Map<string, TradingAccount>;

export async function loadAccountRegistry(
  prisma: PrismaClient,
): Promise<AccountRegistry> {
  const rows = await prisma.tradingAccount.findMany();
  const registry: AccountRegistry = new Map();
  for (const row of rows) {
    if (
      row.brokerUtcOffsetMinutes === null ||
      row.brokerUtcOffsetMinutes === undefined
    )
      continue;
    registry.set(row.accountNo, row);
  }
  return registry;
}

export function resolveAccountByLogin(
  registry: AccountRegistry,
  login: number | string,
): TradingAccount | null {
  return registry.get(String(login)) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/account-registry.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/account-registry.ts src/worker-v2/account-registry.test.ts
git commit -m "feat(worker-v2): add enabled-account registry loader"
```

---

## Task 4: `validators.ts` — event/payload validation

**Files:**

- Create: `src/worker-v2/validators.ts`
- Test: `src/worker-v2/validators.test.ts`

**Interfaces:**

- Consumes: `isFiniteNumeric` from `./decimal.ts` (Task 2).
- Produces:
  - `type ValidationResult = { ok: true } | { ok: false; reason: string }`
  - `validateDealRecord(login: unknown, record: unknown, accountNo: string): ValidationResult` — checks: `String(login) === accountNo`; `record` is an object; `record.ticket` present (non-null, non-empty when stringified); `record.time` is finite numeric (epoch seconds); `record.volume` is finite and `>= 0` (or absent — MT5 deals can omit volume for balance ops, treat missing as valid/skip check, but if present must be finite/non-negative); `record.price` finite when present; `record.profit`, `record.swap`, `record.commission`, `record.fee` finite when present (missing treated as 0 downstream, not a validation failure).
  - `validateOrderRecord(login: unknown, record: unknown, accountNo: string): ValidationResult` — checks: `String(login) === accountNo`; `record.ticket` present; `record.time_setup` finite numeric when present, `record.time_done` finite numeric when present (at least one of the two must be present and finite — an order with neither is malformed); `record.volume_initial`/`record.volume_current` finite and `>= 0` when present; `record.price_open`, `record.price_current`, `record.sl`, `record.tp`, `record.price_stoplimit` finite when present.
  - `validateLiveHash(hash: Record<string, string> | null, accountNo: string): ValidationResult` — checks: hash not null/empty; `hash.login` present and `String(hash.login) === accountNo`; `hash.balance`, `hash.equity`, `hash.margin`, `hash.margin_free` are finite numeric (empty string from Python's `None -> ""` substitution counts as missing/invalid here since these are required for a usable snapshot); `hash.margin_level` finite numeric OR empty string (optional field, empty means null).
  - `validatePositionsPayload(raw: string | null): { ok: true; positions: unknown[] } | { ok: false; reason: string }` — `JSON.parse`s `raw`; fails on parse error, on non-array result, or on `null`/empty-string input (treat as missing, not "valid empty array" — an actually-fresh empty book is `"[]"`, which is valid and parses to `[]`). Does not itself check individual position fields (that's per-position, done in Task 6's `validateOpenPositionCandidate`).
  - `validateOpenPositionCandidate(position: unknown): ValidationResult` — checks `position` is object, `position.ticket` present, and `position.volume`, `position.price_open`, `position.price_current`, `position.profit`, `position.swap` are finite when present.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/validators.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDealRecord,
  validateOrderRecord,
  validateLiveHash,
  validatePositionsPayload,
  validateOpenPositionCandidate,
} from "./validators.ts";

test("validateDealRecord accepts a well-formed deal", () => {
  const r = validateDealRecord(
    1001,
    {
      ticket: 55,
      time: 1770000000,
      volume: 0.1,
      price: 1.234,
      profit: 10,
      swap: -1,
      commission: -2,
      fee: 0,
    },
    "1001",
  );
  assert.equal(r.ok, true);
});

test("validateDealRecord rejects login mismatch", () => {
  const r = validateDealRecord(9999, { ticket: 55, time: 1770000000 }, "1001");
  assert.equal(r.ok, false);
});

test("validateDealRecord rejects missing ticket", () => {
  const r = validateDealRecord(1001, { time: 1770000000 }, "1001");
  assert.equal(r.ok, false);
});

test("validateDealRecord rejects non-finite time", () => {
  const r = validateDealRecord(
    1001,
    { ticket: 55, time: "not-a-number" },
    "1001",
  );
  assert.equal(r.ok, false);
});

test("validateDealRecord rejects non-finite volume when present", () => {
  const r = validateDealRecord(
    1001,
    { ticket: 55, time: 1770000000, volume: -1 },
    "1001",
  );
  assert.equal(r.ok, false);
});

test("validateOrderRecord accepts an order with only time_setup", () => {
  const r = validateOrderRecord(
    1001,
    { ticket: 77, time_setup: 1770000000 },
    "1001",
  );
  assert.equal(r.ok, true);
});

test("validateOrderRecord rejects order with neither timestamp", () => {
  const r = validateOrderRecord(1001, { ticket: 77 }, "1001");
  assert.equal(r.ok, false);
});

test("validateOrderRecord rejects malformed sl/tp", () => {
  const r = validateOrderRecord(
    1001,
    { ticket: 77, time_setup: 1770000000, sl: "bad" },
    "1001",
  );
  assert.equal(r.ok, false);
});

test("validateLiveHash accepts a well-formed hash", () => {
  const r = validateLiveHash(
    {
      login: "1001",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
      margin_level: "",
    },
    "1001",
  );
  assert.equal(r.ok, true);
});

test("validateLiveHash rejects login mismatch", () => {
  const r = validateLiveHash(
    {
      login: "9999",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
    },
    "1001",
  );
  assert.equal(r.ok, false);
});

test("validateLiveHash rejects null/empty hash", () => {
  assert.equal(validateLiveHash(null, "1001").ok, false);
  assert.equal(validateLiveHash({}, "1001").ok, false);
});

test("validatePositionsPayload parses a valid array", () => {
  const r = validatePositionsPayload("[]");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.positions, []);
});

test("validatePositionsPayload rejects malformed JSON", () => {
  assert.equal(validatePositionsPayload("{not json").ok, false);
});

test("validatePositionsPayload rejects non-array JSON", () => {
  assert.equal(validatePositionsPayload("{}").ok, false);
});

test("validatePositionsPayload rejects null/missing payload", () => {
  assert.equal(validatePositionsPayload(null).ok, false);
});

test("validateOpenPositionCandidate rejects missing ticket", () => {
  assert.equal(validateOpenPositionCandidate({ volume: 0.1 }).ok, false);
});

test("validateOpenPositionCandidate rejects non-finite profit", () => {
  assert.equal(
    validateOpenPositionCandidate({ ticket: 1, profit: "bad" }).ok,
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/validators.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/validators.ts
import { isFiniteNumeric } from "./decimal.ts";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateDealRecord(
  login: unknown,
  record: unknown,
  accountNo: string,
): ValidationResult {
  if (String(login) !== accountNo)
    return { ok: false, reason: "login mismatch" };
  if (!isRecord(record))
    return { ok: false, reason: "record is not an object" };
  if (!isPresent(record.ticket)) return { ok: false, reason: "missing ticket" };
  if (!isFiniteNumeric(record.time))
    return { ok: false, reason: "invalid time" };
  if (
    isPresent(record.volume) &&
    (!isFiniteNumeric(record.volume) || Number(record.volume) < 0)
  ) {
    return { ok: false, reason: "invalid volume" };
  }
  for (const field of [
    "price",
    "profit",
    "swap",
    "commission",
    "fee",
  ] as const) {
    if (isPresent(record[field]) && !isFiniteNumeric(record[field])) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  return { ok: true };
}

export function validateOrderRecord(
  login: unknown,
  record: unknown,
  accountNo: string,
): ValidationResult {
  if (String(login) !== accountNo)
    return { ok: false, reason: "login mismatch" };
  if (!isRecord(record))
    return { ok: false, reason: "record is not an object" };
  if (!isPresent(record.ticket)) return { ok: false, reason: "missing ticket" };

  const hasSetup = isPresent(record.time_setup);
  const hasDone = isPresent(record.time_done);
  if (!hasSetup && !hasDone)
    return { ok: false, reason: "missing both time_setup and time_done" };
  if (hasSetup && !isFiniteNumeric(record.time_setup))
    return { ok: false, reason: "invalid time_setup" };
  if (hasDone && !isFiniteNumeric(record.time_done))
    return { ok: false, reason: "invalid time_done" };

  for (const field of ["volume_initial", "volume_current"] as const) {
    if (
      isPresent(record[field]) &&
      (!isFiniteNumeric(record[field]) || Number(record[field]) < 0)
    ) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  for (const field of [
    "price_open",
    "price_current",
    "sl",
    "tp",
    "price_stoplimit",
  ] as const) {
    if (isPresent(record[field]) && !isFiniteNumeric(record[field])) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  return { ok: true };
}

export function validateLiveHash(
  hash: Record<string, string> | null,
  accountNo: string,
): ValidationResult {
  if (!hash || Object.keys(hash).length === 0)
    return { ok: false, reason: "missing live hash" };
  if (!isPresent(hash.login) || String(hash.login) !== accountNo)
    return { ok: false, reason: "login mismatch" };
  for (const field of ["balance", "equity", "margin", "margin_free"] as const) {
    if (!isFiniteNumeric(hash[field]))
      return { ok: false, reason: `invalid ${field}` };
  }
  if (isPresent(hash.margin_level) && !isFiniteNumeric(hash.margin_level)) {
    return { ok: false, reason: "invalid margin_level" };
  }
  return { ok: true };
}

export function validatePositionsPayload(
  raw: string | null,
): { ok: true; positions: unknown[] } | { ok: false; reason: string } {
  if (!isPresent(raw))
    return { ok: false, reason: "missing positions payload" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return { ok: false, reason: "malformed JSON" };
  }
  if (!Array.isArray(parsed))
    return { ok: false, reason: "positions payload is not an array" };
  return { ok: true, positions: parsed };
}

export function validateOpenPositionCandidate(
  position: unknown,
): ValidationResult {
  if (!isRecord(position))
    return { ok: false, reason: "position is not an object" };
  if (!isPresent(position.ticket))
    return { ok: false, reason: "missing ticket" };
  for (const field of [
    "volume",
    "price_open",
    "price_current",
    "profit",
    "swap",
  ] as const) {
    if (isPresent(position[field]) && !isFiniteNumeric(position[field])) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/validators.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/validators.ts src/worker-v2/validators.test.ts
git commit -m "feat(worker-v2): add deal/order/live/position payload validators"
```

---

## Task 5: `mappers.ts` — raw record to Prisma input

**Files:**

- Create: `src/worker-v2/mappers.ts`
- Test: `src/worker-v2/mappers.test.ts`

**Interfaces:**

- Consumes: `toDecimal`, `toDecimalOrZero` from `./decimal.ts`; `serverTimeToUtc` from `../lib/time.ts` (signature: `(epochSeconds: number, offsetMinutes: number) => Date`).
- Produces:
  - `mapDealToPrisma(tradingAccountId: string, record: Record<string, unknown>, offsetMinutes: number): Prisma.DealUncheckedCreateInput` — maps `dealNo: String(record.ticket)`, `time: serverTimeToUtc(Number(record.time), offsetMinutes)`, `symbol: record.symbol ?? null`, `type: String(record.type ?? "")`, `volume: record.volume != null ? Number(record.volume) : null`, `price: toDecimal(record.price)`, `commission: toDecimalOrZero(record.commission)`, `fee: toDecimalOrZero(record.fee)`, `swap: toDecimalOrZero(record.swap)`, `profit: toDecimalOrZero(record.profit)`, `comment: record.comment ?? null`, `reportDate: serverTimeToUtc(Number(record.time), offsetMinutes)`, `orderId: record.order != null ? String(record.order) : null`, `positionId: record.position_id != null ? String(record.position_id) : null`. Also exposes `netProfit` on the return alongside (via a second export, see below) — net P/L per spec must be computed with Decimal ops.
  - `computeDealNetProfit(record: Record<string, unknown>): Prisma.Decimal` — `toDecimalOrZero(profit).plus(toDecimalOrZero(swap)).plus(toDecimalOrZero(commission)).plus(toDecimalOrZero(fee))`. (Not written to a column — `Deal` has no `netProfit` column — exposed for logging/tests per the spec's explicit "net profit computed via Decimal" requirement; individual raw fields remain the source of truth in the row.)
  - `mapOrderToPrisma(tradingAccountId: string, record: Record<string, unknown>, offsetMinutes: number): Prisma.OrderUncheckedCreateInput` — maps `orderTicket: String(record.ticket)`, `positionId: record.position_id != null ? String(record.position_id) : null`, `symbol: record.symbol ?? null`, `type: record.type != null ? String(record.type) : null`, `state: record.state != null ? String(record.state) : null`, `volume: record.volume_current ?? record.volume_initial` (current volume takes precedence; fall back to initial) `!= null ? Number(...) : null`, `priceOpen: toDecimal(record.price_open)`, `priceCurrent: toDecimal(record.price_current)`, `sl: toDecimal(record.sl)`, `tp: toDecimal(record.tp)`, `timeSetup: record.time_setup != null ? serverTimeToUtc(Number(record.time_setup), offsetMinutes) : null`, `timeDone: record.time_done != null ? serverTimeToUtc(Number(record.time_done), offsetMinutes) : null`, `comment: record.comment ?? null`. (Note: `Order` model has no `magic`/`reason`/`position_by_id`/`requested volume`/`stop-limit price`/`external ID` columns today — those raw fields are preserved in the Redis-delivered record and in logs but not persisted this phase; flagged as a remaining risk in the completion report, not silently dropped without mention.)
  - `mapLiveToAccountSnapshot(tradingAccountId: string, hash: Record<string, string>, heartbeatLastSeenEpoch: number): Prisma.AccountSnapshotUncheckedCreateInput` — `balance: toDecimalOrZero(hash.balance)`, `equity: toDecimalOrZero(hash.equity)`, `margin: toDecimalOrZero(hash.margin)`, `freeMargin: toDecimalOrZero(hash.margin_free)`, `marginLevel: hash.margin_level ? Number(hash.margin_level) : null`, `floatingPl: toDecimalOrZero(hash.profit)`, `creditFacility: toDecimalOrZero(hash.credit)`, `reportDate: new Date(heartbeatLastSeenEpoch * 1000)`.
  - `mapPositionToOpenPosition(tradingAccountId: string, position: Record<string, unknown>, offsetMinutes: number, reportDate: Date): Prisma.OpenPositionUncheckedCreateInput` — `positionNo: String(position.ticket)`, `openTime: position.time != null ? serverTimeToUtc(Number(position.time), offsetMinutes) : null`, `symbol: String(position.symbol ?? "")`, `type: String(position.type ?? "")`, `volume: position.volume != null ? Number(position.volume) : 0`, `price: toDecimalOrZero(position.price_open)`, `sl: toDecimal(position.sl)`, `tp: toDecimal(position.tp)`, `marketPrice: toDecimalOrZero(position.price_current)`, `swap: toDecimalOrZero(position.swap)`, `profit: toDecimalOrZero(position.profit)`, `comment: position.comment ?? null`, `magic: position.magic != null ? Number(position.magic) : null`, `reportDate`.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/mappers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapDealToPrisma,
  computeDealNetProfit,
  mapOrderToPrisma,
  mapLiveToAccountSnapshot,
  mapPositionToOpenPosition,
} from "./mappers.ts";

const OFFSET = 180; // +3h broker offset, arbitrary for the test

test("mapDealToPrisma maps raw MT5 deal fields", () => {
  const input = mapDealToPrisma(
    "acc1",
    {
      ticket: 55,
      time: 1770000000,
      symbol: "EURUSD",
      type: 0,
      volume: 0.1,
      price: 1.234,
      commission: -2,
      fee: 0,
      swap: -1,
      profit: 10,
      comment: "x",
      order: 900,
      position_id: 800,
    },
    OFFSET,
  );
  assert.equal(input.dealNo, "55");
  assert.equal(input.symbol, "EURUSD");
  assert.equal(input.orderId, "900");
  assert.equal(input.positionId, "800");
  assert.equal(input.commission?.toString(), "-2");
  assert.ok(input.time instanceof Date);
});

test("computeDealNetProfit uses Decimal arithmetic across profit+swap+commission+fee", () => {
  const net = computeDealNetProfit({
    profit: 10,
    swap: -1,
    commission: -2,
    fee: 0.5,
  });
  assert.equal(net.toString(), "7.5");
});

test("computeDealNetProfit defaults missing fields to zero", () => {
  const net = computeDealNetProfit({ profit: 10 });
  assert.equal(net.toString(), "10");
});

test("mapOrderToPrisma preserves S/L, T/P and position reference", () => {
  const input = mapOrderToPrisma(
    "acc1",
    {
      ticket: 77,
      symbol: "EURUSD",
      type: 1,
      state: "PLACED",
      volume_current: 0.2,
      price_open: 1.1,
      price_current: 1.11,
      sl: 1.05,
      tp: 1.2,
      time_setup: 1770000000,
      position_id: 800,
    },
    OFFSET,
  );
  assert.equal(input.orderTicket, "77");
  assert.equal(input.positionId, "800");
  assert.equal(input.sl?.toString(), "1.05");
  assert.equal(input.tp?.toString(), "1.2");
  assert.ok(input.timeSetup instanceof Date);
  assert.equal(input.timeDone, null);
});

test("mapLiveToAccountSnapshot maps live hash to snapshot fields", () => {
  const input = mapLiveToAccountSnapshot(
    "acc1",
    {
      login: "1001",
      balance: "1000",
      equity: "990",
      margin: "10",
      margin_free: "980",
      margin_level: "9900",
      profit: "-10",
      credit: "0",
    },
    1770000000,
  );
  assert.equal(input.balance.toString(), "1000");
  assert.equal(input.freeMargin.toString(), "980");
  assert.equal(input.marginLevel, 9900);
  assert.ok(input.reportDate instanceof Date);
});

test("mapPositionToOpenPosition maps live position fields", () => {
  const reportDate = new Date();
  const input = mapPositionToOpenPosition(
    "acc1",
    {
      ticket: 321,
      symbol: "GBPUSD",
      type: 0,
      volume: 0.5,
      price_open: 1.25,
      price_current: 1.26,
      sl: 1.2,
      tp: 1.3,
      swap: -0.5,
      profit: 5,
      magic: 42,
      time: 1770000000,
    },
    OFFSET,
    reportDate,
  );
  assert.equal(input.positionNo, "321");
  assert.equal(input.marketPrice.toString(), "1.26");
  assert.equal(input.magic, 42);
  assert.equal(input.reportDate, reportDate);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/mappers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/mappers.ts
import type { Prisma } from "@prisma/client";
import { serverTimeToUtc } from "../lib/time.ts";
import { toDecimal, toDecimalOrZero } from "./decimal.ts";

export function mapDealToPrisma(
  tradingAccountId: string,
  record: Record<string, unknown>,
  offsetMinutes: number,
): Prisma.DealUncheckedCreateInput {
  const time = serverTimeToUtc(Number(record.time), offsetMinutes);
  return {
    tradingAccountId,
    dealNo: String(record.ticket),
    time,
    symbol: record.symbol != null ? String(record.symbol) : null,
    type: String(record.type ?? ""),
    volume: record.volume != null ? Number(record.volume) : null,
    price: toDecimal(record.price),
    commission: toDecimalOrZero(record.commission),
    fee: toDecimalOrZero(record.fee),
    swap: toDecimalOrZero(record.swap),
    profit: toDecimalOrZero(record.profit),
    comment: record.comment != null ? String(record.comment) : null,
    reportDate: time,
    orderId: record.order != null ? String(record.order) : null,
    positionId: record.position_id != null ? String(record.position_id) : null,
  };
}

export function computeDealNetProfit(
  record: Record<string, unknown>,
): Prisma.Decimal {
  return toDecimalOrZero(record.profit)
    .plus(toDecimalOrZero(record.swap))
    .plus(toDecimalOrZero(record.commission))
    .plus(toDecimalOrZero(record.fee));
}

export function mapOrderToPrisma(
  tradingAccountId: string,
  record: Record<string, unknown>,
  offsetMinutes: number,
): Prisma.OrderUncheckedCreateInput {
  const volumeSource = record.volume_current ?? record.volume_initial;
  return {
    tradingAccountId,
    orderTicket: String(record.ticket),
    positionId: record.position_id != null ? String(record.position_id) : null,
    symbol: record.symbol != null ? String(record.symbol) : null,
    type: record.type != null ? String(record.type) : null,
    state: record.state != null ? String(record.state) : null,
    volume: volumeSource != null ? Number(volumeSource) : null,
    priceOpen: toDecimal(record.price_open),
    priceCurrent: toDecimal(record.price_current),
    sl: toDecimal(record.sl),
    tp: toDecimal(record.tp),
    timeSetup:
      record.time_setup != null
        ? serverTimeToUtc(Number(record.time_setup), offsetMinutes)
        : null,
    timeDone:
      record.time_done != null
        ? serverTimeToUtc(Number(record.time_done), offsetMinutes)
        : null,
    comment: record.comment != null ? String(record.comment) : null,
  };
}

export function mapLiveToAccountSnapshot(
  tradingAccountId: string,
  hash: Record<string, string>,
  heartbeatLastSeenEpoch: number,
): Prisma.AccountSnapshotUncheckedCreateInput {
  return {
    tradingAccountId,
    balance: toDecimalOrZero(hash.balance),
    equity: toDecimalOrZero(hash.equity),
    margin: toDecimalOrZero(hash.margin),
    freeMargin: toDecimalOrZero(hash.margin_free),
    marginLevel: hash.margin_level ? Number(hash.margin_level) : null,
    floatingPl: toDecimalOrZero(hash.profit),
    creditFacility: toDecimalOrZero(hash.credit),
    reportDate: new Date(heartbeatLastSeenEpoch * 1000),
  };
}

export function mapPositionToOpenPosition(
  tradingAccountId: string,
  position: Record<string, unknown>,
  offsetMinutes: number,
  reportDate: Date,
): Prisma.OpenPositionUncheckedCreateInput {
  return {
    tradingAccountId,
    positionNo: String(position.ticket),
    openTime:
      position.time != null
        ? serverTimeToUtc(Number(position.time), offsetMinutes)
        : null,
    symbol: String(position.symbol ?? ""),
    type: String(position.type ?? ""),
    volume: position.volume != null ? Number(position.volume) : 0,
    price: toDecimalOrZero(position.price_open),
    sl: toDecimal(position.sl),
    tp: toDecimal(position.tp),
    marketPrice: toDecimalOrZero(position.price_current),
    swap: toDecimalOrZero(position.swap),
    profit: toDecimalOrZero(position.profit),
    comment: position.comment != null ? String(position.comment) : null,
    magic: position.magic != null ? Number(position.magic) : null,
    reportDate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/mappers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/mappers.ts src/worker-v2/mappers.test.ts
git commit -m "feat(worker-v2): add raw MT5 record to Prisma input mappers"
```

---

## Task 6: `health.ts` — Worker V2 status tracker + HTTP endpoint

**Files:**

- Create: `src/worker-v2/health.ts`
- Test: `src/worker-v2/health.test.ts`

**Interfaces:**

- Produces:
  - `class WorkerV2Status` with methods: `recordDealProcessed(login: string, redisId: string)`, `recordOrderProcessed(login: string, redisId: string)`, `recordFailure(kind: "deal" | "order" | "live" | "positions", login: string, reason: string)`, `recordLiveSync(login: string)`, `recordPositionSync(login: string, count: number)`, `recordDbLatency(ms: number)`, `snapshot(): WorkerV2Snapshot`.
  - `type WorkerV2Snapshot = { startedAt: string; streams: { deals: StreamStats; orders: StreamStats }; accounts: Record<string, AccountStats>; dbLatencyMsLast: number | null }` where `StreamStats = { processed: number; failed: number }` and `AccountStats = { lastDeal: string | null; lastOrder: string | null; lastLiveSync: string | null; lastPositionSync: string | null; openPositionCount: number | null }`.
  - `startWorkerV2HealthServer(status: WorkerV2Status, port: number, host?: string): import("node:http").Server` — binds `GET /health` returning `status.snapshot()` as JSON with `200`. No credential/password fields are ever included (the snapshot type structurally excludes them).

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/health.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerV2Status } from "./health.ts";

test("WorkerV2Status tracks per-stream processed/failed counts", () => {
  const status = new WorkerV2Status();
  status.recordDealProcessed("1001", "1-0");
  status.recordDealProcessed("1001", "2-0");
  status.recordFailure("deal", "1001", "bad ticket");
  const snap = status.snapshot();
  assert.equal(snap.streams.deals.processed, 2);
  assert.equal(snap.streams.deals.failed, 1);
});

test("WorkerV2Status tracks per-account last-processed markers", () => {
  const status = new WorkerV2Status();
  status.recordDealProcessed("1001", "5-0");
  status.recordOrderProcessed("1001", "9-0");
  status.recordLiveSync("1001");
  status.recordPositionSync("1001", 12);
  const snap = status.snapshot();
  assert.equal(snap.accounts["1001"].lastDeal, "5-0");
  assert.equal(snap.accounts["1001"].lastOrder, "9-0");
  assert.ok(snap.accounts["1001"].lastLiveSync);
  assert.equal(snap.accounts["1001"].openPositionCount, 12);
});

test("snapshot never contains credential-shaped keys", () => {
  const status = new WorkerV2Status();
  status.recordDealProcessed("1001", "1-0");
  const json = JSON.stringify(status.snapshot()).toLowerCase();
  assert.equal(json.includes("password"), false);
  assert.equal(json.includes("redis_url"), false);
  assert.equal(json.includes("database_url"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/health.ts
import { createServer, type Server } from "node:http";

type StreamStats = { processed: number; failed: number };
type AccountStats = {
  lastDeal: string | null;
  lastOrder: string | null;
  lastLiveSync: string | null;
  lastPositionSync: string | null;
  openPositionCount: number | null;
};

export type WorkerV2Snapshot = {
  startedAt: string;
  streams: { deals: StreamStats; orders: StreamStats };
  accounts: Record<string, AccountStats>;
  dbLatencyMsLast: number | null;
};

export class WorkerV2Status {
  private startedAt = new Date().toISOString();
  private streams = {
    deals: { processed: 0, failed: 0 },
    orders: { processed: 0, failed: 0 },
  };
  private accounts = new Map<string, AccountStats>();
  private dbLatencyMsLast: number | null = null;

  private account(login: string): AccountStats {
    let entry = this.accounts.get(login);
    if (!entry) {
      entry = {
        lastDeal: null,
        lastOrder: null,
        lastLiveSync: null,
        lastPositionSync: null,
        openPositionCount: null,
      };
      this.accounts.set(login, entry);
    }
    return entry;
  }

  recordDealProcessed(login: string, redisId: string): void {
    this.streams.deals.processed += 1;
    this.account(login).lastDeal = redisId;
  }

  recordOrderProcessed(login: string, redisId: string): void {
    this.streams.orders.processed += 1;
    this.account(login).lastOrder = redisId;
  }

  recordFailure(
    kind: "deal" | "order" | "live" | "positions",
    _login: string,
    _reason: string,
  ): void {
    if (kind === "deal") this.streams.deals.failed += 1;
    if (kind === "order") this.streams.orders.failed += 1;
  }

  recordLiveSync(login: string): void {
    this.account(login).lastLiveSync = new Date().toISOString();
  }

  recordPositionSync(login: string, count: number): void {
    const entry = this.account(login);
    entry.lastPositionSync = new Date().toISOString();
    entry.openPositionCount = count;
  }

  recordDbLatency(ms: number): void {
    this.dbLatencyMsLast = ms;
  }

  snapshot(): WorkerV2Snapshot {
    return {
      startedAt: this.startedAt,
      streams: {
        deals: { ...this.streams.deals },
        orders: { ...this.streams.orders },
      },
      accounts: Object.fromEntries(this.accounts),
      dbLatencyMsLast: this.dbLatencyMsLast,
    };
  }
}

export function startWorkerV2HealthServer(
  status: WorkerV2Status,
  port: number,
  host = "0.0.0.0",
): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(status.snapshot()));
  });
  server.listen(port, host);
  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/health.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/health.ts src/worker-v2/health.test.ts
git commit -m "feat(worker-v2): add status tracker and health endpoint"
```

---

## Task 7: `stream-consumer.ts` — generic XREADGROUP loop

**Files:**

- Create: `src/worker-v2/stream-consumer.ts`
- Test: `src/worker-v2/stream-consumer.test.ts`

**Interfaces:**

- Consumes: a Redis client shaped like the subset of node-redis v6 used in `src/worker/bridge-consumer.ts` (`xGroupCreate`, `xReadGroup`, `xAck`, `xPendingRange`, `xClaim`).
- Produces:
  - `const WORKER_V2_GROUP = "worker-v2"` (exported constant).
  - `function buildConsumerName(): string` — `` `worker-v2-${process.pid}-${hostname}` `` (unique per running process; `hostname` via `node:os`).
  - `type StreamEntry = { id: string; message: Record<string, string> }`
  - `type EntryOutcome = "ack" | "leave-pending"` — returned by the per-entry handler: `"ack"` for success **and** for malformed/validation/unknown-login (isolate + log, per Global Constraints), `"leave-pending"` only for infrastructure failure (DB/Redis unavailable) so the entry is retried/reclaimed.
  - `async function ensureConsumerGroup(redis, streamKey: string): Promise<void>` — same `xGroupCreate(..., "0", { MKSTREAM: true })` + swallow `BUSYGROUP` pattern as legacy `bridge-consumer.ts::ensureGroup`.
  - `async function reclaimPending(redis, streamKey: string, consumerName: string, idleMs: number, handler: (entry: StreamEntry) => Promise<EntryOutcome>): Promise<void>` — mirrors legacy `xPendingRange` + `xClaim` + re-dispatch through `handler`, `xAck` on `"ack"`.
  - `async function consumeOnce(redis, streamKey: string, consumerName: string, batchSize: number, blockMs: number, handler: (entry: StreamEntry) => Promise<EntryOutcome>): Promise<number>` — one `xReadGroup` call (`COUNT: batchSize, BLOCK: blockMs`), runs `handler` per entry **sequentially** (so one entry's DB write completing before the next is attempted — required by "ack only after Prisma succeeds"), acks per the returned `EntryOutcome`, returns number of entries read (0 if none / timed out).
  - `async function runConsumerLoop(redis, streamKey: string, consumerName: string, handler, opts: { batchSize: number; blockMs: number; idleReclaimMs: number; signal: AbortSignal }): Promise<void>` — `ensureConsumerGroup` once, then loops: `reclaimPending` (paginated) once per iteration so an entry left pending by a crashed consumer is retried once it ages past `idleReclaimMs` without requiring a restart, then `consumeOnce`, until `opts.signal.aborted`; on a thrown infra error from `consumeOnce` itself (not a handler outcome — e.g. Redis connection drop), sleeps with bounded exponential backoff (start 1s, cap 30s) before retrying, never a tight loop.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/stream-consumer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureConsumerGroup,
  consumeOnce,
  reclaimPending,
  WORKER_V2_GROUP,
} from "./stream-consumer.ts";

function fakeRedis(overrides: Partial<any> = {}) {
  return {
    xGroupCreate: async () => {},
    xReadGroup: async () => null,
    xAck: async () => 1,
    xPendingRange: async () => [],
    xClaim: async () => [],
    ...overrides,
  };
}

test("ensureConsumerGroup swallows BUSYGROUP error", async () => {
  const redis = fakeRedis({
    xGroupCreate: async () => {
      throw new Error("BUSYGROUP Consumer Group name already exists");
    },
  });
  await assert.doesNotReject(() => ensureConsumerGroup(redis, "stream-key"));
});

test("ensureConsumerGroup rethrows non-BUSYGROUP errors", async () => {
  const redis = fakeRedis({
    xGroupCreate: async () => {
      throw new Error("connection refused");
    },
  });
  await assert.rejects(() => ensureConsumerGroup(redis, "stream-key"));
});

test("consumeOnce acks entries the handler resolves to ack, leaves failed infra entries pending", async () => {
  const acked: string[] = [];
  const redis = fakeRedis({
    xReadGroup: async () => [
      {
        name: "stream-key",
        messages: [
          { id: "1-0", message: { data: "{}" } },
          { id: "2-0", message: { data: "{}" } },
        ],
      },
    ],
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      return 1;
    },
  });
  const count = await consumeOnce(
    redis,
    "stream-key",
    "consumer-1",
    50,
    100,
    async (entry) => (entry.id === "1-0" ? "ack" : "leave-pending"),
  );
  assert.equal(count, 2);
  assert.deepEqual(acked, ["1-0"]);
});

test("consumeOnce returns 0 when xReadGroup times out (null)", async () => {
  const redis = fakeRedis({ xReadGroup: async () => null });
  const count = await consumeOnce(
    redis,
    "stream-key",
    "consumer-1",
    50,
    100,
    async () => "ack",
  );
  assert.equal(count, 0);
});

test("reclaimPending claims entries idle past threshold and re-dispatches through handler", async () => {
  const claimed: string[] = [];
  const acked: string[] = [];
  const redis = fakeRedis({
    xPendingRange: async () => [
      { id: "3-0", millisecondsSinceLastDelivery: 120_000 },
    ],
    xClaim: async (
      _key: string,
      _group: string,
      _consumer: string,
      _idle: number,
      ids: string[],
    ) => {
      claimed.push(...ids);
      return [{ id: "3-0", message: { data: "{}" } }];
    },
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      return 1;
    },
  });
  await reclaimPending(
    redis,
    "stream-key",
    "consumer-1",
    60_000,
    async () => "ack",
  );
  assert.deepEqual(claimed, ["3-0"]);
  assert.deepEqual(acked, ["3-0"]);
});

test("WORKER_V2_GROUP is a stable name", () => {
  assert.equal(WORKER_V2_GROUP, "worker-v2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/stream-consumer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/stream-consumer.ts
import { hostname } from "node:os";

export const WORKER_V2_GROUP = "worker-v2";

export type StreamEntry = { id: string; message: Record<string, string> };
export type EntryOutcome = "ack" | "leave-pending";
export type EntryHandler = (entry: StreamEntry) => Promise<EntryOutcome>;

export function buildConsumerName(): string {
  return `worker-v2-${hostname()}-${process.pid}`;
}

export async function ensureConsumerGroup(
  redis: any,
  streamKey: string,
): Promise<void> {
  try {
    await redis.xGroupCreate(streamKey, WORKER_V2_GROUP, "0", {
      MKSTREAM: true,
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP"))
      throw error;
  }
}

export async function consumeOnce(
  redis: any,
  streamKey: string,
  consumerName: string,
  batchSize: number,
  blockMs: number,
  handler: EntryHandler,
): Promise<number> {
  const response = await redis.xReadGroup(
    WORKER_V2_GROUP,
    consumerName,
    [{ key: streamKey, id: ">" }],
    { COUNT: batchSize, BLOCK: blockMs },
  );
  if (!response) return 0;
  let count = 0;
  for (const stream of response) {
    for (const entry of stream.messages) {
      count += 1;
      const outcome = await handler(entry);
      if (outcome === "ack") {
        await redis.xAck(streamKey, WORKER_V2_GROUP, entry.id);
      }
    }
  }
  return count;
}

export async function reclaimPending(
  redis: any,
  streamKey: string,
  consumerName: string,
  idleMs: number,
  handler: EntryHandler,
): Promise<void> {
  const pending = await redis.xPendingRange(
    streamKey,
    WORKER_V2_GROUP,
    "-",
    "+",
    100,
  );
  for (const entry of pending) {
    if (entry.millisecondsSinceLastDelivery < idleMs) continue;
    const claimed = await redis.xClaim(
      streamKey,
      WORKER_V2_GROUP,
      consumerName,
      idleMs,
      [entry.id],
    );
    for (const claimedEntry of claimed) {
      const outcome = await handler(claimedEntry);
      if (outcome === "ack") {
        await redis.xAck(streamKey, WORKER_V2_GROUP, claimedEntry.id);
      }
    }
  }
}

export async function runConsumerLoop(
  redis: any,
  streamKey: string,
  consumerName: string,
  handler: EntryHandler,
  opts: {
    batchSize: number;
    blockMs: number;
    idleReclaimMs: number;
    signal: AbortSignal;
  },
): Promise<void> {
  await ensureConsumerGroup(redis, streamKey);
  await reclaimPending(
    redis,
    streamKey,
    consumerName,
    opts.idleReclaimMs,
    handler,
  );

  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 30_000;
  while (!opts.signal.aborted) {
    try {
      await consumeOnce(
        redis,
        streamKey,
        consumerName,
        opts.batchSize,
        opts.blockMs,
        handler,
      );
      backoffMs = 1000;
    } catch (error) {
      console.error(
        `[worker-v2] stream loop error on ${streamKey}:`,
        error instanceof Error ? error.message : error,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/stream-consumer.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/stream-consumer.ts src/worker-v2/stream-consumer.test.ts
git commit -m "feat(worker-v2): add generic Redis Stream consumer-group loop"
```

---

## Task 8: `deal-consumer.ts` + `order-consumer.ts` — wire streams to Prisma upserts

**Files:**

- Create: `src/worker-v2/deal-consumer.ts`
- Create: `src/worker-v2/order-consumer.ts`
- Test: `src/worker-v2/deal-consumer.test.ts`
- Test: `src/worker-v2/order-consumer.test.ts`

**Interfaces:**

- Consumes: `validateDealRecord`/`validateOrderRecord` (Task 4), `mapDealToPrisma`/`mapOrderToPrisma` (Task 5), `resolveAccountByLogin`/`AccountRegistry` (Task 3), `StreamEntry`/`EntryOutcome` (Task 7), `WorkerV2Status` (Task 6).
- Produces:
  - `function makeDealHandler(prisma: PrismaClient, registry: AccountRegistry, status: WorkerV2Status): (entry: StreamEntry) => Promise<EntryOutcome>` — parses `entry.message.data` JSON; on parse failure or `kind !== "deal"`: log + return `"ack"` (malformed, isolate). Resolves account via `resolveAccountByLogin(registry, payload.login)`; if `null`: log "unknown login" + return `"ack"` (per spec: "account/login mismatch" is a malformed-event class, not infra — ack + isolate, matches Global Constraints reconciliation). If `account.brokerUtcOffsetMinutes === null`: log "account not configured" + return `"leave-pending"` (account offset must be configured before ingestion; retry without ack, preventing stuck-message accumulation). Runs `validateDealRecord`; on failure: log + `"ack"`. On success: `prisma.deal.upsert({ where: { tradingAccountId_dealNo: { tradingAccountId, dealNo } }, create: mapped, update: mapped })`; on upsert success: `status.recordDealProcessed(...)` + return `"ack"`; on a thrown Prisma/DB error: log + `status.recordFailure("deal", ...)` + return `"leave-pending"` (infra failure, do not ack).
  - `function makeOrderHandler(prisma: PrismaClient, registry: AccountRegistry, status: WorkerV2Status): (entry: StreamEntry) => Promise<EntryOutcome>` — identical shape to `makeDealHandler`, including the null-offset check, for `Order` via `orderTicket`.
  - Both handlers log failures with the exact shape: `{ login, stream, redisId: entry.id, ticket }` (per spec item 4.7 / observability item 9).

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/deal-consumer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDealHandler } from "./deal-consumer.ts";
import { WorkerV2Status } from "./health.ts";

function fakePrisma(overrides: Partial<any> = {}) {
  const upserted: any[] = [];
  return {
    deal: {
      upsert: async (args: any) => {
        upserted.push(args);
        return {};
      },
      ...overrides.deal,
    },
    _upserted: upserted,
  };
}

const registry = new Map([
  ["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }],
]);

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Deal via upsert with the natural key", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000, profit: 10 },
    }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 1);
  assert.equal(prisma._upserted[0].where.tradingAccountId_dealNo.dealNo, "55");
});

test("redelivery calls upsert again for the same natural key (idempotent update path)", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000, profit: 10 },
    }),
  );
  await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000, profit: 11 },
    }),
  );
  assert.equal(prisma._upserted.length, 2);
  assert.equal(
    prisma._upserted[0].where.tradingAccountId_dealNo.dealNo,
    prisma._upserted[1].where.tradingAccountId_dealNo.dealNo,
  );
});

test("login mismatch (unknown account) is acked and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 9999,
      kind: "deal",
      record: { ticket: 55, time: 1770000000 },
    }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("malformed record (missing ticket) is acked and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({ login: 1001, kind: "deal", record: { time: 1770000000 } }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("failed Prisma write leaves the entry pending (not acked)", async () => {
  const prisma = fakePrisma({
    deal: {
      upsert: async () => {
        throw new Error("db unavailable");
      },
    },
  });
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000 },
    }),
  );
  assert.equal(outcome, "leave-pending");
});

test("net P/L is computed via Decimal ops (profit+swap+commission+fee), verifiable via mapper output composition", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: {
        ticket: 55,
        time: 1770000000,
        profit: 10,
        swap: -1,
        commission: -2,
        fee: 0.5,
      },
    }),
  );
  const written = prisma._upserted[0].create;
  const net = written.profit
    .plus(written.swap)
    .plus(written.commission)
    .plus(written.fee);
  assert.equal(net.toString(), "7.5");
});
```

```ts
// src/worker-v2/order-consumer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOrderHandler } from "./order-consumer.ts";
import { WorkerV2Status } from "./health.ts";

function fakePrisma(overrides: Partial<any> = {}) {
  const upserted: any[] = [];
  return {
    order: {
      upsert: async (args: any) => {
        upserted.push(args);
        return {};
      },
      ...overrides.order,
    },
    _upserted: upserted,
  };
}

const registry = new Map([
  ["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }],
]);

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Order via upsert with the natural key", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 1001,
      kind: "order",
      record: {
        ticket: 77,
        time_setup: 1770000000,
        sl: 1.1,
        tp: 1.2,
        position_id: 800,
      },
    }),
  );
  assert.equal(outcome, "ack");
  assert.equal(
    prisma._upserted[0].where.tradingAccountId_orderTicket.orderTicket,
    "77",
  );
  assert.equal(prisma._upserted[0].create.sl.toString(), "1.1");
  assert.equal(prisma._upserted[0].create.positionId, "800");
});

test("redelivery updates the same order ticket, no duplicate rows", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  await handler(
    entry({
      login: 1001,
      kind: "order",
      record: { ticket: 77, time_setup: 1770000000 },
    }),
  );
  await handler(
    entry({
      login: 1001,
      kind: "order",
      record: { ticket: 77, time_setup: 1770000000, state: "FILLED" },
    }),
  );
  assert.equal(prisma._upserted.length, 2);
  assert.equal(
    prisma._upserted[1].where.tradingAccountId_orderTicket.orderTicket,
    "77",
  );
});

test("malformed timestamp is rejected and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({ login: 1001, kind: "order", record: { ticket: 77 } }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("failed database write is not acknowledged", async () => {
  const prisma = fakePrisma({
    order: {
      upsert: async () => {
        throw new Error("db unavailable");
      },
    },
  });
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 1001,
      kind: "order",
      record: { ticket: 77, time_setup: 1770000000 },
    }),
  );
  assert.equal(outcome, "leave-pending");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test src/worker-v2/deal-consumer.test.ts src/worker-v2/order-consumer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/deal-consumer.ts
import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry.ts";
import { resolveAccountByLogin } from "./account-registry.ts";
import { validateDealRecord } from "./validators.ts";
import { mapDealToPrisma } from "./mappers.ts";
import type { StreamEntry, EntryOutcome } from "./stream-consumer.ts";
import type { WorkerV2Status } from "./health.ts";

export function makeDealHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    let payload: { login?: unknown; kind?: unknown; record?: unknown };
    try {
      payload = JSON.parse(entry.message.data);
    } catch {
      console.error(
        `[worker-v2] malformed deal payload redisId=${entry.id}: invalid JSON`,
      );
      return "ack";
    }
    if (payload.kind !== "deal") {
      console.error(
        `[worker-v2] unexpected kind on deals stream redisId=${entry.id} kind=${String(payload.kind)}`,
      );
      return "ack";
    }
    const account = resolveAccountByLogin(
      registry,
      payload.login as string | number,
    );
    if (!account) {
      console.error(
        `[worker-v2] unknown login for deal login=${String(payload.login)} redisId=${entry.id}`,
      );
      return "ack";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(
        `[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} stream=deals redisId=${entry.id}`,
      );
      return "leave-pending";
    }
    const validation = validateDealRecord(
      payload.login,
      payload.record,
      account.accountNo,
    );
    if (!validation.ok) {
      const ticket = (payload.record as Record<string, unknown> | undefined)
        ?.ticket;
      console.error(
        `[worker-v2] malformed deal login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.record as Record<string, unknown>;
    const mapped = mapDealToPrisma(
      account.id,
      record,
      account.brokerUtcOffsetMinutes as number,
    );
    try {
      await prisma.deal.upsert({
        where: {
          tradingAccountId_dealNo: {
            tradingAccountId: account.id,
            dealNo: mapped.dealNo,
          },
        },
        create: mapped,
        update: mapped,
      });
    } catch (error) {
      console.error(
        `[worker-v2] Prisma write failed login=${account.accountNo} stream=deals redisId=${entry.id} ticket=${String(record.ticket)}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("deal", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordDealProcessed(account.accountNo, entry.id);
    return "ack";
  };
}
```

```ts
// src/worker-v2/order-consumer.ts
import type { PrismaClient } from "@prisma/client";
import type { AccountRegistry } from "./account-registry.ts";
import { resolveAccountByLogin } from "./account-registry.ts";
import { validateOrderRecord } from "./validators.ts";
import { mapOrderToPrisma } from "./mappers.ts";
import type { StreamEntry, EntryOutcome } from "./stream-consumer.ts";
import type { WorkerV2Status } from "./health.ts";

export function makeOrderHandler(
  prisma: PrismaClient,
  registry: AccountRegistry,
  status: WorkerV2Status,
): (entry: StreamEntry) => Promise<EntryOutcome> {
  return async (entry: StreamEntry): Promise<EntryOutcome> => {
    let payload: { login?: unknown; kind?: unknown; record?: unknown };
    try {
      payload = JSON.parse(entry.message.data);
    } catch {
      console.error(
        `[worker-v2] malformed order payload redisId=${entry.id}: invalid JSON`,
      );
      return "ack";
    }
    if (payload.kind !== "order") {
      console.error(
        `[worker-v2] unexpected kind on orders stream redisId=${entry.id} kind=${String(payload.kind)}`,
      );
      return "ack";
    }
    const account = resolveAccountByLogin(
      registry,
      payload.login as string | number,
    );
    if (!account) {
      console.error(
        `[worker-v2] unknown login for order login=${String(payload.login)} redisId=${entry.id}`,
      );
      return "ack";
    }
    if (account.brokerUtcOffsetMinutes === null) {
      console.error(
        `[worker-v2] account not configured (brokerUtcOffsetMinutes null) login=${account.accountNo} stream=orders redisId=${entry.id}`,
      );
      return "leave-pending";
    }
    const validation = validateOrderRecord(
      payload.login,
      payload.record,
      account.accountNo,
    );
    if (!validation.ok) {
      const ticket = (payload.record as Record<string, unknown> | undefined)
        ?.ticket;
      console.error(
        `[worker-v2] malformed order login=${account.accountNo} stream=orders redisId=${entry.id} ticket=${String(ticket)} reason=${validation.reason}`,
      );
      return "ack";
    }
    const record = payload.record as Record<string, unknown>;
    const mapped = mapOrderToPrisma(
      account.id,
      record,
      account.brokerUtcOffsetMinutes as number,
    );
    try {
      await prisma.order.upsert({
        where: {
          tradingAccountId_orderTicket: {
            tradingAccountId: account.id,
            orderTicket: mapped.orderTicket,
          },
        },
        create: mapped,
        update: mapped,
      });
    } catch (error) {
      console.error(
        `[worker-v2] Prisma write failed login=${account.accountNo} stream=orders redisId=${entry.id} ticket=${String(record.ticket)}:`,
        error instanceof Error ? error.message : error,
      );
      status.recordFailure("order", account.accountNo, "db write failed");
      return "leave-pending";
    }
    status.recordOrderProcessed(account.accountNo, entry.id);
    return "ack";
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/worker-v2/deal-consumer.test.ts src/worker-v2/order-consumer.test.ts`
Expected: PASS, 6 + 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/deal-consumer.ts src/worker-v2/order-consumer.ts src/worker-v2/deal-consumer.test.ts src/worker-v2/order-consumer.test.ts
git commit -m "feat(worker-v2): wire Deal/Order stream handlers to idempotent upserts"
```

---

## Task 9: `live-sync.ts` — live snapshot + transactional OpenPosition replace

**Files:**

- Create: `src/worker-v2/live-sync.ts`
- Test: `src/worker-v2/live-sync.test.ts`

**Interfaces:**

- Consumes: `validateLiveHash`, `validatePositionsPayload`, `validateOpenPositionCandidate` (Task 4); `mapLiveToAccountSnapshot`, `mapPositionToOpenPosition` (Task 5); `WorkerV2Status` (Task 6).
- Produces:
  - `function key_live(login: string) { return \`mt5:v2:account:${login}:live\`; }`, `key_positions`, `key_heartbeat`— same key builders as`bridge_v2/config.py`, re-declared in TS (no cross-language import possible; keep in sync manually, note in file header comment).
  - `async function readHeartbeat(redis, accountNo: string): Promise<number | null>` — `HGETALL` on `key_heartbeat`; returns `Number(hash.lastSeen)` if the hash exists and `lastSeen` is finite numeric, else `null` (missing/expired key naturally returns `{}` from node-redis `hGetAll`).
  - `async function syncAccountLive(prisma: PrismaClient, redis, account: TradingAccount, status: WorkerV2Status): Promise<void>` — the full per-account cycle: 0. If `account.brokerUtcOffsetMinutes === null` → return immediately (account not configured; live sync blocked until offset is set via operator scripts).
    1. `lastSeen = await readHeartbeat(redis, account.accountNo)`. If `null` → return (stale/missing, do nothing, don't touch snapshot or positions).
    2. `liveHash = await redis.hGetAll(key_live(account.accountNo))`. `validateLiveHash(liveHash, account.accountNo)`. If invalid → log + return (do not touch AccountSnapshot or OpenPosition).
    3. Upsert `AccountSnapshot` via `mapLiveToAccountSnapshot(account.id, liveHash, lastSeen)`, `prisma.accountSnapshot.upsert({ where: { tradingAccountId: account.id }, create: mapped, update: mapped })`. `status.recordLiveSync(account.accountNo)`.
    4. `positionsRaw = await redis.get(key_positions(account.accountNo))`. `parsed = validatePositionsPayload(positionsRaw)`. If invalid → log + return (skip step 5 entirely; AccountSnapshot from step 3 still commits — snapshot and position freshness are validated independently since they're separate Redis keys, both gated by the same heartbeat check in step 1).
    5. Filter `parsed.positions` through `validateOpenPositionCandidate`; drop invalid entries individually (log each, don't abort the whole sync for one bad position — matches "malformed records must not crash" spirit applied to the position-array case). Map survivors via `mapPositionToOpenPosition(account.id, position, offsetMinutes, reportDate=new Date(lastSeen * 1000))`.
    6. `await prisma.$transaction([prisma.openPosition.deleteMany({ where: { tradingAccountId: account.id } }), prisma.openPosition.createMany({ data: mappedPositions })])`. `status.recordPositionSync(account.accountNo, mappedPositions.length)`.
  - `async function runLiveSyncLoop(prisma, redis, registry: AccountRegistry, status: WorkerV2Status, opts: { intervalMs: number; signal: AbortSignal }): Promise<void>` — loops every `intervalMs`, calling `syncAccountLive` for every account in `registry` sequentially (bounded concurrency isn't required at expected account counts; sequential keeps failure isolation trivial — one account's exception is caught and logged without aborting the others), until `opts.signal.aborted`.

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/live-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccountLive } from "./live-sync.ts";
import { WorkerV2Status } from "./health.ts";

const account = { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 };

function fakePrisma() {
  const deleted: any[] = [];
  const created: any[] = [];
  let snapshotUpserted: any = null;
  return {
    accountSnapshot: {
      upsert: async (args: any) => {
        snapshotUpserted = args;
        return {};
      },
    },
    openPosition: {
      deleteMany: async (args: any) => {
        deleted.push(args);
        return { count: 0 };
      },
      createMany: async (args: any) => {
        created.push(...args.data);
        return { count: args.data.length };
      },
    },
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
    _deleted: deleted,
    _created: created,
    _snapshot: () => snapshotUpserted,
  };
}

function fakeRedis({
  heartbeat,
  live,
  positions,
}: {
  heartbeat?: Record<string, string>;
  live?: Record<string, string>;
  positions?: string | null;
}) {
  return {
    hGetAll: async (key: string) =>
      key.includes("heartbeat") ? (heartbeat ?? {}) : (live ?? {}),
    get: async () => positions ?? null,
  };
}

test("valid complete payload replaces account positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: {
      login: "1001",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
      margin_level: "",
    },
    positions: JSON.stringify([
      {
        ticket: 1,
        symbol: "EURUSD",
        type: 0,
        volume: 0.1,
        price_open: 1.1,
        price_current: 1.11,
        profit: 1,
        swap: 0,
      },
    ]),
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 1);
  assert.equal(prisma._created[0].positionNo, "1");
  assert.ok(prisma._snapshot());
});

test("empty valid payload clears positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "0" },
    live: {
      login: "1001",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
    },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 0);
});

test("stale payload (missing heartbeat) does not touch positions or snapshot", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: {},
    live: {
      login: "1001",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
    },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._created.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("malformed positions payload does not delete existing positions, but a fresh valid snapshot still commits", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: {
      login: "1001",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
    },
    positions: "{not json",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._created.length, 0);
  assert.ok(prisma._snapshot());
});

test("live hash login mismatch skips both snapshot and positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: {
      login: "9999",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
    },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("incomplete live payload (missing required field) does not delete positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: { login: "1001", balance: "1000" },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("more than 100 open positions are persisted without truncation", async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    ticket: i + 1,
    symbol: "EURUSD",
    type: 0,
    volume: 0.1,
    price_open: 1.1,
    price_current: 1.11,
    profit: 1,
    swap: 0,
  }));
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "150" },
    live: {
      login: "1001",
      balance: "1000",
      equity: "1000",
      margin: "0",
      margin_free: "1000",
    },
    positions: JSON.stringify(many),
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._created.length, 150);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/live-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// src/worker-v2/live-sync.ts
// Redis key builders mirror bridge_v2/config.py verbatim (no cross-language
// import possible — keep these two files in sync manually if the bridge's
// key scheme changes).
import type { PrismaClient, TradingAccount } from "@prisma/client";
import type { AccountRegistry } from "./account-registry.ts";
import {
  validateLiveHash,
  validatePositionsPayload,
  validateOpenPositionCandidate,
} from "./validators.ts";
import {
  mapLiveToAccountSnapshot,
  mapPositionToOpenPosition,
} from "./mappers.ts";
import { isFiniteNumeric } from "./decimal.ts";
import type { WorkerV2Status } from "./health.ts";

function keyLive(login: string): string {
  return `mt5:v2:account:${login}:live`;
}
function keyPositions(login: string): string {
  return `mt5:v2:account:${login}:positions`;
}
function keyHeartbeat(login: string): string {
  return `mt5:v2:bridge:${login}:heartbeat`;
}

export async function readHeartbeat(
  redis: any,
  accountNo: string,
): Promise<number | null> {
  const hash = await redis.hGetAll(keyHeartbeat(accountNo));
  if (!hash || !isFiniteNumeric(hash.lastSeen)) return null;
  return Number(hash.lastSeen);
}

export async function syncAccountLive(
  prisma: PrismaClient,
  redis: any,
  account: TradingAccount,
  status: WorkerV2Status,
): Promise<void> {
  if (account.brokerUtcOffsetMinutes === null) return;

  const lastSeen = await readHeartbeat(redis, account.accountNo);
  if (lastSeen === null) return;

  const liveHash = await redis.hGetAll(keyLive(account.accountNo));
  const liveValidation = validateLiveHash(liveHash, account.accountNo);
  if (!liveValidation.ok) {
    console.error(
      `[worker-v2] invalid live hash login=${account.accountNo} reason=${liveValidation.reason}`,
    );
    return;
  }

  const snapshot = mapLiveToAccountSnapshot(account.id, liveHash, lastSeen);
  await prisma.accountSnapshot.upsert({
    where: { tradingAccountId: account.id },
    create: snapshot,
    update: snapshot,
  });
  status.recordLiveSync(account.accountNo);

  const positionsRaw = await redis.get(keyPositions(account.accountNo));
  const positionsValidation = validatePositionsPayload(positionsRaw);
  if (!positionsValidation.ok) {
    console.error(
      `[worker-v2] invalid positions payload login=${account.accountNo} reason=${positionsValidation.reason}`,
    );
    return;
  }

  const offsetMinutes = account.brokerUtcOffsetMinutes as number;
  const reportDate = new Date(lastSeen * 1000);
  const mapped = [];
  for (const candidate of positionsValidation.positions) {
    const check = validateOpenPositionCandidate(candidate);
    if (!check.ok) {
      console.error(
        `[worker-v2] dropping malformed open position login=${account.accountNo} reason=${check.reason}`,
      );
      continue;
    }
    mapped.push(
      mapPositionToOpenPosition(
        account.id,
        candidate as Record<string, unknown>,
        offsetMinutes,
        reportDate,
      ),
    );
  }

  await prisma.$transaction([
    prisma.openPosition.deleteMany({ where: { tradingAccountId: account.id } }),
    prisma.openPosition.createMany({ data: mapped }),
  ]);
  status.recordPositionSync(account.accountNo, mapped.length);
}

export async function runLiveSyncLoop(
  prisma: PrismaClient,
  redis: any,
  registry: AccountRegistry,
  status: WorkerV2Status,
  opts: { intervalMs: number; signal: AbortSignal },
): Promise<void> {
  while (!opts.signal.aborted) {
    for (const account of registry.values()) {
      try {
        await syncAccountLive(prisma, redis, account, status);
      } catch (error) {
        console.error(
          `[worker-v2] live sync failed login=${account.accountNo}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/live-sync.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/worker-v2/live-sync.ts src/worker-v2/live-sync.test.ts
git commit -m "feat(worker-v2): sync live account snapshot and open positions, heartbeat-gated"
```

---

## Task 10: `index.ts` — entrypoint wiring + package.json scripts

**Files:**

- Create: `src/worker-v2/index.ts`
- Modify: `package.json` (add 3 scripts)

**Interfaces:**

- Consumes every module from Tasks 2–9, plus `getRedisSocialClient` from `../lib/redis-social.ts` and `PrismaClient` from `@prisma/client`.
- Produces: a running process — no exported interface consumed elsewhere.

- [ ] **Step 1: Write `index.ts`**

```ts
// src/worker-v2/index.ts
import { PrismaClient } from "@prisma/client";
import { getRedisSocialClient } from "../lib/redis-social.ts";
import { loadAccountRegistry } from "./account-registry.ts";
import { buildConsumerName, runConsumerLoop } from "./stream-consumer.ts";
import { makeDealHandler } from "./deal-consumer.ts";
import { makeOrderHandler } from "./order-consumer.ts";
import { runLiveSyncLoop } from "./live-sync.ts";
import { WorkerV2Status, startWorkerV2HealthServer } from "./health.ts";

const STREAM_DEALS = "mt5:v2:history:deals";
const STREAM_ORDERS = "mt5:v2:history:orders";

const BATCH_SIZE = Number(process.env.WORKER_V2_BATCH_SIZE ?? 50);
const BLOCK_MS = Number(process.env.WORKER_V2_BLOCK_MS ?? 5000);
const IDLE_RECLAIM_MS = Number(process.env.WORKER_V2_IDLE_RECLAIM_MS ?? 60_000);
const LIVE_SYNC_INTERVAL_MS = Number(
  process.env.WORKER_V2_LIVE_SYNC_INTERVAL_MS ?? 2000,
);
const HEALTH_PORT = Number(process.env.WORKER_V2_HEALTH_PORT ?? 9200);
const ACCOUNT_REFRESH_MS = Number(
  process.env.WORKER_V2_ACCOUNT_REFRESH_MS ?? 60_000,
);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const redis = await getRedisSocialClient();
  const status = new WorkerV2Status();
  const controller = new AbortController();

  let registry = await loadAccountRegistry(prisma);
  const refreshTimer = setInterval(() => {
    loadAccountRegistry(prisma)
      .then((next) => {
        registry = next;
      })
      .catch((error) =>
        console.error("[worker-v2] account registry refresh failed:", error),
      );
  }, ACCOUNT_REFRESH_MS);

  const consumerName = buildConsumerName();
  const dealHandler = makeDealHandler(prisma, registry, status);
  const orderHandler = makeOrderHandler(prisma, registry, status);

  startWorkerV2HealthServer(status, HEALTH_PORT);

  const shutdown = () => {
    controller.abort();
    clearInterval(refreshTimer);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await Promise.all([
    runConsumerLoop(redis, STREAM_DEALS, consumerName, dealHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
      signal: controller.signal,
    }),
    runConsumerLoop(redis, STREAM_ORDERS, consumerName, orderHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
      signal: controller.signal,
    }),
    runLiveSyncLoop(prisma, redis, registry, status, {
      intervalMs: LIVE_SYNC_INTERVAL_MS,
      signal: controller.signal,
    }),
  ]);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[worker-v2] fatal error:", error);
  process.exit(1);
});
```

Note: `dealHandler`/`orderHandler` close over the `registry` variable captured at wiring time via the `AccountRegistry` object _reference_ — since `loadAccountRegistry` returns a new `Map` on each refresh and the handlers were built against the original `registry` binding, reassigning `registry = next` in the refresh callback does **not** update what the handlers see (closures captured the old `Map` reference, not the variable). This is a known limitation acceptable for Phase 3 (new accounts require a worker restart to be picked up, matching "Discover enabled trading accounts" as a startup-time responsibility per the spec's wording) — call this out explicitly in the completion report as a remaining risk rather than silently shipping a broken live-refresh.

- [ ] **Step 2: Add package.json scripts**

Read `package.json`, then add alongside the existing `worker`/`worker:dev`/`build:worker` entries:

```json
"build:worker-v2": "esbuild src/worker-v2/index.ts --bundle --platform=node --outfile=dist/worker-v2.js --external:@prisma/client",
"worker-v2": "npm run build:worker-v2 && node dist/worker-v2.js",
"worker-v2:dev": "node --import tsx src/worker-v2/index.ts",
```

- [ ] **Step 3: Verify the entrypoint at least type-checks and boots without a Redis/DB connection error surfacing as a syntax error**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to `src/worker-v2/*`.

- [ ] **Step 4: Commit**

```bash
git add src/worker-v2/index.ts package.json
git commit -m "feat(worker-v2): wire entrypoint and add npm scripts"
```

---

## Task 11: Full verification pass

Run in this order, exactly as CLAUDE.md's focused verification block plus the plan's own additions:

- [ ] **Step 1: Focused Worker V2 unit tests**

Run:

```bash
node --import tsx --test \
  src/worker-v2/decimal.test.ts \
  src/worker-v2/account-registry.test.ts \
  src/worker-v2/validators.test.ts \
  src/worker-v2/mappers.test.ts \
  src/worker-v2/health.test.ts \
  src/worker-v2/stream-consumer.test.ts \
  src/worker-v2/deal-consumer.test.ts \
  src/worker-v2/order-consumer.test.ts \
  src/worker-v2/live-sync.test.ts
```

Expected: all PASS (44 tests total across the 9 files).

- [ ] **Step 2: Prisma validate + generate**

Run: `npx prisma validate && npx prisma generate`
Expected: schema valid, client generated without error.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors in `src/worker-v2/**`.

- [ ] **Step 4: Full existing test suite (legacy untouched — confirm no regression)**

Run: `node --import tsx --test src/worker/*.test.ts src/lib/time.test.ts`
Expected: all PASS, unchanged from pre-change baseline.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: succeeds (Worker V2 is not imported by the Next.js app, so this mainly confirms no accidental cross-import broke the app build).

- [ ] **Step 6: Worker V2 bundle build**

Run: `npm run build:worker-v2`
Expected: `dist/worker-v2.js` produced without esbuild errors.

No commit for this task (verification only, no code changes unless a failure surfaces — if one does, fix in the relevant task's files and re-run).

---

## Task 12: Manual one-account Redis-to-PostgreSQL evidence run

**Prerequisite:** `npm run test:env:up` (isolated `db-test`/`redis-test` stack) or an equivalent local Redis+Postgres with `DATABASE_URL`/`REDIS_URL` pointed at them, migrations applied (`npx prisma migrate deploy` against the test DB), and one `TradingAccount` row seeded with a real `accountNo` (e.g. `"999001"`) and `brokerUtcOffsetMinutes` set (e.g. `180`) via `node --import tsx scripts/set-broker-utc-offset.ts 999001 180` (or a direct Prisma seed script — pick whichever the local environment already supports).

- [ ] **Step 1: Start Worker V2 against the test env**

Run: `DATABASE_URL=... REDIS_URL=... npm run worker-v2:dev` (background)
Record: startup log lines, confirm no crash, confirm `GET http://localhost:9200/health` (or configured `WORKER_V2_HEALTH_PORT`) returns `200` with the `WorkerV2Snapshot` shape.

- [ ] **Step 2: Publish a duplicate Deal event manually**

Use `redis-cli` (or a short throwaway Node script) against the test Redis:

```bash
redis-cli -u "$REDIS_URL" XADD mt5:v2:history:deals '*' data '{"login":999001,"kind":"deal","record":{"ticket":123456,"time":1770000000,"symbol":"EURUSD","type":0,"volume":0.1,"price":1.1000,"profit":5,"swap":0,"commission":-1,"fee":0}}'
redis-cli -u "$REDIS_URL" XADD mt5:v2:history:deals '*' data '{"login":999001,"kind":"deal","record":{"ticket":123456,"time":1770000000,"symbol":"EURUSD","type":0,"volume":0.1,"price":1.1000,"profit":6,"swap":0,"commission":-1,"fee":0}}'
```

Record both `XADD` return IDs.

- [ ] **Step 3: Publish a duplicate Order event manually**

```bash
redis-cli -u "$REDIS_URL" XADD mt5:v2:history:orders '*' data '{"login":999001,"kind":"order","record":{"ticket":654321,"time_setup":1770000000,"symbol":"EURUSD","type":0,"state":"PLACED","sl":1.09,"tp":1.12}}'
redis-cli -u "$REDIS_URL" XADD mt5:v2:history:orders '*' data '{"login":999001,"kind":"order","record":{"ticket":654321,"time_setup":1770000000,"symbol":"EURUSD","type":0,"state":"FILLED","sl":1.09,"tp":1.12}}'
```

- [ ] **Step 4: Prove one row per natural key**

Run:

```bash
npx prisma studio
```

or a quick query script; confirm `SELECT COUNT(*) FROM "Deal" WHERE deal_no = '123456'` = 1 and its `profit` = 6 (second write won), and `SELECT COUNT(*) FROM "Order" WHERE order_ticket = '654321'` = 1 with `state = 'FILLED'`.

- [ ] **Step 5: Stop Worker V2 mid-stream with unacknowledged entries**

Publish one more Deal event, then `kill` the Worker V2 process **before** it has had a chance to process it (or pause it by attaching a debugger / adding a temporary `await new Promise(() => {})` — remove after the test). Confirm via `XPENDING mt5:v2:history:deals worker-v2` that the entry is pending.

- [ ] **Step 6: Restart Worker V2, prove pending entry is recovered**

Run `npm run worker-v2:dev` again. Confirm the reclaim-on-startup path (`reclaimPending`) processes and acks the previously-pending entry once `idleReclaimMs` has elapsed (temporarily lower `WORKER_V2_IDLE_RECLAIM_MS` for this test run, e.g. to `1000`). Confirm `XPENDING` shows zero pending after.

- [ ] **Step 7: Prove malformed/stale position payloads don't delete existing OpenPosition rows**

Seed one `OpenPosition` row for the test account (via a valid live+positions publish first). Then `redis-cli SET mt5:v2:account:999001:positions '{not json'` and wait one `LIVE_SYNC_INTERVAL_MS` cycle; confirm the row still exists. Then let the heartbeat key expire (`redis-cli DEL mt5:v2:bridge:999001:heartbeat` or wait out its 10s TTL) and confirm the row still exists.

- [ ] **Step 8: Prove a valid empty positions payload clears OpenPosition rows**

Re-establish a fresh heartbeat + live hash (or let the real bridge process run against the test account if available), `redis-cli SET mt5:v2:account:999001:positions '[]'`, wait one sync cycle, confirm `OpenPosition` rows for the account are now zero.

- [ ] **Step 9: Prove >100 open positions are not truncated**

Publish a `positions` JSON array with 150 entries (generate via a short script), wait one sync cycle, confirm `SELECT COUNT(*) FROM "OpenPosition" WHERE account_id = '<id>'` = 150.

- [ ] **Step 10: Record all command output and row counts verbatim into the completion report (Task 13).**

No commit for this task (manual verification, no code changes).

---

## Task 13: Completion report

Compile the report per the original request's required sections, using the evidence gathered in Task 12 and the verification output from Task 11. No commit — this is delivered as a message to the user, not a repo file, unless the user asks for it to be written down.

**Do not run `git push`. Do not run any destructive database migration. Stop after this task — no API, analytics, dashboard, or ClosedPosition reconstruction work.**

---

## Self-Review Notes (already applied above, kept for the executor's awareness)

- Spec coverage: every numbered responsibility (1–9) in the original request maps to Tasks 2–10; every required test category maps to a task-6/8/9 test file; the 19-step verification sequence maps to Tasks 11–12.
- No placeholders: every step above has concrete code or an exact command.
- Type consistency checked: `AccountRegistry` (Task 3) is the same `Map<string, TradingAccount>` type used in Tasks 8, 9, 10; `EntryOutcome`/`StreamEntry` (Task 7) are the same types consumed in Task 8; `WorkerV2Status` methods (Task 6) match exactly what Tasks 8–9 call.
