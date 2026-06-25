# Bot Comment → Label Mapping

เอกสารนี้อธิบายวิธีที่ระบบแปลง **Position.comment** จาก MT5 ให้กลายเป็น **label บอท** ที่แสดงใน BotPnLPanel

> **แหล่งที่มา:** `src/components/trading-monitor/BotPnLPanel.tsx` → `normalizeBotName()`

---

## Data Flow

```
MT5 HTML Report
    │
    ▼
Position.comment  (string | null)
    │  stored in: Position.comment, Deal.comment
    │  parsed by: src/lib/parser/index.ts → getOptionalCommentCell()
    ▼
getBotLabel(comment)          ← src/lib/trading/bots.ts
    │  1. classifyBot()  → match against BOT_REGISTRY patterns → BotMeta.label
    │  2. fallback       → 3-char token extraction (unregistered EAs)
    ▼
BotStat.name  →  Bar chart X-axis label
```

---

## Algorithm: `getBotLabel(comment)` + `classifyBot(comment)`

```
ไฟล์: src/lib/trading/bots.ts
```

```
Input  → comment: string | null | undefined
Output → label: string  (เช่น "QUE", "GW", "AXN", "Manual")
```

### `classifyBot(comment)` — Pattern Matching (Known EAs)

| ขั้น | เงื่อนไข | ผลลัพธ์ |
|------|----------|---------|
| 1 | null / undefined / ว่าง | `null` (Manual) |
| 2 | ขึ้นต้นด้วย `#<number>\|` | ตัด prefix → เหลือส่วนหลัง `\|` |
| 3 | หลังตัด prefix แล้วว่าง | `null` |
| 4 | ขึ้นต้นด้วย `[tp ...]` / `[sl ...]` | `null` (MT5 exit tag — ไม่ใช่บอท) |
| 5 | ลองทีละ pattern ใน `MATCHERS[]` (specific → generic) | first match → คืน `BotMeta` |
| 6 | ไม่ match ใด ๆ | `null` (unknown EA) |

### `getBotLabel(comment)` — Final Label

```
classifyBot() !== null  →  BotMeta.label   ("QUE", "GW", "HOU", …)
classifyBot() === null
  ├─ null/empty/exit-tag  →  "Manual"
  └─ unknown EA           →  token extraction fallback (3-char uppercase)
```

**Token extraction fallback** (สำหรับ EA ที่ไม่อยู่ใน registry):
- ตัด hash-id prefix
- ดึง `/[A-Za-z0-9]+/g` tokens
- ข้าม token แรกถ้าเป็น `"gold"` (ไม่ distinguish)
- เอา 3 ตัวแรก + uppercase

**Regex หลัก:**
```
HASH_ID_REGEX   = /^#\d+\|\s*(.+)$/   →  "#4067985|GW" → "GW"
TP_SL_TAG_REGEX = /^\[(?:tp|sl)\b/i   →  "[tp 1.2345]" → Manual
```

---

## ตัวอย่าง Comment → Label

### รูปแบบ Hash-ID Prefix

comment ที่ขึ้นต้นด้วย `#<number>|` พบบ่อยใน EA ที่ใส่ magic number

| Comment (จาก MT5) | หลังตัด prefix | Label |
|-------------------|---------------|-------|
| `#4067985731\|GW` | `GW` | **GW** |
| `#34087419\|AX` | `AX` | **AX** |
| `#12345\|AxioGold` | `AxioGold` | **AXI** |
| `#99999\|Chiroptera` | `Chiroptera` | **CHI** |
| `#12345\|` | (ว่าง) | **Manual** |

### รูปแบบ Plain Name

| Comment (จาก MT5) | Tokens | Label |
|-------------------|--------|-------|
| `QuantumQueen` | `["QuantumQueen"]` | **QUA** |
| `QQ[XAUUSD]1234` | `["QQ", "XAUUSD", "1234"]` | **QQ** |
| `Wall Street` | `["Wall", "Street"]` | **WAL** |
| `Axonshift-NX Buy` | `["Axonshift", "NX", "Buy"]` | **AXO** |
| `TwisterPro v2` | `["TwisterPro", "v2"]` | **TWI** |
| `FullThrottleDMX` | `["FullThrottleDMX"]` | **FUL** |
| `AnE` | `["AnE"]` | **ANE** |

### กฎพิเศษ: ข้าม "Gold" Token

token แรกที่เป็น `gold`/`Gold`/`GOLD` จะถูกข้ามไปใช้ token ถัดไป
เหตุผล: บอทที่ trade ทอง (XAUUSD) มักขึ้นต้นด้วย "Gold" ซึ่งไม่ distinguish ตัวบอท

| Comment | Tokens | Token ที่ใช้ | Label |
|---------|--------|-------------|-------|
| `Gold House_PendingA` | `["Gold", "House", "PendingA"]` | `House` | **HOU** |
| `GoldWave EA` | `["GoldWave", "EA"]` | `GoldWave` ← ไม่ข้าม (ไม่ใช่แค่ "gold") | **GOL** |
| `GOLD_EA_v3` | `["GOLD", "EA", "v3"]` | `EA` ← ข้าม "GOLD" | **EA** |
| `gold` | `["gold"]` | `gold` ← fallback ตัวเดิม ถ้าไม่มีตัวถัดไป | **GOL** |

### รูปแบบ Manual / ไม่ระบุ

| Comment | Label |
|---------|-------|
| `null` | **Manual** |
| `""` (ว่าง) | **Manual** |
| `"   "` (space) | **Manual** |
| `AutoTrf` | **AUT** ← บอทระบบ ไม่ใช่ manual แต่ label ขึ้นด้วย token |
| `[tp 1.2345]` | token แรก = `tp` | **TP** ← exit tag จาก MT5 |
| `[sl 1.2300]` | token แรก = `sl` | **SL** ← exit tag จาก MT5 |

> **หมายเหตุ:** comment แบบ `[tp ...]` / `[sl ...]` เป็น auto-comment ของ MT5 ตอนปิด position ด้วย TP/SL — ไม่ใช่บอทจริง แต่ algorithm ปัจจุบันไม่กรองออก จะได้ label `TP` / `SL` แทน

---

## BOT_REGISTRY — 17 Known EAs

ดู `src/lib/trading/bots.ts` สำหรับ patterns ครบถ้วน

| Label | Key | ชื่อเต็ม | Comment Pattern ตัวอย่าง |
|-------|-----|---------|--------------------------|
| **QQ** | quantum-queen | Quantum Queen MT5 | `QQ[XAUUSD]1234[T1/S01]` |
| **HOU** | gold-house | Gold House | `Gold House_PendingA`, `#xxx\|GH` |
| **WAL** | wall-street | Wall Street Robot | `Wall Street` |
| **FUL** | full-throttle | Full Throttle DMX | `FullThrottleDMX` |
| **AXO** | axonshift | Axonshift | `Axonshift-NX Buy` |
| **TWI** | twisterpro | TwisterPro | `TwisterPro v2` |
| **ANE** | ane | AnE | `AnE` (exact) |
| **BB** | bb-return | BB Return | `BB Return` |
| **AUR** | aurum-ai | Aurum AI | `Aurum AI` |
| **GW** | goldwave | GoldWave | `#4067985731\|GW`, `GoldWave EA` |
| **AX** | axio-gold | AXIO Gold | `#34087419\|AX`, `AXIO Gold` |
| **CHI** | chiroptera | Chiroptera | `Chiroptera` |
| **OPR** | gold-opr-killer | Gold OPR Killer | `Gold OPR Killer` |
| **NEX** | nexorion | Nexorion | `Nexorion` |
| **NOD** | node-neural | NODE Neural | `Node Neural` |
| **GFI** | goldfish | GoldFish | `GoldFish` |
| **ARI** | aria-connector | ARIA Connector | `ARIA Connector` |
| **Manual** | — | Manual / ไม่ระบุ | null / `""` / whitespace เท่านั้น |

---

## จุดอ่อนของ Algorithm ปัจจุบัน

| ปัญหา | ตัวอย่าง | ผลกระทบ |
|-------|---------|---------|
| Short token ชนกัน | `AX` = Axonshift? หรือ AXIO Gold? | merge เป็น bar เดียว |
| "Gold" prefix rule ใช้ exact `gold` เท่านั้น | `GOLD_` ข้ามได้ แต่ `Goldfish` ไม่ข้าม | `Goldfish` → **GOL** แทนที่จะเป็น **FIS** |
| TP/SL exit comment ไม่ถูกกรอง | `[tp 1.234]` → **TP** | มี bar "TP" ปน |
| Comment ต่างกัน → label เหมือนกัน | `"TWI_v1"` + `"TwisterPro"` → ทั้งคู่ **TWI** | รวมเป็น group เดียว (ตั้งใจ) |

---

## การเพิ่ม EA ใหม่เข้า Registry

1. เพิ่ม entry ใน `BOT_REGISTRY` (`src/lib/trading/bots.ts`):
   ```typescript
   "new-ea": { key: "new-ea", label: "NEW", name: "New EA Name" },
   ```
2. เพิ่ม entry ใน `MATCHERS[]` (ในไฟล์เดิม) โดยเรียงจาก specific → generic:
   ```typescript
   { meta: BOT_REGISTRY["new-ea"], patterns: [/new[\s_-]?ea/i, /^NEW$/] },
   ```
3. อัปเดตตาราง "Known Bot Labels" ใน doc นี้

---

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | บทบาท |
|------|-------|
| `src/lib/trading/bots.ts` | **BOT_REGISTRY, MATCHERS, classifyBot(), getBotLabel()** |
| `src/lib/parser/index.ts:404` | parse `comment` column จาก MT5 HTML |
| `src/worker/index.ts:343` | store `position.comment` ลง PostgreSQL |
| `prisma/schema.prisma:101` | `Position.comment String?` |
| `src/components/trading-monitor/BotPnLPanel.tsx` | ใช้ `getBotLabel()` สำหรับ aggregate + chart |
