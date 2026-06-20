# Equity Snapshot Time Series — Design Spec

**Date:** 2026-06-21  
**Status:** Approved

## Problem

`AccountSnapshot` is a single-row-per-account table (enforced by `@unique(tradingAccountId)`). It stores only the latest equity value and is overwritten on every import. There is no equity history, making it impossible to plot an equity curve or compute equity-based drawdown over time.

## Goal

Store equity and margin values incrementally — one row per `(account, reportDate)` — so consumers can build equity curves and calculate equity drawdown across any timeframe.

## Scope

- DB schema: new `EquitySnapshot` model
- Worker: upsert into `EquitySnapshot` on every report import
- Query helper: `getEquityCurve()` in `account-data.ts`

**Out of scope:** frontend chart wiring, drawdown panel integration (next step).

---

## Section 1: Schema

Add `EquitySnapshot` model to `prisma/schema.prisma`:

```prisma
model EquitySnapshot {
  id               String         @id @default(cuid())
  tradingAccountId String         @map("account_id")
  reportDate       DateTime       @map("report_date")
  equity           Decimal        @db.Decimal(28, 8)
  margin           Decimal        @db.Decimal(28, 8)
  createdAt        DateTime       @default(now()) @map("created_at")
  tradingAccount   TradingAccount @relation(fields: [tradingAccountId], references: [id], onDelete: Cascade)

  @@unique([tradingAccountId, reportDate])
  @@index([tradingAccountId, reportDate])
  @@map("EquitySnapshot")
}
```

Add relation to `TradingAccount`:

```prisma
equitySnapshots  EquitySnapshot[]
```

`AccountSnapshot` is **unchanged** — it remains the current-state single-row view.

### Deduplication

`@@unique([tradingAccountId, reportDate])` enforces one row per account per timestamp. Re-importing the same report (FORCE_REIMPORT or same file) updates the existing row rather than creating a duplicate.

---

## Section 2: Worker Logic

In `src/worker/index.ts`, inside `importReport()`, add an upsert inside the existing `$transaction` block — **after** the `accountSnapshot` upsert:

```ts
await tx.equitySnapshot.upsert({
  where: {
    tradingAccountId_reportDate: {
      tradingAccountId: account.id,
      reportDate,
    },
  },
  update: {
    equity: toDecimal(parsedData.accountSummary.equity),
    margin: toDecimal(parsedData.accountSummary.margin),
  },
  create: {
    tradingAccountId: account.id,
    reportDate,
    equity: toDecimal(parsedData.accountSummary.equity),
    margin: toDecimal(parsedData.accountSummary.margin),
  },
});
```

**Key difference from `AccountSnapshot`:** this upsert runs on **every** report that passes the file-hash dedup check — regardless of `shouldRefreshCurrentSnapshot`. Historical imports (older `reportDate` than current snapshot) still record their equity value at that point in time.

---

## Section 3: Query Helper

Add to `src/lib/trading/account-data.ts`:

```ts
export async function getEquityCurve(
  accountId: string,
  since?: Date,
): Promise<Array<{ reportDate: Date; equity: number; margin: number }>> {
  const rows = await prisma.equitySnapshot.findMany({
    where: {
      tradingAccountId: accountId,
      ...(since ? { reportDate: { gte: since } } : {}),
    },
    orderBy: { reportDate: "asc" },
    select: { reportDate: true, equity: true, margin: true },
  });
  return rows.map((r) => ({
    reportDate: r.reportDate,
    equity: Number(r.equity),
    margin: Number(r.margin),
  }));
}
```

Callers pass `since` to scope by timeframe (e.g. `subDays(new Date(), 7)` for 1W). Drawdown consumers call this then compute high-water mark locally — no Deal table involvement.

---

## Migration

Run `npx prisma migrate dev --name add_equity_snapshot` after schema change. Migration is additive (new table only) — no existing data is modified or deleted.

## Testing

- `npm run build` — verify Prisma client regenerated, no type errors
- `npm run worker:local` — verify equity rows appear in `EquitySnapshot` table after import
- Query `SELECT count(*), tradingAccountId FROM "EquitySnapshot" GROUP BY 2` to confirm one row per account per report date
