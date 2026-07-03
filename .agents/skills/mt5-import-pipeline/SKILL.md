---
name: mt5-import-pipeline
description: >
  This skill should be used when the user asks to "import an MT5 report", "run the worker",
  "debug a skipped report", "add a new MT5 field", "trace data from report to dashboard",
  "fix a Prisma upsert", "update the analytics layer", "why is balance wrong", "add a column to Position",
  "recompute report results", "run worker:local", or "fix deal/position import". Covers the full
  pipeline from raw .html file to rendered dashboard KPI in the Analytic project.
---

# MT5 Import Pipeline

## Pipeline Overview

```
MT5 Terminal → Python Bridge → Redis Streams
  └→ src/worker/bridge-consumer.ts (consume, upsert)
       └→ PostgreSQL via Prisma
            └→ src/lib/trading/preaggregated-cache.ts  (analytics queries)
                 └→ Next.js API routes → Dashboard
```

Manual local HTML import is still available through `npm run worker:local` for one-off backfills/debugging. There is no FTP worker path.

**Dependency direction:** this skill depends on `mt5-report-parser` for HTML format, field mapping, and metric formulas. That skill is application-agnostic; this skill is Analytic-project-specific.

---

## MT5 HTML Report Format

MT5 exports a single `ReportHistory.htm` file using `<!--PLACEHOLDER-->` syntax. One large `<table>` with section headers interspersed as rows.

### Sections (in order)

| Section | Content |
|---|---|
| Positions | Closed trades: positionNo, open/close time+price, commission, swap, profit |
| Orders | Historical orders (raw events — not imported) |
| Deals | Full ledger: trades + balance ops (deposit/withdrawal) |
| Open Positions | Active trades with floating P/L |
| Working Orders | Pending orders |
| Summary | Balance, equity, margin, credit facility, floating P/L |
| Details | Aggregated stats: profit factor, Sharpe, drawdowns, win rates |

Open Positions and Working Orders are absent when no trades are open.

**Key field mappings** (abbreviated — see `references/parser-internals.md` for full list):

- Positions: `<!--POSITION_POSITION-->` → `positionNo`, `<!--POSITION_PROFIT-->` → `profit` (raw, excludes swap+commission)
- Deals: `<!--DEAL_DEAL-->` → `dealId`, `<!--DEAL_BALANCE-->` → `balanceAfter`
- Details: `<!--REPORT_PROFITFACTOR-->`, `<!--REPORT_SHARPERATIO-->`, drawdown cells

> For complete placeholder → field mapping, load `references/parser-internals.md`.

---

## Parser (`src/lib/parser/index.ts`)

### Key exports

```ts
parseReport(htmlContent: string): ParsedReport
parseNumber(value: string): number   // handles commas, parens, NBSP
parseVolume(value: string): { req: number; filled: number }
```

### ParsedReport shape

```ts
{
  fileHash: string;        // SHA-256 of raw HTML — used for dedup
  metadata: { account_number, owner_name, company, currency, server, report_timestamp }
  dealLedger: DealLedgerRow[];
  positions: PositionRow[];
  openPositions: OpenPositionRow[];
  workingOrders: WorkingOrderRow[];
  accountSummary: { balance, credit_facility, equity, margin, free_margin, floating_pl, margin_level }
  reportResults?: { total_net_profit, gross_profit, profit_factor, sharpe_ratio, ... }
}
```

> Section detection algorithm, header map logic, adding a new field, and parse failure patterns → `references/parser-internals.md`.

---

## Worker (`src/worker/index.ts`)

### Sources

- **Bridge streams** (default): consumes `mt5:account:{login}:deals-stream`, `:orders-stream`, and `:position-closed-stream`
- **Local manual import**: `npm run worker:local` reads from `LOCAL_REPORT_DIR` (default `data/source-reports/`)

### Dedup and freshness

1. Compute `fileHash = SHA-256(rawHtml)` — matches `ParsedReport.fileHash`
2. Skip if `(tradingAccountId, fileHash)` exists in `ReportImport` — override with `WORKER_FORCE_REIMPORT=true`
3. `shouldRefreshCurrentSnapshot`: only update `AccountSnapshot` + `OpenPosition` when incoming `reportDate ≥ existing snapshot reportDate`

> File encoding handling, snapshot freshness rules, and full transaction structure → `references/worker-internals.md`.

---

## Data Model — Critical Source Boundaries

**Never mix these sources:**

| What | Source | Notes |
|---|---|---|
| Win rate, profit factor, Sharpe, per-trade averages | `Position` | Closed positions only |
| Balance curve, growth, drawdown, intraday | `Deal` | Full ledger including balance ops |
| Floating P/L, open exposure | `OpenPosition` / Redis | Real-time via WebSocket |
| Latest balance, equity, margin | `AccountSnapshot` / Redis | Overwritten each import |
| Precomputed metrics cache | `AccountReportResult` | NOT authoritative — recomputed after each import |

**positionNetPnl** = `profit + swap + commission` (always include all three — never use `profit` alone)

**isTradingDeal** = deal has symbol + direction (excludes balance/deposit/withdrawal)

**isBalanceDeal** = type "balance" or "credit" (no symbol)

---

## Analytics (`src/lib/trading/preaggregated-cache.ts`)

Main entry: `getAccountOverview(accountId, timeframe)` — returns the full dashboard data bundle. Cached in-memory for `ACCOUNT_CACHE_REVALIDATE_MS` (5 s).

Timeframes (`parseTimeframe`): `1D`, `1W`, `1M`, `3M`, `6M`, `1Y`, `YTD`, `ALL` — each resolves to a Bangkok-timezone `since` date.

Key computed metrics:
- **Growth**: `computeCompoundedGrowth` — MQL5-style, segments on balance ops so deposits don't inflate performance
- **Drawdown**: `computeBalanceDrawdown` — max peak-to-trough from Deal balance curve
- **Sharpe**: `computeAnnualizedSharpeRatio` — annualized from daily deal P/L
- **Pips**: stored on `Position.pips` at import time by `positionPips()`

`recomputeAccountReportResult(accountId, tx)` in `src/lib/trading/calculate-report-results.ts` — called after every import. Writes to `AccountReportResult` (cache only).

> Detailed analytics internals, timeframe logic, and growth/drawdown algorithms → `references/analytics.md`.

> For metric quality thresholds (Sharpe, drawdown, profit factor, recovery factor) used in dashboard color coding → `mt5-report-parser/references/advanced-metrics.md`.

---

## Common Workflows

### Debug: why is a report being skipped?

Check logs for:
- `"account number is missing"` → parser couldn't find account number in metadata rows
- `"duplicate file hash"` → same file imported before; set `WORKER_FORCE_REIMPORT=true`
- `"report timestamp is missing"` → date parsing failed; check `parseBangkokDate()` in `src/lib/time.ts`

### Add a new field from MT5 report

1. **Parser**: add to interface + `parse*Row()` in `src/lib/parser/index.ts`
2. **Worker**: add to Prisma `createMany/upsert` data object in `src/worker/index.ts`
3. **Schema**: add column to `prisma/schema.prisma` + `npx prisma migrate dev`
4. **Analytics**: if it affects metrics, update `calculate-report-results.ts` or `analytics.ts`
5. **API**: expose via account API route in `src/app/api/`
6. **Test**: `node --import tsx --test src/lib/parser/index.test.ts`

### Run import locally

```bash
npm run worker:local   # manual single pass from data/source-reports/
npm run worker:dev     # continuous bridge consumer + live sampler
```

### Verify parser against a real file

```bash
node --import tsx --test src/lib/parser/index.test.ts
```

Quick manual check:
```ts
import { parseReport } from './src/lib/parser/index.ts'
import { readFileSync } from 'fs'
const html = readFileSync('docs/ReportHistory.htm', 'utf8')
console.log(parseReport(html))
```

---

## Reference Files

- `references/parser-internals.md` — full placeholder→field map, section detection algorithm, header map pattern, parse failure patterns, adding a new field
- `references/worker-internals.md` — file encoding, dedup logic, snapshot freshness rules, transaction structure
- `references/analytics.md` — preaggregated cache internals, growth/drawdown algorithms, timeframe logic

**Cross-skill references:**
- `mt5-report-parser` — HTML format foundations, metric formulas (Sharpe/Sortino, AHPR/GHPR, Z-Score, LR Correlation, drawdown)
- `mt5-report-parser/references/advanced-metrics.md` — quality thresholds for dashboard color coding
