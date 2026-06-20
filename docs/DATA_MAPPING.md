# Data Mapping — เอกสารสรุป

> อัปเดต: 2026-06-20

เอกสารนี้อธิบายว่าข้อมูลไหลจาก MT5 HTML report ไปจนถึง UI อย่างไร ครอบคลุม parse → DB upsert → analytics engine → API response → frontend

---

## ภาพรวม Pipeline

```
MT5 HTML Report (.html)
  │
  ▼ parser/index.ts (cheerio)
ParsedReport
  │
  ▼ worker/index.ts (Prisma upsert)
PostgreSQL tables: TradingAccount, AccountSnapshot, Position, Deal, OpenPosition, ReportImport
  │
  ▼ calculate-report-results.ts
AccountReportResult (precomputed cache)
  │
  ▼ preaggregated-cache.ts (in-memory 5s cache)
AccountCachedView (per timeframe)
  │
  ▼ API routes (/api/accounts/[id]/*)
JSON Response
  │
  ▼ useApiResource + DashboardCard
UI (SummaryChip, SparklineChart, panels)
```

---

## 1. Parser — HTML → ParsedReport

**File:** `src/lib/parser/index.ts`  
**Library:** cheerio (HTML parsing)

### Input
MT5 HTML report file — รองรับ encoding: UTF-16LE (BOM `FF FE`), UTF-16BE (`FE FF`), UTF-8 BOM, UTF-8

### Output: `ParsedReport`

```ts
interface ParsedReport {
  fileHash: string;          // SHA-256 ของ HTML content สำหรับ dedup
  metadata: {
    account_number: string;
    owner_name: string;
    company?: string;
    currency: string;
    server: string;
    report_timestamp: Date;  // Bangkok time
  };
  dealLedger: DealLedgerRow[];       // ทุก transactions
  positions: PositionRow[];          // closed positions
  openPositions: OpenPositionRow[];  // active positions
  workingOrders: WorkingOrderRow[];  // pending orders
  accountSummary: {
    balance: number;
    credit_facility: number;
    equity: number;
    margin: number;
    free_margin: number;
    floating_pl: number;
    margin_level: number;
  };
  reportResults?: { ... };           // precomputed stats จาก MT5 (optional)
}
```

### HTML Sections ที่ Parser อ่าน

| Section | → ParsedReport field |
|---------|---------------------|
| "Deals" | `dealLedger` |
| "Positions" | `positions` |
| "Open Positions" | `openPositions` |
| "Working Orders" | `workingOrders` |
| "Summary" | `accountSummary` + `reportResults` |

### parseNumber() — Number Normalization

```
"(1,234.56)" → -1234.56   (parentheses = negative)
"1 234,56"   → 1234.56    (EU format)
"1,234.56"   → 1234.56    (US format)
```

---

## 2. Worker — ParsedReport → PostgreSQL

**File:** `src/worker/index.ts`

### Guard conditions ก่อน upsert

1. **File filter:** ต้องเป็น `.html`, ไม่ขึ้นต้นด้วย `._`, ขนาด ≥ `MIN_FILE_SIZE_BYTES` (1024), อายุ ≥ `FILE_STABLE_MS` (60s)
2. **SHA-256 dedup:** hash content → check `ReportImport` table (unique: `tradingAccountId + fileHash`)
3. **Date guard:** ถ้า `reportDate` ใหม่กว่า snapshot ปัจจุบัน → อัปเดต snapshot; ถ้าเก่ากว่า → skip snapshot update (แต่ยัง upsert positions/deals)

### Prisma Transaction (ทุกอย่างใน 1 transaction)

```
tx.tradingAccount.upsert       ← by accountNo (unique)
tx.reportImport.upsert         ← by (tradingAccountId, fileHash)
tx.accountSnapshot.upsert      ← by tradingAccountId (1-to-1)
tx.openPosition.deleteMany     ← ลบ open positions เก่าทั้งหมด
tx.openPosition.createMany     ← insert ใหม่ทั้งหมด (replace-all)
tx.position.createMany/update  ← by (tradingAccountId, positionNo)
tx.deal.createMany/update      ← by (tradingAccountId, dealNo)
```

### Position Upsert Logic

```
for each incoming position:
  if exists in DB:
    if incoming reportDate >= existing reportDate:
      UPDATE (อัปเดตเฉพาะถ้า report ใหม่กว่า)
    else:
      SKIP
  else:
    CREATE
```

เหมือนกันสำหรับ Deal

### Type Conversion (Parser → Prisma)

| Parser type | Prisma field | Conversion |
|-------------|-------------|-----------|
| `number` | `Decimal(28,8)` | `toDecimal(value)` หรือ `toDecimalOrNull(value)` |
| `string \| null` | `String?` | `normalizeOptionalText(value)` |
| `Date \| null` | `DateTime?` | `normalizeDate(value)` |

---

## 3. AccountReportResult — Precomputed Cache Table

**File:** `src/lib/trading/calculate-report-results.ts`  
**ทริกเกอร์:** หลังทุก successful import (`recomputeAccountReportResult(accountId)`)

### Input sources

| Metric | Source |
|--------|--------|
| Win rate, PF, Sharpe | `Position` table (closed positions only) |
| Total commission, total swap | `Deal` table |
| Balance drawdown (all types) | `Deal` table |

### Formulas

```ts
// Net P/L ของ position/deal
positionNetPnl = profit + commission + swap

// Profit Factor
profitFactor = grossProfit / Math.abs(grossLoss)

// Expected Payoff
expectedPayoff = totalNetProfit / totalTrades

// Recovery Factor
recoveryFactor = totalNetProfit / maximalDrawdownAmount

// Sharpe Ratio (annualized-like, ต่อ trade)
sharpe = mean(netValues) / stdDev(netValues)
  // netValues = positionNetPnl ของแต่ละ closed position
```

### ข้อสำคัญ

> `AccountReportResult` คือ **cache** ไม่ใช่ authoritative source  
> API routes บางตัวคำนวณ metrics ใหม่จาก raw `Position`/`Deal` เสมอ เพื่อรองรับ timeframe filtering

---

## 4. Source Boundaries — ใช้ Table ไหนกับ Metric อะไร

| Metric | ต้องใช้ source | ห้ามใช้ |
|--------|---------------|---------|
| Win rate, Profit Factor, Sharpe | `Position` | `Deal`, `AccountReportResult` |
| Balance curve, Growth %, Drawdown | `Deal` | `Position`, `AccountSnapshot` |
| Floating P/L, Open exposure | `OpenPosition` | `Deal` |
| Latest balance, equity, margin | `AccountSnapshot` / Redis | `Deal.balance` (ยกเว้น fallback) |
| Deposited total, Withdrawal total | `Deal` (filtered by `isBalanceDeal`) | `Position` |

**ทำไม:** MT5 รายงาน Deal ทุกชนิด (trade, deposit, withdrawal) รวมกัน การ mix source ทำให้ growth คำนวณผิด เช่น deposit ถูกนับเป็น profit

---

## 5. Deal Classification

**File:** `src/lib/trading/analytics.ts`

```ts
// Trade deal = buy/sell (ไม่ใช่ balance operation)
isTradingDeal(type)
  → type.includes("buy") || type.includes("sell")
  → ไม่เป็น balance deal

// Balance deal = deposit/withdrawal/adjustment
isBalanceDeal(type, comment, delta)
  → classifyBalanceOperation(type, comment, delta)
    → "deposit"    if /deposit/i
    → "withdrawal" if /withdraw/i
    → "adjustment" if /balance adjustment/i
    → "credit"     if /credit|correction|bonus|fee|charge|interest|tax|agent|dividend/i

// Net P/L (ใช้กับทั้ง Position และ Deal)
dealNet(row) = profit + commission + swap
positionNetPnl = dealNet  // alias
```

---

## 6. Growth Formula — MQL5-style

**File:** `src/lib/trading/analytics.ts:computeCompoundedGrowth`

หลักการ: deposit/withdrawal ไม่ควรทำให้ growth เปลี่ยน — คำนวณ growth แต่ละ "segment" ระหว่าง balance operations แล้ว compound เข้าด้วยกัน

```
สมมติ:
  deposit $1000   → balance = $1000  (periodStartBalance = $1000)
  trade +$100     → balance = $1100
  deposit +$500   → segment 1 growth = 1100/1000 = 1.1x
                    balance = $1600, periodStartBalance = $1600
  trade -$200     → balance = $1400
  
  final growth factor = 1.1 × (1400/1600) = 1.1 × 0.875 = 0.9625
  growth % = (0.9625 - 1) × 100 = -3.75%
```

```ts
// Absolute Gain (เปรียบเทียบ start vs end)
computeAbsoluteGain(deals, start, end)
  = (endBalance - startBalance) / startBalance × 100

// Compounded Growth (MQL5-style, ไม่ distort จาก deposit)
computeCompoundedGrowth(deals, start, end)
  = (growthFactor - 1) × 100
```

---

## 7. Balance Curve

**File:** `src/lib/trading/analytics.ts:buildBalanceCurve`

```ts
// ผลลัพธ์: BalanceEventPoint[]
buildBalanceCurve(deals)
  → filter: isTradingDeal หรือ isBalanceDeal
  → map to { x: dateString, y: balanceAfter, eventType, eventDelta }
  → sort by time asc, dealNo asc
```

SparklineChart ใช้ array นี้วาด SVG โดยตรง

---

## 8. Preaggregated Cache — In-memory per Account

**File:** `src/lib/trading/preaggregated-cache.ts`

```
ACCOUNT_CACHE_REVALIDATE_MS = 5,000ms (5 วินาที)

getAccountPreaggregatedBundle(accountId)
  → ถ้ามีใน cache และอายุ < 5s → return cached
  → ถ้าไม่มีหรือหมดอายุ → query DB → build bundle → cache

AccountCachedViewKind:
  "overview"      → AccountOverviewResponse
  "balanceDetail" → BalanceDetailResponse
  "growth"        → GrowthResponse
  "positions"     → PositionsResponse
  "profitDetail"  → ProfitDetailResponse
  "winDetail"     → WinDetailResponse
  "pipsSummary"   → PipsSummaryResponse
```

### DB Query ใน Bundle (ดึงครั้งเดียว, แชร์ทุก viewKind)

```ts
prisma.tradingAccount.findUnique({
  include: {
    accountSnapshot: true,
    accountReportResult: true,
    openPositions: { orderBy: [symbol, positionNo] },
    positions:     { orderBy: [closeTime, positionNo] },
    deals:         { orderBy: [time, dealNo] },
  }
})
```

ทุก viewKind ในทุก timeframe ใช้ raw data ชุดเดียวกัน แล้วกรองด้วย `filterBySince(since, deals)` ตาม timeframe

---

## 9. Timeframe → Date Filter

**File:** `src/lib/trading/analytics.ts:getSinceDate`

| Timeframe | since | คำอธิบาย |
|-----------|-------|----------|
| `1d` | start of Bangkok day | วันปัจจุบัน 00:00 Bangkok |
| `1w` | start of Bangkok week | จันทร์ 00:00 Bangkok |
| `1m` | -30 days | 30 วันที่ผ่านมา |
| `3m` | -90 days | 90 วันที่ผ่านมา |
| `6m` | -180 days | 180 วันที่ผ่านมา |
| `1y` | -365 days | 1 ปีที่ผ่านมา |
| `all` | null | ทั้งหมด |

กรองด้วย `filterBySince(since, rows, getTimestamp)` — ใช้กับทั้ง Deal (`.time`) และ Position (`.closeTime`)

---

## 10. API → Frontend Type Mapping

### `SerializedAccount` (account list item)

| Field | Source | คำอธิบาย |
|-------|--------|----------|
| `id` | `TradingAccount.id` | cuid |
| `account_number` | `TradingAccount.accountNo` | MT5 account number |
| `balance` | `getLatestDealBalance(deals)` | balance จาก deal ล่าสุด ไม่ใช่ snapshot |
| `equity` | `AccountSnapshot.equity` | fallback: `getLatestDealBalance` |
| `floating_pl` | `AccountSnapshot.floatingPl` | fallback: sum `openPositions.profit` |
| `margin` | `AccountSnapshot.margin` | null ถ้าไม่มี snapshot |
| `margin_level` | `AccountSnapshot.marginLevel` | null ถ้าไม่มี snapshot |
| `today_growth_percent` | `computeCompoundedGrowth(deals, startOfDay)` | MQL5-style growth |
| `week_growth_percent` | `computeCompoundedGrowth(deals, startOfWeek)` | |
| `today_net_profit` | `sum(tradingDeals.dealNet)` ของวันนี้ | เฉพาะ `isTradingDeal` |
| `today_net_pips` | `sum(positions.pips)` closeTime วันนี้ | |
| `status` | `getAccountStatus(updatedAt)` | Active ถ้า updatedAt < 7 นาที |
| `last_updated` | max(reportDate, openPositions.reportDate) | |

### `AccountOverviewResponse.kpis` (overview endpoint)

| KPI | คำนวณจาก | Source |
|-----|-----------|--------|
| `periodGrowth` | `computeCompoundedGrowth(deals, since)` | `Deal` |
| `netProfit` | `sum(dealNet)` for trading deals | `Deal` |
| `grossLoss` | `sum(dealNet < 0)` for trading deals | `Deal` |
| `drawdown` | relative drawdown % in period | `Deal` |
| `absoluteDrawdown` | absolute drawdown amount | `Deal` |
| `winPercent` | winning deals / total deals | `Deal` |
| `netPips` | `sum(position.pips)` | `Position` |
| `totalDeposit` | `sum(balanceDeal > 0)` | `Deal` |
| `totalWithdrawal` | `sum(balanceDeal < 0)` | `Deal` |
| `totalCommission` | `sum(deal.commission)` | `Deal` |
| `totalSwap` | `sum(deal.swap)` | `Deal` |
| `trades` | closed positions count in period | `Position` |
| `floatingPL` | `AccountSnapshot.floatingPl` | `AccountSnapshot` |
| `openCount` | `openPositions.length` | `OpenPosition` |

---

## 11. Pips Calculation

**File:** `src/lib/trading/analytics.ts:positionPips`

ลำดับการหา pips ของแต่ละ position:
1. ใช้ `position.pips` ถ้ามี (stored value จาก DB)
2. คำนวณเองจาก `openPrice`, `closePrice`, `symbol`, `type`:
   - ดู `resolveInstrumentSpec(symbol)` → pip multiplier ตาม symbol
   - buy: `(closePrice - openPrice) × multiplier`
   - sell: `(openPrice - closePrice) × multiplier`

---

## 12. Balance Drawdown Types

**File:** `src/lib/trading/analytics.ts:computeBalanceDrawdown`

| Type | คำอธิบาย | ใช้ใน |
|------|----------|-------|
| `absoluteAmount` | ยอดเสียสูงสุดจากจุดเริ่มต้น | `BalanceDetailResponse.summary.absoluteDrawdown` |
| `maximalAmount` | max peak-to-trough ใน period | `BalanceDetailResponse.summary.maximalDrawdownAmount` |
| `maximalPercent` | maximalAmount / peak × 100 | `BalanceDetailResponse.summary.maximalDrawdownPct` |
| `relativePercent` | relative drawdown ณ จุดที่แย่ที่สุด | `AccountOverviewResponse.kpis.drawdown` |
| `relativeAmount` | amount ณ relative drawdown | |

---

## 13. Account Sort Order

**File:** `src/lib/trading/account-data.ts:compareAccountListItems`

เรียงลำดับ account list:
1. `today_growth_percent` DESC (หลัก)
2. `today_net_pips` DESC (tie-breaker 1)
3. `today_net_profit` DESC (tie-breaker 2)
4. `balance` DESC (tie-breaker 3)
5. `account_number` ASC numeric (tie-breaker 4)

---

## 14. Timezone — Bangkok (Asia/Bangkok, UTC+7)

**File:** `src/lib/time.ts`

MT5 reports ใช้ Bangkok time ทุกที่ functions สำคัญ:

| Function | คำอธิบาย |
|----------|-----------|
| `startOfBangkokDay(date)` | 00:00 Bangkok ของวันนั้น |
| `startOfBangkokWeek(date)` | จันทร์ 00:00 Bangkok |
| `startOfBangkokMonth(date)` | วันที่ 1 ของเดือน |
| `getBangkokDateKey(date)` | "YYYY-MM-DD" ใน Bangkok timezone |
| `startOfThaiDayInTableTime(date)` | convert Bangkok date → UTC timestamp สำหรับ DB query |
| `convertBangkokReportTimeToTableTimestamp(date)` | Bangkok report time → DB timestamp |

> **ข้อควรระวัง:** DB เก็บ timestamp เป็น UTC แต่ MT5 report ใช้ Bangkok time — การกรองด้วย date range ต้องแปลงก่อนเสมอ

---

## 15. Real-time Path (WebSocket)

```
Collector (Python) 
  → POST /api/v1/ingest/update (HMAC signed)
    → Gateway (FastAPI) validates HMAC
    → Redis Pub/Sub publish
      → WebSocket broadcast
        → useRealtimeAccount hook
          → update equity / floatingPl ใน UI โดยไม่ต้อง refetch
```

Real-time data ไม่ผ่าน `preaggregated-cache.ts` — update ตรง state ใน React  
Historical data (balance curve, KPIs) ยังคง 5s cache จาก DB
