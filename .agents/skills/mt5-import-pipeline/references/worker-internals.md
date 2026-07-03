# Worker Internals — `src/worker/index.ts`

## File Encoding Detection

`decodeReportBuffer(rawBytes: Buffer): string` handles all MT5 export encodings:

```
FF FE (BOM)     → UTF-16 LE  (most common MT5 export)
FE FF (BOM)     → UTF-16 BE
EF BB BF (BOM)  → UTF-8 BOM
(no BOM)        → plain UTF-8
```

Never assume UTF-8. MT5 almost always exports UTF-16 LE. Feeding a UTF-16 buffer into a UTF-8 decoder produces silent garbage without error.

---

## File Sources

### Local manual import

`worker:local` reads from `LOCAL_REPORT_DIR` (default `data/source-reports/`).
The continuous worker no longer imports reports from a remote file source; it
consumes MT5 bridge Redis streams instead.

```bash
npm run worker:local   # manual single pass
npm run worker:dev     # continuous bridge consumer + live sampler
```

---

## Dedup Logic (`importReport`)

1. Compute `fileHash = SHA-256(rawHtml)` — deterministic, matches `ParsedReport.fileHash`
2. Query `ReportImport` table for existing `(tradingAccountId, fileHash)` row
3. If found: **skip** the entire file (log `"duplicate file hash"`)
4. Override: set `WORKER_FORCE_REIMPORT=true` to ignore dedup check

The `fileHash` is computed from the raw bytes before parsing. Any change to the file (even whitespace) produces a new hash and triggers re-import.

---

## Snapshot Freshness

Two separate decisions control what gets updated:

### `shouldRefreshCurrentSnapshot`

```
incoming reportDate >= existing AccountSnapshot.reportDate
```

Controls whether to overwrite:
- `AccountSnapshot` (balance, equity, margin, marginLevel, floatingPl, creditFacility, freeMargin)
- `OpenPosition` (all current open positions)

If the incoming report is older than what's already stored, the snapshot is preserved.

### `shouldAdvanceAccountReportDate`

```
incoming reportDate >= existing TradingAccount.reportDate
```

Controls whether to update `TradingAccount.reportDate`. A more recent report advances the account date; an older reimport does not.

### Legacy time shift

`isSameInstant(a, b)` has a **7-hour tolerance** to handle legacy reports that stored timestamps in UTC instead of Bangkok time (UTC+7). Reports within 7 hours of each other are treated as the same instant for freshness comparison.

---

## Transaction Structure

One `$transaction` per file. All steps inside a single Prisma transaction — either all succeed or the entire import rolls back.

```
Step 1: TradingAccount.upsert
  Key: accountNo
  Creates account if new; updates name/company/server if existing

Step 2: ReportImport.upsert
  Key: (tradingAccountId, fileHash)
  Records this import; dedup check happens BEFORE the transaction

Step 3: AccountSnapshot.upsert (conditional)
  Key: tradingAccountId (one row per account)
  Only if shouldRefreshCurrentSnapshot
  Writes: balance, equity, margin, marginLevel, floatingPl, creditFacility, freeMargin

Step 4: OpenPosition.deleteMany + createMany (conditional)
  Atomically replaces all open positions for the account
  Only if shouldRefreshCurrentSnapshot

Step 5: Position.createMany
  skipDuplicates: true
  Key: (accountId, positionNo)
  Idempotent — already-imported positions are silently skipped

Step 6: Deal.createMany
  skipDuplicates: true
  Key: (accountId, dealNo)
  Idempotent — already-imported deals are silently skipped

Step 7: recomputeAccountReportResult(account.id, tx)
  Recomputes AccountReportResult from Positions + Deals
  Always runs — cache must reflect latest data after any import
```

### Notes on steps 5 and 6

`skipDuplicates: true` means the createMany silently discards any row where the unique constraint already exists. This is intentional — historical data accumulates and reimporting the same report should be a no-op for positions and deals that were already persisted.

Do not use this for `OpenPosition` (Step 4) — open positions must be fully replaced because the set changes with each snapshot (positions close, new ones open). Hence deleteMany + createMany instead of upsert.

---

## Error Handling Patterns

| Error | Behavior |
|---|---|
| Parse returns null metadata | Skip file, log `"account number is missing"` or `"report timestamp is missing"` |
| Prisma unique constraint violation | Only possible if `skipDuplicates: false`; not expected in normal flow |
| File below minimum size | Skip with log warning |
| File still growing (unstable) | Wait another stability window before processing |

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `WORKER_POLL_MS` | 150000 | Worker heartbeat interval |
| `WORKER_FILE_STABLE_MS` | 60000 | Wait for file size to stabilize |
| `WORKER_MIN_FILE_SIZE_BYTES` | 1024 | Skip files smaller than this |
| `WORKER_FORCE_REIMPORT` | false | Bypass dedup check |
| `LOCAL_REPORT_DIR` | data/source-reports/ | Local report directory |
