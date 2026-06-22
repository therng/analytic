# BotPnLPanel Component Documentation

## Overview

`BotPnLPanel` คือ React component ที่แสดงผลประสิทธิภาพของแต่ละ BOT ในรูปแบบ **stacked bar chart** เปรียบเทียบกำไร (Gross Profit) และขาดทุน (Gross Loss) ของแต่ละบอท

- **ที่ตั้ง:** `src/components/trading-monitor/BotPnLPanel.tsx`
- **ประเภท:** React Functional Component with `memo` optimization
- **ใช้:** ApexCharts สำหรับ visualization
- **ข้อมูลเข้า:** Historical positions data ตามอ้างอิงช่วงเวลา

---

## Component Purpose

ให้ operator มองเห็นอย่างรวบรัดว่า:
1. BOT ไหนได้กำไรมากที่สุด
2. BOT ไหนขาดทุนมากที่สุด
3. จำนวน winning trades vs losing trades ต่อ BOT
4. Manual trades (ไม่มี BOT name) vs automated

**ตัวอย่าง:** ถ้าอมมี 3 BOT (EA1, EA2, Manual):
- EA1: Profit $500 (5 wins), Loss -$100 (2 losses)
- EA2: Profit $300 (3 wins), Loss -$200 (4 losses)
- Manual: Profit $50 (1 win), Loss -$25 (1 loss)

Chart จะแสดง 3 columns คู่ (แต่ละคู่มี green bar สำหรับ profit + red bar สำหรับ loss)

---

## Data Flow

```
positions (API) 
  ↓
filterByTimeframe (getSinceDate)
  ↓
aggregate() → BotStat[]
  ↓
[series] → ApexCharts
  ↓
Interactive Bar Chart
```

### 1. **Timeframe Filter**
```typescript
useMemo(() => {
  if (!positions?.length) return positions;
  const since = getSinceDate(timeframe);
  if (!since) return positions;
  return positions.filter(p => p.closedAt != null && new Date(p.closedAt) >= since);
}, [positions, timeframe]);
```
- ฟิลเตอร์ positions ที่ปิดไปแล้ว (closedAt != null)
- แยกตามช่วงเวลา: `all`, `1D`, `1W`, `1M` เป็นต้น
- `getSinceDate()` จาก analytics lib → คืนค่า Date เท่านั้น

---

## Key Functions

### `classifyBot(comment: string | null | undefined): string`

**Purpose:** จับคู่ position comment เข้ากับ **MQL5 bot** ตัวจริง โดยคืนค่า canonical key (เช่น `"quantum-queen"`) ที่ใช้ lookup ใน `BOT_REGISTRY`

**Logic:**
1. ถ้า comment ว่าง/null → `"Manual"` (emoji 😎)
2. ลบ hash prefix `"#123 | TOKEN"` → เหลือ `"TOKEN"`
3. ถ้าเป็น exit-tag `[tp ...]` / `[sl ...]` → `"Manual"`
4. ไล่ `BOT_MATCHERS` ตามลำดับ (specific → generic) ตัวแรกที่ match คืน key นั้น
5. ไม่ match → `"Manual"`

**ตัวอย่าง (จาก comment จริงในรายงาน):**
```
"QQ[XAUUSD]1234[T1/S01]"  → "quantum-queen"
"Gold House_PendingA"     → "gold-house"
"Wall Street"             → "wall-street"
"Axonshift-NX Buy"        → "axonshift"
"#4067985731|GW"          → "goldwave"
"#34087419|AX"            → "axio-gold"
"AutoTrf" / null / ""     → "Manual"
```

**สำคัญ:** ลำดับใน `BOT_MATCHERS` สำคัญ — `^AX$` / `^GW$` ถูก anchor ไว้ และวางหลัง `axonshift` เพื่อไม่ให้ token สั้นถูกกลืน

**Regex หลัก:**
- `HASH_ID_REGEX = /^#\d+\|\s*(.+)$/` — แยก hash prefix ออก
- `TP_SL_TAG_REGEX = /^\[(?:tp|sl)\b/i` — ตัด exit-tag ออกเป็น Manual

---

### `BOT_REGISTRY` & `BOT_MATCHERS`

`BOT_REGISTRY: Record<string, BotMeta>` เก็บ metadata ของบอทแต่ละตัว ใช้ render โลโก้/ชื่อ/ราคา:

```typescript
interface BotMeta {
  key: string;    // canonical key (= classifyBot output)
  name: string;   // ชื่อเต็มบน preview card เช่น "Quantum Queen MT5"
  short: string;  // ชื่อย่อใต้โลโก้ เช่น "Quantum"
  logo: string;   // URL โลโก้จาก c.mql5.com (60x60)
  price: string;  // ราคาขาย เช่น "1,999.99"
}
```

ครอบคลุม 17 บอท (Quantum Queen, Gold House, Wall Street Robot, Full Throttle DMX, Axonshift,
TwisterPro, AnE, BB Return, Aurum AI, Goldwave, AXIO Gold, Chiroptera, Gold OPR Killer, Nexorion,
NODE Neural, GoldFish, ARIA Connector) — บางตัวยังไม่โผล่ในข้อมูลจริงแต่ใส่ไว้เผื่ออนาคต

---

### `aggregate(positions: Position[] | null | undefined): BotStat[]`

**Purpose:** รวม P/L statistics ตามแต่ละ BOT

**Output Type:**
```typescript
interface BotStat {
  name: string;              // canonical key เช่น "quantum-queen", "Manual"
  grossProfit: number;       // รวม profit ของ winning trades
  grossLoss: number;         // รวม loss ของ losing trades (ติดลบ)
  netPnl: number;            // grossProfit + grossLoss
  wins: number;              // จำนวน winning trades
  losses: number;            // จำนวน losing trades
}
```

**Logic:**
1. Loop แต่ละ position
2. Calculate net PnL: `profit + swap + commission`
3. Group by normalized bot name
4. ถ้า net ≥ 0 → wins list; ถ้า net < 0 → losses list
5. Sort ตาม netPnl descending (ที่ทำกำไรมากสุดขึ้นหน้า)

**Example:**
```typescript
Position A: { profit: 100, swap: 5, commission: -2 } → net = 103 ✓ wins
Position B: { profit: -50, swap: 0, commission: -5 } → net = -55 ✗ losses
```

---

### `getDensityConfig(): DensityConfig`

**Purpose:** ค่าคงที่สำหรับ plot ของแท่ง (`columnWidth: "55%"`, `borderRadius`) — ตั้งแต่ย้าย label ไปเป็น logo row ด้านล่างแล้ว จึงไม่ต้องปรับ font size ตามจำนวนบอทอีก

---

### Logo Row & Long-press Preview

แทนที่ label ตัวอักษรบนแกน X เดิม ตอนนี้ render **โลโก้ + ชื่อย่อ** เป็นแถวใต้กราฟ:

- `LogoCell` — หนึ่งช่องต่อหนึ่งบอท ใช้ `flex: 1 1 0` เท่ากันทุกช่อง เรียงลำดับเดียวกับแท่ง
  จึงอยู่ **ตรงกลางใต้แท่งของตัวเอง** (ดู "การ align" ด้านล่าง)
- **ข้อความใต้โลโก้** = โค้ดย่อ 3 ตัวแบบเดิม (`shortCode()` → leading 1-3 alnum ของ comment เช่น
  "QQ", "Gol", "Wal") เก็บใน `BotStat.code` ตอน aggregate; ถ้าว่าง fallback เป็น `meta.short`
- บอทที่ไม่รู้จัก (`Manual`) → แสดง 😎 แทนโลโก้ และไม่ตอบสนองการกด
- **แตะค้าง (long-press ~380ms)** ที่โลโก้ → เปิด `BotPreviewCard` (framer-motion) แสดงโลโก้ใหญ่ + ชื่อเต็ม + ราคา
- `useLongPress` ใช้ pointer events + guard: ถ้านิ้วเลื่อนเกิน 10px (เช่นกำลัง scroll) จะ **ยกเลิก** ไม่เปิด card → ปลอดภัยบน iOS Safari ที่ container scroll ได้
- CSS กัน iOS image callout: `-webkit-touch-callout: none` + `user-select: none` บนช่องโลโก้

**การ align (zero-inset invariant):** ทั้งแท่งและโลโก้แบ่งความกว้าง _เดียวกัน_ ออกเป็น N ส่วนเท่ากัน
จึงตรงกันโดยอัตโนมัติ เงื่อนไขเดียวที่ทำให้เพี้ยนคือ inset ซ้ายของ plot area ApexCharts — แก้โดยตั้ง
`yaxis.floating: true` + `grid.padding.left: 0` ให้ plot กินเต็มความกว้าง (สเกล K/M ลอยทับโดยไม่กินที่)
logo row อยู่ใน `.bot-pnl-canvas-wrap` เดียวกับกราฟจึง scroll ไปพร้อมกัน ไม่ drift

---

### `getBotPnlChartStyle(count: number): CSSProperties`

**Purpose:** Set canvas width + min-width เพื่อให้ scroll ได้เมื่อ BOT เยอะ

```typescript
{
  width: count ≤ 16 ? "100%" : `${(count / 16) * 100}%`,
  minWidth: `${count * 48}px`,  // 48px ต่อ column
  height: "100%"
}
```

**Example:**
- 8 BOT → width 100% (fit ใน container)
- 32 BOT → width 200%, minWidth 1536px (2x container, scroll ได้)

---

## ApexCharts Configuration

### Series (Data)

```typescript
[
  { name: "+", data: [botProfit1, botProfit2, ...] },
  { name: "-", data: [abs(botLoss1), abs(botLoss2), ...] }
]
```

- **First series (green "+"): Gross Profit** — ความสูง = total winning trades $ 
- **Second series (red "-"): Gross Loss (absolute)** — ความสูง = total losing trades $

### Chart Options

| Option | Value | Purpose |
|--------|-------|---------|
| type | `"bar"` | Stacked bar chart |
| colors | Green + Red | Profit/Loss color coding |
| distributed | false | Grouped bars (by BOT), not distributed |
| animations | disabled gradual/dynamic | Smooth render, no jank |
| xaxis.categories | bot keys | ใช้จัดตำแหน่งแท่งเท่านั้น (`labels.show: false` — แสดงเป็น logo row แทน) |
| yaxis.floating | true | สเกล K/M ลอยทับ ไม่กิน inset ซ้าย → logo align กับแท่งได้ |
| tooltip.custom | HTML builder | Show `$500 (5)` = amount + trade count |
| zoom, toolbar | disabled | Simplified UI |

### Tooltip Example

```html
<div>
  <span style="color: #3DD68C; font-weight: 600;">$500.00</span>
  <span style="color: #FFEB3B; font-weight: 600;"> (5)</span>
</div>
```
→ Green "$500.00" + Yellow "(5 trades)"

---

## Props

```typescript
interface Props {
  positions: PositionsResponse["historyPositions"] | null | undefined;
  timeframe?: Timeframe;  // "all" | "1D" | "1W" | "1M" etc. (default: "all")
}
```

### Example Usage

```typescript
<BotPnLPanel positions={accountData.historyPositions} timeframe="1D" />
```

---

## Performance Optimizations

1. **`memo(BotPnLPanelImpl)`** — Prevent re-render ถ้า props ไม่เปลี่ยน
2. **`useMemo` ทั้งหมด** — Re-compute เมื่อ dependency เปลี่ยนเท่านั้น:
   - `filteredPositions` ← positions, timeframe
   - `bots` ← filteredPositions
   - `series` ← bots
   - `options` ← bots, chartId, density
   - `chartStyle` ← bots.length (`density` เป็นค่าคงที่)

3. **`dynamic` import ApexCharts** — SSR-safe, load only in browser

---

## Edge Cases

| Case | Handling |
|------|----------|
| No positions | Show empty state: `"No bot activity for this timeframe."` |
| Single BOT | Show 1 column pair; density still applies |
| No comment (null) | Treated as `"Manual"` (😎) |
| Comment ไม่ match บอทใด | Treated as `"Manual"` |
| Exit-tag `[tp ...]` / `[sl ...]` | Treated as `"Manual"` |
| โลโก้ remote โหลดไม่ขึ้น | ช่องยังอยู่ (alt ว่าง) — ไม่ทำ layout พัง |
| Zero P/L | Included in both wins + losses correctly |
| Timeframe "all" | No filter, all positions shown |

---

## Visual Hierarchy

```
┌─ BotPnLPanel ─────────────────────────────┐
│                                            │
│  aria-label="Bot performance"              │
│  role="region"                             │
│                                            │
│  ┌─ bot-pnl-scroll (horizontal overflow)─┐│
│  │ ┌─ bot-pnl-canvas-wrap ───────────┐  ││
│  │ │                                 │  ││
│  │ │  [ApexCharts Bar Chart]         │  ││
│  │ │  ██ +  ███ + ▌ +  ████ +        │  ││
│  │ │  ██ -  ██  - ▌ -  ███  -        │  ││
│  │ ├─ bot-pnl-logos (flex row) ──────┤  ││
│  │ │  🟦     🟨    😎    🟩          │  ││
│  │ │ Quantum GoldH Manual Wall      │  ││
│  │ └─────────────────────────────────┘  ││
│  │   (แตะค้างที่โลโก้ → preview card)    ││
│  └────────────────────────────────────────┘│
│                                            │
│  Legend (bottom): [+] [-]                  │
└────────────────────────────────────────────┘
```

---

## Accessibility (a11y)

- `role="region"` — Screen readers recognize as a content region
- `aria-label="Bot performance"` — Descriptive label
- Colors: Green (#3DD68C) + Red (#F04D4D) + accessible contrast
- Hover state: Lighten bars on hover
- โลโก้แต่ละช่องเป็น `<button>` มี `aria-label="<ชื่อบอท> — hold for preview"`

---

## Related Components

- **Parent:** Dashboard main panel (receives positions from API)
- **Sibling:** DrawdownEquityPanel, PerformanceRadar (other KPI visualizations)
- **Data Source:** `GET /api/accounts/[id]?timeframe=...` → historyPositions

---

## Summary

| Aspect | Details |
|--------|---------|
| **What** | Bar chart of P/L by BOT |
| **How** | Aggregate positions → classify เป็น MQL5 bot → grouped bar + logo row |
| **Why** | Quick visual of which bots are profitable |
| **Scale** | Up to 32+ bots; horizontally scrollable |
| **Data** | Closed positions only; includes swap + commission in P/L |
| **Performance** | Memoized; SSR-safe ApexCharts; responsive layout |
