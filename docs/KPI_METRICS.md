# KPI Metrics — เอกสารสรุป

> อัปเดต: 2026-06-20

รวม metrics ทั้งหมดในระบบ พร้อม formula, source table, และ UI label

---

## 1. KPI Chips หลัก (5 chips บน Dashboard Card เสมอ)

| Label | Meta | คำอธิบาย | Formula | Source |
|-------|------|----------|---------|--------|
| **GAIN** | Net income | กำไรสุทธิหลังหักค่าธรรมเนียม | `sum(profit + commission + swap)` สำหรับ trading deals | `Deal` |
| **DD** | Max floating | ความเสี่ยงสูงสุด (relative drawdown) | `relativePercent` จาก `computeBalanceDrawdown` | `Deal` |
| **PIPS** | Total points | ผลรวมระยะการเทรด | `sum(position.pips)` ของ closed positions | `Position` |
| **TRADES** | Closed | จำนวนการเทรดที่ปิดแล้วในช่วงเวลา | `closedPositionSummary.totalTrades` | `Position` |
| **OPENS** | Live trades | จำนวนออเดอร์ที่กำลังถือครองอยู่ | `openPositions.length` | `OpenPosition` |

---

## 2. GAIN — ขยาย (คลิก chip)

| Label | Meta | คำอธิบาย | Formula | Source |
|-------|------|----------|---------|--------|
| **COMM.** | Commission | ค่าคอมมิชชั่นรวม | `sum(deal.commission)` สำหรับ trading deals | `Deal` |
| **SWAP** | Swap | ค่า swap รวม | `sum(deal.swap)` สำหรับ trading deals | `Deal` |
| **DEPOS.** | Deposits | ยอดฝากรวมในช่วงเวลา | `fundingTotals.totalDeposit` | `Deal` (isBalanceDeal > 0) |
| **WITHD.** | Withdrawals | ยอดถอนรวมในช่วงเวลา | `fundingTotals.totalWithdraw` | `Deal` (isBalanceDeal < 0) |

---

## 3. DD — ขยาย (4 sub-panels)

### Sub-chip row

| Label | Meta | Value | คำอธิบาย | Source |
|-------|------|-------|----------|--------|
| **ABS** | Sharpe | `sharpeRatio` | Annualized Sharpe Ratio (risk-adjusted return) | `Position` |
| **MAX** | Profit F. | `profitFactor` | Profit Factor (gross profit / gross loss) | `Position` |
| **LOAD** | Deposit | `maximalDepositLoad` | Max deposit load % = (margin / equity) × 100 | `AccountSnapshot` |
| **EXPECT** | Per trade | `expectedPayoff` | Expected payoff per trade | `Position` |

### DD sub-panels

| Panel | ชื่อ | เนื้อหา |
|-------|------|---------|
| `dd` (default) | BotPnLPanel | P&L breakdown, trade distribution |
| `abs` | PerformanceRadar | 7-axis radar: Sharpe, PF, RF, Win Rate, ฯลฯ |
| `max` | PerformanceQualityPanel | Gauge metrics: win rate, largest trade, streaks |
| `load` | PerformanceBars + BotPnL | Bar charts: long/short trade sizes, consecutive runs |
| `expect` | PiePanel | Symbol distribution pie chart |

---

## 4. TRADES — ขยาย

| Label | Meta | คำอธิบาย | Formula | Source |
|-------|------|----------|---------|--------|
| **ACTIVITY** | Trade Activity | จำนวน trade ในช่วงเวลา | `overview.kpis.trades` | `Position` |
| **PER WEEK** | Avg/week | ความถี่เฉลี่ยต่อสัปดาห์ | `computeTradesPerWeek(positions)` | `Position` |
| **HOLDING** | Avg duration | เวลาถือครองเฉลี่ย | `computeAverageHoldHours(positions)` → `Xm / Xh / Xd` | `Position` |

---

## 5. OPENS — ขยาย

| Label | Meta | คำอธิบาย | Formula | Source |
|-------|------|----------|---------|--------|
| **P/L** | Floating | floating P/L รวม | `AccountSnapshot.floatingPl` | `AccountSnapshot` |
| **MARGIN** | Used | margin ที่ใช้งาน | `AccountSnapshot.margin` | `AccountSnapshot` |
| **FREE** | Available | free margin ที่เหลือ | `equity - margin` | คำนวณ |
| **LEVEL** | Margin % | margin level | `AccountSnapshot.marginLevel` | `AccountSnapshot` |

---

## 6. Metrics ใน Account List (SerializedAccount)

| Field | คำอธิบาย | Formula | Source |
|-------|----------|---------|--------|
| `today_growth_percent` | growth วันนี้ | `computeCompoundedGrowth(deals, startOfBangkokDay)` | `Deal` |
| `week_growth_percent` | growth สัปดาห์นี้ | `computeCompoundedGrowth(deals, startOfBangkokWeek)` | `Deal` |
| `today_net_profit` | กำไรสุทธิวันนี้ | `sum(dealNet)` สำหรับ trading deals ที่ `closeTime` วันนี้ | `Deal` |
| `today_net_pips` | pips วันนี้ | `sum(position.pips)` ที่ `closeTime` วันนี้ | `Position` |
| `balance` | ยอดเงิน | `getLatestDealBalance(deals)` | `Deal.balance` |
| `equity` | equity | `AccountSnapshot.equity` (fallback: `getLatestDealBalance`) | `AccountSnapshot` |
| `floating_pl` | floating P/L | `AccountSnapshot.floatingPl` (fallback: sum openPositions.profit) | `AccountSnapshot` |
| `status` | Active/Inactive | `updatedAt < 7 นาที` → Active | `TradingAccount.updatedAt` |

**Sort Order:** `today_growth_percent` DESC → `today_net_pips` DESC → `today_net_profit` DESC → `balance` DESC → `account_number` ASC

---

## 7. Formulas สำคัญ

### Growth (MQL5-style Compounded)

```
computeCompoundedGrowth(deals, start, end)

ทุกครั้งที่มี deposit/withdrawal:
  1. คำนวณ growth ของ segment ก่อนหน้า
  2. compound เข้า growthFactor
  3. reset periodStartBalance = balance หลัง deposit

growth% = (growthFactor - 1) × 100

หมายเหตุ: deposit ไม่ทำให้ growth เปลี่ยน — คำนวณต่อจากยอดใหม่เสมอ
```

### Net P/L

```
dealNet(deal) = profit + commission + swap
positionNetPnl = dealNet  // same formula, alias
```

### Profit Factor

```
profitFactor = grossProfit / grossLoss
grossProfit = sum(dealNet > 0)
grossLoss   = sum(abs(dealNet < 0))
→ null ถ้า grossLoss = 0 (ไม่มี trade ขาดทุน)
```

### Sharpe Ratio (per trade)

```
computeSharpeRatio(netValues)
  = mean(netValues) / stdDev(netValues)  [sample std dev]
  → null ถ้า n < 2 หรือ deviation = 0

computeAnnualizedSharpeRatio(netValues, tradesPerYear)
  = sharpe × sqrt(tradesPerYear)
  → ใช้กับ BalanceDetailResponse
  → ใช้ per-trade value ถ้าไม่รู้ tradesPerYear

benchmark: < 1 = แย่, 1-2 = ปานกลาง, 2-3 = ดี, > 3 = ดีมาก
```

### Recovery Factor

```
recoveryFactor = totalNetProfit / maximalDrawdownAmount
→ null ถ้า maximalDrawdownAmount = 0
benchmark: > 1 = recover ได้, > 3 = ดี
```

### Expected Payoff

```
expectedPayoff = totalNetProfit / totalTrades
→ กำไรเฉลี่ยต่อ trade (รวม commission + swap)
```

### Drawdown — 4 แบบ

```
absoluteDrawdown  = totalDeposits - minBalance         (ขาดทุนสะสมทั้งหมด)
maximalAmount     = max peak-to-trough amount          (peak สูงสุด - trough ต่ำสุดที่ตามมา)
maximalPercent    = maximalAmount / peak × 100
relativePercent   = max(ddPercent) ณ จุดที่ percentage แย่ที่สุด (ค่า UI หลัก)
```

### Absolute Drawdown (สำหรับ OPENS context)

```
computeAbsoluteDrawdown(totalWithdrawals, currentBalance, totalDeposits)
  = totalWithdrawals + currentBalance - totalDeposits
```

### Deposit Load %

```
computeDepositLoadPercent(equity, margin)
  = (margin / equity) × 100
→ null ถ้า equity ≤ 0
```

### Pips per Position

```
positionPips(position)
  1. ใช้ position.pips ถ้ามีใน DB
  2. ถ้าไม่มี → คำนวณ: resolveInstrumentSpec(symbol) → pip multiplier
     buy:  (closePrice - openPrice) × multiplier
     sell: (openPrice - closePrice) × multiplier
```

---

## 8. PerformanceRadar — 7 Axes

| Axis | Metric | Benchmark (ideal = 1.0) |
|------|--------|------------------------|
| Sharpe | Annualized Sharpe Ratio | > 2.0 |
| Profit Factor | grossProfit / grossLoss | > 1.5 |
| Recovery Factor | netProfit / maxDrawdown | > 2.0 |
| Win Rate | winning trades % | > 50% |
| Avg Win/Loss | avgProfit / abs(avgLoss) | > 1.5 |
| Consistency | 1 - (stdDev / mean) | > 0.5 |
| Capital Safety | 1 - (maxDrawdown%) | > 0.8 |

---

## 9. Monthly Performance Calendar

คำนวณ growth แต่ละเดือน/ปีโดยใช้ `computeYearGrowth`:

```
computeYearGrowth(deals, year)
  = computeCompoundedGrowth(deals, Jan 1, Dec 31)

monthly:
  = computeCompoundedGrowth(deals, startOfMonth, endOfMonth)
```

แสดงใน `AccountOverviewResponse.monthlyPerformance.years[]`

---

## 10. Trade Execution Distribution

แบ่ง trades ตาม hour (Bangkok time) — แสดงว่า trader เทรดช่วงเวลาไหน:

```
TradeExecutionHourBucket {
  hour: 0-23 (Bangkok hour)
  totalExecutions, buyExecutions, sellExecutions
  totalVolume, totalProfit
}
```

Filter: `MAX_REPORT_FUTURE_SKEW_MS = 5 นาที` — กรองออก deals ที่ timestamp อยู่ในอนาคตเกิน 5 นาที

---

## 11. Tone Rules (สี metric)

| Condition | Tone | ตัวอย่าง |
|-----------|------|---------|
| value > 0 | `positive` (green) | GAIN +$500 |
| value < 0 | `negative` (red) | GAIN -$200 |
| value = 0 | `neutral` (blue) | - |
| drawdown < 10% | `neutral` | DD 5% |
| drawdown 10-20% | `warning` (amber) | DD 15% |
| drawdown > 20% | `negative` (red) | DD 35% |
| ไม่มีข้อมูล | `muted` (grey) | DD - |

---

## 12. Metrics ใน BalanceDetailResponse

| Field | Formula | Source |
|-------|---------|--------|
| `absoluteDrawdown` | `computeAbsoluteDrawdown(withdrawals, balance, deposits)` | `Deal` |
| `relativeDrawdownPct` | `drawdown.relativePercent` | `Deal` |
| `maximalDrawdownAmount` | `drawdown.maximalAmount` | `Deal` |
| `maximalDrawdownPct` | `drawdown.maximalPercent` | `Deal` |
| `averageLossTrade` | `grossLoss / lossCount` | `Position` |
| `maximalDepositLoad` | `(margin / equity) × 100` | `AccountSnapshot` |
| `maximumConsecutiveLossAmount` | `computeConsecutiveRunAmounts(netValues).maxLoss` | `Position` |
| `sharpeRatio` | `computeAnnualizedSharpeRatio(netValues, tradesPerYear)` | `Position` |
| `profitFactor` | `grossProfit / grossLoss` | `Position` |
| `recoveryFactor` | `netProfit / maximalDrawdownAmount` | `Position` + `Deal` |

---

## 13. Metrics ที่ใช้ AccountReportResult (cache)

`AccountReportResult` เก็บ metrics ที่คำนวณเมื่อ import — แต่ API routes **คำนวณใหม่** จาก raw data เสมอ เพื่อรองรับ timeframe

| Stored field | ใช้เมื่อ |
|-------------|---------|
| `profitFactor` | fallback เมื่อ no positions in timeframe |
| `sharpeRatio` | fallback |
| `balanceDrawdownRelativePct` | historical reference |
| `totalTrades` | historical count |
| `maximumConsecutiveWins/Losses` | all-time streaks |
