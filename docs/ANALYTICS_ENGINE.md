# Analytics Engine — Code Explanation

เอกสารนี้อธิบาย `src/lib/trading/analytics.ts` และ `src/lib/trading/preaggregated-cache.ts` ซึ่งเป็น core ของการคำนวณ KPI ทั้งหมดในระบบ

---

## ภาพรวมสถาปัตยกรรม

```
PostgreSQL (Deal, Position, AccountSnapshot)
           │
           ▼
  preaggregated-cache.ts    ← ดึงข้อมูลและประกอบ response
           │
           ├── analytics.ts  ← คำนวณ metrics ทุกอย่าง
           │
           ▼
  Redis (TTL 5s, version-key invalidation)
           │
           ▼
  API routes /api/accounts/[id]/*
           │
           ▼
  Frontend components (DashboardCard, SparklineChart, …)
```

**กฎสำคัญ — Source Boundaries:**

| Metric | แหล่งข้อมูล |
|--------|------------|
| Win rate, profit factor, Sharpe | `Position` table |
| Balance curve, growth, drawdown | `Deal` table |
| Floating P/L, open exposure | `OpenPosition` / Redis |
| Current balance, equity, margin | `AccountSnapshot` / Redis |

อย่า mix sources — เช่น อย่าเอา balance จาก Position

---

## ส่วนที่ 1: การจำแนก Deal

### ปัญหา
MT5 ส่ง deals ทุกประเภทรวมกัน — ทั้ง trade จริง, deposit, withdrawal, swap, commission — ในตาราง Deal เดียว `type` และ `comment` เป็นข้อมูลที่ต้องใช้แยก

### วิธีการ: `classifyBalanceOperation()`

```
input: type (string), comment (string), delta (number)
        │
        ▼
regex matching:
  "deposit" → BalanceOperation: "deposit"
  "withdraw" → "withdrawal"  
  "balance adjustment" → "balance-adjustment"
  "credit|bonus|fee|…" → "balance"
  type === "balance" + delta > 0 → "deposit"
  type === "balance" + delta < 0 → "withdrawal"
        │
        ▼
returns: null = trade deal  (ไม่ใช่ balance operation)
         "deposit" | "withdrawal" | "balance" | "balance-adjustment"
```

**ทำไมต้อง regex?** MT5 ไม่มีมาตรฐาน — broker แต่ละเจ้า format comment ต่างกัน เช่น "Dep #12345", "DEPOSIT", "Client Deposit", "Balance"

### `dealNet(row)` — P&L ที่แท้จริง

```ts
dealNet(row) = row.profit + row.commission + row.swap
```

MT5 เก็บ swap และ commission แยกจาก profit แต่ trader สนใจ net เท่านั้น ดังนั้น **ทุกที่ในระบบใช้ `dealNet` หรือ `positionNetPnl` เสมอ — ห้ามใช้ `profit` ตรงๆ**

---

## ส่วนที่ 2: การคำนวณ Growth

Growth มีสองสูตร ใช้ต่างกรณี:

### `computeAbsoluteGain()` — สำหรับแสดง % กำไรเทียบกับทุนเริ่มต้น

```
Growth % = (endBalance - startBalance) / startBalance × 100
```

**ตัวอย่าง:** เริ่ม $10,000 → จบที่ $10,800 = +8.0%

ใช้กับ: All-time growth, กำไรรายเดือน

### `computeCompoundedGrowth()` — สำหรับ timeframe ที่มี deposit/withdrawal

ปัญหา: ถ้า trader ฝากเงิน $5,000 ระหว่างช่วงเวลา balance เพิ่มขึ้น $5,000 แต่ไม่ใช่กำไรจากการเทรด สูตรปกติจะคิดผิด

```
วิธีแก้: segment growth ก่อน/หลัง deposit แต่ละครั้ง แล้ว compound

growth_factor = ∏ (balance_after_segment / balance_before_segment)
Growth % = (growth_factor - 1) × 100
```

**ตัวอย่าง:**
```
balance: $10,000 → trading → $11,000 (+10%)
DEPOSIT $5,000
balance: $16,000 → trading → $17,600 (+10%)

compounded = 1.10 × 1.10 = 1.21 → Growth = +21%
(ไม่ใช่ (17,600 - 10,000) / 10,000 = +76% ซึ่งผิด)
```

ลอจิกนี้มาจาก MQL5/MT5 เพื่อให้ตรงกับที่ platform แสดง

---

## ส่วนที่ 3: Drawdown

### `computeAbsoluteDrawdown()` — peak-to-trough ใน balance curve

```
Absolute Drawdown = initial_deposit - minimum_balance_reached

(ค่าบวก = เสียเงินเทียบกับทุนเริ่มต้น)
```

### `buildUnitDrawdownCurve()` — curve สำหรับกราฟ

```
สำหรับแต่ละ deal:
  1. คำนวณ running peak (balance สูงสุดที่ผ่านมา)
  2. drawdown = (current_balance - peak) / peak × 100
  3. ได้เป็น % ที่เป็น negative เสมอ
```

```
peak:  10,000 → 10,500 → 10,500 → 10,500
bal:   10,000 → 10,500 →  9,800 → 10,200
DD%:      0%      0%     -6.67%   -2.86%
```

ใช้ค่านี้ใน DrawdownEquityPanel เป็น time-series

---

## ส่วนที่ 4: Sharpe Ratio

### `computeSharpeRatio(values)` — per-trade Sharpe

```
Sharpe = mean(returns) / std_dev(returns)
```

`values` = array ของ net P&L ต่อ trade (ไม่ใช่ % return — ใช้ absolute เพราะ position size ต่างกัน)

```ts
// ตัวอย่าง values = [+100, -50, +200, +80, -30]
mean = (100 - 50 + 200 + 80 - 30) / 5 = 60
variance = Σ(v - mean)² / (n-1) = ...
std_dev = √variance
Sharpe = 60 / std_dev
```

### `computeAnnualizedSharpeRatio()` — scale เป็น annualized

```
Annualized Sharpe = per_trade_Sharpe × √(trades_per_year)
```

ทำไม scale? ถ้าเทรด 52 ครั้ง/ปี vs 260 ครั้ง/ปี Sharpe raw ต่างกัน แต่ strategy อาจดีเท่ากัน การ annualize ทำให้เปรียบเทียบได้ตามมาตรฐาน finance

**Benchmark:** ≥1 = ดี, ≥2 = ดีมาก, ≥3 = ยอดเยี่ยม

---

## ส่วนที่ 5: Balance Curve

### `buildBalanceCurve()` — time-series สำหรับกราฟ

```
input: Deal[] (ทุก deal ของ account)
        │
        ▼ sortDeals() — sort by time, then dealId (stable sort)
        │
        ▼ สำหรับแต่ละ deal:
          - ถ้า balance deal → record เป็น event point (deposit/withdrawal)
          - ถ้า trade deal → record เป็น balance point ปกติ
          - เก็บ running balance (ใช้ balanceAfter ถ้ามี ไม่งั้น +delta)
        │
        ▼
output: BalanceEventPoint[]
  { x: ISO_date, y: balance, eventType?: "deposit"|"withdrawal", eventDelta?: number }
```

`eventType` ใช้ใน SparklineChart เพื่อ color segment — deposit = สีเขียว, withdrawal = สีแดง

---

## ส่วนที่ 6: Trade Activity %

### `computeTradeActivityPercent()` — % วันที่มีเทรด

```
1. หา lifetime ของ account (วันแรกที่มี position ถึงวันสุดท้าย)
2. นับวัน calendar ทั้งหมด
3. นับวันที่มี position อย่างน้อย 1 open หรือ close
4. Activity % = active_days / total_days × 100
```

ใช้แสดงความสม่ำเสมอของ trader (active ทุกวัน vs เทรดแค่บางช่วง)

### `computeAlgoTradingPercent()` — % trade ที่คาดว่า algo

```
ดู comment field ของแต่ละ position:
- มี comment (ไม่ว่าง) = อาจเป็น Expert Advisor (EA)
- ไม่มี comment = manual trade

Algo % = positions_with_comment / total_positions × 100
```

---

## ส่วนที่ 7: Pips Calculation

### `positionPips()` — pip value ของแต่ละ position

Pip size ขึ้นกับ instrument:
- **Forex (EURUSD, GBPJPY, ...)**: ดูจาก FX_CODES set — JPY pairs = 0.01 pip, others = 0.0001
- **Indices (US30, NAS100, ...)**: 1 pip = 1 point
- **Metals (XAUUSD, XAGUSD)**: gold = 0.01, silver = 0.001
- **Crypto (BTCUSD, ...)**: dynamic ตาม price magnitude

```ts
positionPips(position) = 
  (closePrice - openPrice) × direction_multiplier / pip_size × volume_normalizer
```

`direction_multiplier`: Buy = +1, Sell = -1

---

## ส่วนที่ 8: Caching Layer (preaggregated-cache.ts)

### ทำไมต้อง cache?

แต่ละ account มี deal อาจ 10,000+ รายการ การ query + คำนวณ metrics ทุก request ใช้เวลา 200-500ms ไม่เหมาะกับ dashboard ที่ต้องแสดงหลาย account พร้อมกัน

### Two-Layer Cache Architecture

```
Request → in-memory LRU (max 500 bundles)
                │
                ├── HIT → return immediately (~1ms)
                │
                MISS ↓
         Redis version key check
                │
                ├── version ยังใช้ได้ → load from Redis (~5ms)
                │
                MISS/STALE ↓
         PostgreSQL query + computations (~100-300ms)
                │
                ▼
         cache in Redis (TTL 5s)
         cache in LRU memory
         return result
```

### Version Key Invalidation

Worker process (FTP import) writes new data → bumps version key ใน Redis

```
Redis key: "account:{id}:version" → incrementing number
Cache key: "account:{id}:overview:{timeframe}:{version}"
```

เมื่อ version เปลี่ยน cache เก่าจะ miss โดยอัตโนมัติ ไม่ต้อง flush manually

### `withCachedAccountView()`

```ts
withCachedAccountView(accountId, timeframe, async () => {
  // expensive computation: query + analytics
  return buildCompleteAccountView(accountId, timeframe);
})
```

ทุก API route ของ account ใช้ wrapper นี้ — ทำให้ caching สม่ำเสมอทุก endpoint

---

## ส่วนที่ 9: Common Pitfalls

### ❌ ใช้ `row.profit` ตรงๆ

```ts
// ผิด — ไม่รวม swap/commission
const pnl = position.profit;

// ถูก
const pnl = positionNetPnl(position); // = profit + swap + commission
```

### ❌ Sort deal โดยไม่ stable

```ts
// ผิด — timestamp เดียวกันจะ sort ไม่แน่นอน
deals.sort((a, b) => a.time - b.time);

// ถูก — ใช้ sortDeals() ที่ stable sort ด้วย dealId เป็น tiebreaker
const sorted = sortDeals(deals);
```

### ❌ เอา growth จาก `AccountReportResult`

```
AccountReportResult เป็น precomputed cache — ไม่ใช่ authoritative source
ค่าใน table นี้อาจ stale หรือคำนวณด้วย timeframe ที่ต่างกัน
```

ให้คำนวณใหม่จาก Deal table เสมอเมื่อต้องการค่าที่ถูกต้อง

### ❌ Date timezone ผิด

```ts
// ผิด — ใช้ JS Date โดยตรง (UTC)
const today = new Date();
today.setHours(0, 0, 0, 0);

// ถูก — ใช้ utilities ใน src/lib/time.ts
const today = startOfBangkokDay(new Date());
```

ทุก date ใน system นี้อยู่ใน Asia/Bangkok (UTC+7)

---

## Quick Reference

| Function | Input | Output | ใช้ตอนไหน |
|---|---|---|---|
| `dealNet(row)` | Deal row | number | P&L ของ 1 deal |
| `computeCompoundedGrowth(deals, start, end)` | Deal[], dates | % | Growth ที่มี deposit/withdrawal |
| `computeAbsoluteGain(deals, start, end)` | Deal[], dates | % | Growth ง่ายๆ |
| `computeSharpeRatio(values)` | number[] | number\|null | Per-trade Sharpe |
| `computeAnnualizedSharpeRatio(values, tpy)` | number[], number | number\|null | Annualized Sharpe |
| `buildBalanceCurve(deals)` | Deal[] | BalanceEventPoint[] | Time-series กราฟ |
| `buildUnitDrawdownCurve(deals, start, end)` | Deal[], dates | Point[] | Drawdown กราฟ |
| `computeAbsoluteDrawdown(deposits, lowestBalance)` | numbers | number | DD สูงสุดจากทุนเริ่ม |
| `positionPips(position)` | Position row | number\|null | Pips ต่อ trade |
| `classifyBalanceOperation(type, comment, delta)` | strings, number | kind\|null | แยก trade vs funding |
| `filterBySince(rows, getTs, since)` | array, fn, Date | array | Filter by timeframe |

---

_เอกสารนี้อธิบาย `src/lib/trading/analytics.ts` (986 บรรทัด) + `preaggregated-cache.ts` (1322 บรรทัด)_  
_สร้างโดย `/code-documentation:code-explain` — 2026-06-24_
