# Data Model Reference

## Pipeline Overview

```
MT5 Terminal
  │
  ├─ FTP (historical) ──▶ Worker (Node.js)
  │                          │
  │                          ▼
  │                       Parser (cheerio)
  │                          │ ParsedReport
  │                          ▼
  │                       PostgreSQL (Prisma)
  │                          │
  └─ Collector (HTTPS) ──▶ Gateway (FastAPI)
                             │ Redis Pub/Sub
                             ▼
                          Frontend (Next.js)
```

---

## Tables

### `Account` (Prisma: `TradingAccount`)

Account metadata. One row per MT5 account.

| Prisma field | DB column | Type | Notes |
|---|---|---|---|
| `id` | `id` | `String` (cuid) | PK |
| `accountNo` | `account_number` | `String` | Unique, MT5 account number |
| `accountName` | `owner_name` | `String?` | Display name |
| `currency` | `currency` | `String` | e.g. "USD" |
| `serverName` | `server` | `String` | MT5 server name |
| `reportDate` | `report_date` | `DateTime?` | Latest report timestamp |

---

### `AccountSnapshot`

Real-time / latest account state. Updated by collector (Redis path) or worker (FTP path).

| Prisma field | DB column | Type | Source |
|---|---|---|---|
| `balance` | `balance` | `Decimal(28,8)` | MT5 report summary |
| `equity` | `equity` | `Decimal(28,8)` | MT5 report summary |
| `floatingPl` | `floating_pl` | `Decimal(28,8)` | MT5 report summary |
| `margin` | `margin` | `Decimal(28,8)` | MT5 report summary |
| `freeMargin` | `free_margin` | `Decimal(28,8)` | MT5 report summary |
| `marginLevel` | `margin_level` | `Float?` | MT5 report summary |
| `creditFacility` | `credit_facility` | `Decimal(28,8)` | MT5 report summary |
| `reportDate` | `report_date` | `DateTime` | Report timestamp |

**Source rule:** Latest balance, equity, margin → always from `AccountSnapshot` (or Redis live). Never compute from `Deal`.

---

### `Deal`

All transactions from the MT5 deal ledger. One row per deal entry.

| Prisma field | DB column | Parser field | Type | Notes |
|---|---|---|---|---|
| `dealNo` | `deal_no` | `dealId` | `String` | Unique per account |
| `time` | `time` | `time` | `DateTime` | Bangkok-stored UTC |
| `type` | `type` | `type` | `String` | "buy"/"sell"/"balance"/`""` → stored as "UNKNOWN" when empty |
| `direction` | `direction` | `direction` | `String?` | "in"/"out" (opening/closing leg) |
| `symbol` | `symbol` | `symbol` | `String?` | Instrument code, null for balance deals |
| `volume` | `volume` | `volume` | `Float?` | Lot size |
| `price` | `price` | `price` | `Decimal?` | Execution price |
| `commission` | `commission` | `commission` | `Decimal(28,8)` | Usually negative |
| `fee` | `fee` | `fee` | `Decimal(28,8)` | Additional fee |
| `swap` | `swap` | `swap` | `Decimal(28,8)` | Rollover cost |
| `profit` | `profit` | `profit` | `Decimal(28,8)` | Raw MT5 profit |
| `balance` | `balance` | `balanceAfter` | `Decimal?` | Running account balance **after** this deal |
| `comment` | `comment` | `comment` | `String?` | MT5 comment field |

> **Critical:** `Deal.balance` stores the MT5 "Balance" column — the running total after the deal executes, **not** the P&L of the deal. Used as the anchor for balance-curve reconstruction.

**Source rules:**
- Balance curve, growth, drawdown → computed from `Deal`
- A deal is a **trade deal** when `type` includes "buy"/"sell" (checked by `isTradingDeal()`)
- A deal is a **balance deal** when `type`/`comment` matches deposit/withdrawal/balance patterns (checked by `classifyBalanceOperation()`)

---

### `Position`

Closed positions from the MT5 positions table.

| Prisma field | DB column | Parser field | Type | Notes |
|---|---|---|---|---|
| `positionNo` | `position_no` | `positionId` | `String` | Unique per account |
| `symbol` | `symbol` | `symbol` | `String` | |
| `type` | `type` | `type` | `String` | "buy"/"sell" |
| `volume` | `volume` | `volume` | `Float` | |
| `openTime` | `open_time` | `openTime` | `DateTime?` | |
| `openPrice` | `open_price` | `openPrice` | `Decimal?` | |
| `closeTime` | `close_time` | `closeTime` | `DateTime?` | |
| `closePrice` | `close_price` | `closePrice` | `Decimal?` | |
| `commission` | `commission` | `commission` | `Decimal(28,8)` | |
| `swap` | `swap` | `swap` | `Decimal(28,8)` | |
| `profit` | `profit` | `profit` | `Decimal(28,8)` | Raw MT5 field, NOT net P&L |
| `pips` | `pips` | computed | `Float?` | Pre-computed by worker via `positionPips()` |

> **Net P&L formula:** `positionNetPnl = profit + swap + commission`. Never use `profit` alone.

**Source rules:**
- Win rate, profit factor, Sharpe, averaged metrics → always from `Position`
- Pips → from `Position.pips` (precomputed) or `positionPips()` at query time

---

### `OpenPosition`

Active (floating) positions. Upserted on every report import.

| Prisma field | DB column | Type | Notes |
|---|---|---|---|
| `positionNo` | `position_no` | `String` | Unique per account (enables safe upsert) |
| `symbol` | `symbol` | `String` | |
| `type` | `type` | `String` | "buy"/"sell" |
| `price` | `price` | `Decimal(28,8)` | Open price |
| `marketPrice` | `market_price` | `Decimal(28,8)` | Current price |
| `profit` | `profit` | `Decimal(28,8)` | Floating P&L (from MT5) |
| `swap` | `swap` | `Decimal(28,8)` | |
| `reportDate` | `report_date` | `DateTime` | Timestamp of this snapshot |

**Source rules:**
- Floating P&L, open exposure, open count → always from `OpenPosition` (or Redis live)

---

### `AccountReportResult`

Precomputed metrics cache. Derived from `Position` table. **Not authoritative** — can be recomputed.

Key cached fields: `profitFactor`, `sharpeRatio`, `totalNetProfit`, drawdown stats, win/loss counts.

> **Warning:** This table is a cache only. Never mix values from here with real-time data from other tables.

---

### `ReportImport`

Import deduplication log. SHA256 hash of each HTML file prevents re-importing.

---

## Source Boundary Rules (NEVER mix)

| Metric category | Must come from |
|---|---|
| Balance curve, growth %, drawdown % | `Deal.balance` and `Deal` ledger |
| Win rate, profit factor, Sharpe, streaks | `Position` table |
| Floating P&L, open exposure, open count | `OpenPosition` or Redis |
| Latest balance, equity, margin | `AccountSnapshot` or Redis |
| Precomputed metrics (cache) | `AccountReportResult` — **never as authoritative source** |

---

## Field Mapping: Parser → Worker → DB

### Deal Ledger

| Parser (`DealLedgerRow`) | Worker code | DB column (`Deal`) | Analytics access |
|---|---|---|---|
| `dealId` | `dealNo: deal.dealId` | `deal_no` | `deal.dealNo` |
| `time` | `time: deal.time` | `time` | `deal.time` |
| `type` \| `""` | `type: deal.type \|\| "UNKNOWN"` | `type` | `deal.type` → `classifyBalanceOperation()` |
| `direction` | `direction: deal.direction ?? null` | `direction` | `deal.direction` |
| `profit` | `profit: toDecimal(deal.profit ?? 0)` | `profit` | `Number(deal.profit)` |
| `commission` | `commission: toDecimal(deal.commission ?? 0)` | `commission` | `Number(deal.commission)` |
| `swap` | `toDecimal(deal.swap ?? 0)` | `swap` | `Number(deal.swap)` |
| `balanceAfter` | `balance: toDecimalOrNull(deal.balanceAfter)` | `balance` | `deal.balance` (via `getDealBalanceValue`) |

> **Field rename:** Parser calls it `balanceAfter`; DB column is `balance`. Analytics layer handles both via `row.balanceAfter ?? row.balance`.

### Account Summary → AccountSnapshot

| Parser (`accountSummary`) | DB field |
|---|---|
| `balance` | `AccountSnapshot.balance` |
| `equity` | `AccountSnapshot.equity` |
| `floating_pl` | `AccountSnapshot.floatingPl` |
| `margin` | `AccountSnapshot.margin` |
| `free_margin` | `AccountSnapshot.freeMargin` |
| `margin_level` | `AccountSnapshot.marginLevel` |
| `credit_facility` | `AccountSnapshot.creditFacility` |

---

## Serialized Account (API response: `SerializedAccount`)

Fields returned by `/api/accounts` list endpoint, computed in `serializeAccountBundle()`:

| Field | Source | Formula |
|---|---|---|
| `balance` | `Deal` ledger | `getLatestDealBalance(deals)` — last deal with non-null balance |
| `equity` | `AccountSnapshot.equity` | Direct, fallback to latest deal balance |
| `floating_pl` | `AccountSnapshot.floatingPl` | Direct, fallback to sum of `OpenPosition.profit` |
| `margin` | `AccountSnapshot.margin` | Direct |
| `today_growth_percent` | `Deal` ledger | `computeCompoundedGrowth(deals, startOfToday, null)` |
| `week_growth_percent` | `Deal` ledger | `computeCompoundedGrowth(deals, startOfWeek, null)` |
| `today_net_profit` | `Deal` ledger | Sum of `dealNet()` for trading deals within today window |
| `today_net_pips` | `Position` | Sum of pips for positions closed today |
