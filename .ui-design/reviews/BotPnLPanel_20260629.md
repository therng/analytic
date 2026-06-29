# Design Review: BotPnLPanel

**Review ID:** BotPnLPanel_20260629
**Reviewed:** 2026-06-29
**Target:** `src/components/trading-monitor/BotPnLPanel.tsx` + `src/app/globals.css` (lines 1158–1550)
**Focus:** Visual design, usability, code quality
**Platform:** Mobile (iOS Safari portrait/landscape)

## Summary

BotPnLPanel เป็น component ที่ซับซ้อน มี interaction layer ที่ดี (long press, drag sheet, artwork preview) และ animation variants ที่สอดคล้องกัน พบ CSS typos 2 จุดที่จะทำให้ legend ไม่แสดงผล, dead CSS หลายตัว, และ UX gap สำคัญคือ bottom sheet ไม่มี close button ทำให้ user ต้อง drag down เท่านั้น

**Issues Found:** 8

- Critical: 1
- Major: 3
- Minor: 3
- Suggestions: 1

---

## Critical Issues

### Issue 1: CSS Typo — `width: 7x` ใน `.bot-pnl-legend-marker`

**Severity:** Critical
**Location:** `src/app/globals.css:1536`
**Category:** Visual

**Problem:**
```css
.dashboard-section > .account-card .bot-pnl-legend-marker {
  width: 7x;   /* ← typo: ไม่มี 'px' */
  height: 7px;
}
```

**Impact:** Legend marker มีความกว้าง 0 — ไม่แสดงสี่เหลี่ยมสีให้ legend item ใดๆ เลย

**Recommendation:**
```css
/* Before */
width: 7x;

/* After */
width: 7px;
```

---

## Major Issues

### Issue 2: Bottom Sheet ไม่มี Close Button

**Severity:** Major
**Location:** `src/components/trading-monitor/BotPnLPanel.tsx:509–581`
**Category:** Usability

**Problem:**
CSS กำหนด `.bot-pnl-sheet__close` ไว้ (พร้อม hover/focus state ที่ดี) แต่ JSX ใน `bot-pnl-sheet__header` และ `bot-pnl-sheet__card` ไม่มีปุ่มปิดเลย วิธีเดียวที่ปิด sheet ได้คือ drag ลงต่ำกว่า `SHEET_SNAP_THRESHOLD` (38%)

**Impact:** บน iOS Safari เมื่อ sheet อยู่ใน "full" snap mode การ drag ลงต้องเกิน 60%+ ของความสูง panel ก่อนจะปิด ถือว่า discoverable ต่ำมาก โดยเฉพาะ first-time user

**Recommendation:** เพิ่ม close button ใน header:

```tsx
{/* ใน bot-pnl-sheet__header */}
<motion.button
  variants={sheetLineVariants}
  className="bot-pnl-sheet__close"
  type="button"
  aria-label="Close trade history"
  onClick={() => setSelectedBot(null)}
>
  ✕
</motion.button>
```

### Issue 3: `align-items: left` เป็น CSS ที่ไม่ valid

**Severity:** Major
**Location:** `src/app/globals.css:1532`
**Category:** Visual

**Problem:**
```css
.dashboard-section > .account-card .bot-pnl-legend-item {
  display: flex;
  align-items: left;  /* ← invalid value */
  gap: 4px;
}
```

`align-items` ไม่รับค่า `left` — browser จะ ignore property นี้และใช้ค่า default (`stretch`)

**Recommendation:**
```css
align-items: center;  /* หรือ flex-start ตามต้องการ */
```

### Issue 4: `getDensityConfig` ส่งค่า `columnWidth` และ `borderRadius` ที่ไม่ได้ใช้จริง

**Severity:** Major
**Location:** `src/components/trading-monitor/BotPnLPanel.tsx:90–96`, `362`
**Category:** Code quality

**Problem:**
```ts
function getDensityConfig(count: number): DensityConfig {
  return {
    columnWidth: "55%",    // ค่าคงที่ — count ไม่ถูกใช้ที่นี่
    borderRadius: 4,       // ไม่ถูกใช้ใน options (ใช้ค่า hardcode 2 แทน)
    labelFontSize: count > 16 ? "8px" : "12px",
  };
}
```

`density.columnWidth` ถูก spread เข้า chart options แต่ `density.borderRadius` ไม่เคยถูกอ่าน (options ใช้ `borderRadius: 2` โดยตรง) ทำให้ `DensityConfig` interface มี field ที่ไม่ทำงาน

**Recommendation:** ลบ `borderRadius` ออกจาก interface + function:

```ts
interface DensityConfig {
  columnWidth: string;
  labelFontSize: string;
}

function getDensityConfig(count: number): DensityConfig {
  return {
    columnWidth: "55%",
    labelFontSize: count > 16 ? "8px" : "12px",
  };
}
```

---

## Minor Issues

### Issue 5: Dead CSS — `.bot-pnl-legend`, `.bot-pnl-a11y-list`, `.bot-pnl-legend-item`, `.bot-pnl-legend-marker`

**Severity:** Minor
**Location:** `src/app/globals.css:1521–1549`
**Category:** Code quality

**Problem:**
CSS classes เหล่านี้ไม่มี element ใน JSX ของ BotPnLPanel อ้างถึงเลย (legend ถูก render โดย ApexCharts built-in legend แทน)

**Recommendation:** ลบ CSS blocks ที่ไม่ใช้ออก (บรรทัด 1521–1549) ประหยัด ~30 lines

### Issue 6: `MANUAL_LABEL` alias ซ้ำซ้อน

**Severity:** Minor
**Location:** `src/components/trading-monitor/BotPnLPanel.tsx:80`
**Category:** Code quality

**Problem:**
```ts
// Legacy alias — renderer uses emoji for "Manual" label
const MANUAL_LABEL = MANUAL_BOT_LABEL;
```
ถูกใช้ใน JSX เพียง 1 จุด (line 384) และ 1 จุดใน logic (line 457) — ทำให้มีชื่อ 2 ชื่อสำหรับค่าเดียวกัน

**Recommendation:** ใช้ `MANUAL_BOT_LABEL` โดยตรงและลบ alias ออก

### Issue 7: Bottom Sheet ไม่มี Escape key handler

**Severity:** Minor
**Location:** `src/components/trading-monitor/BotPnLPanel.tsx:498–677`
**Category:** Accessibility

**Problem:**
Sheet ถูก mark ว่า `role="dialog"` แต่ไม่มี `onKeyDown` handler สำหรับ Escape key ตาม ARIA dialog pattern

**Recommendation:**
```tsx
<motion.div
  className="bot-pnl-sheet"
  role="dialog"
  aria-label={`${historyLabel} trade history`}
  onKeyDown={(e) => e.key === "Escape" && setSelectedBot(null)}
  ...
>
```

---

## Suggestions

### Suggestion 1: `artworkPreview` ควร dismiss ได้ด้วยการแตะ

**Severity:** Suggestion
**Location:** `src/components/trading-monitor/BotPnLPanel.tsx:247–248`
**Category:** Usability

ปัจจุบัน `handlePointerDown` dismisses artwork แต่ก็ยิ่ง trigger long-press timer ด้วยทันที ทำให้ user ที่แตะเพื่อปิด artwork อาจ trigger bot selection เปลี่ยนแทน เพิ่ม early return หลัง dismiss:

```ts
const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
  if (artworkPreview) {
    dismissArtwork();
    return; // ← อย่า start long-press ในการแตะเดียวกัน
  }
  // ... rest of handler
}, [artworkPreview, dismissArtwork, hitTestBar, bots]);
```

---

## Positive Observations

- **`memo` + `useMemo` ครบถ้วน** — ทุก derived value (bots, series, options, chartStyle) ถูก memoize ถูกต้อง ไม่มี unnecessary re-renders
- **`startTransition` สำหรับ timeframe change** (line 199) — ดีมาก ป้องกัน UI jank เมื่อ timeframe เปลี่ยน
- **Animation variants** สอดคล้องและ spring physics ดูเป็นธรรมชาติ (stagger, scale pop สำหรับ count badge)
- **Pointer event handling** แยก concern ชัดเจนระหว่าง chart interaction กับ sheet drag
- **ApexCharts ref** เก็บ chart instance ใน ref (ไม่ใช่ state) เพื่อหลีกเลี่ยง stale closure ใน hit test — pattern ที่ถูกต้อง
- **`aria-label`** บน panel และ dialog — accessibility foundation ดี

---

## Next Steps (Priority Order)

1. **[Critical]** แก้ `width: 7x` → `width: 7px` ใน `globals.css:1536`
2. **[Major]** เพิ่ม close button ใน `bot-pnl-sheet__header` และ `bot-pnl-sheet__card`
3. **[Major]** แก้ `align-items: left` → `align-items: center` ใน `globals.css:1532`
4. **[Major]** Simplify `DensityConfig` — ลบ `borderRadius` field ที่ไม่ใช้
5. **[Minor]** ลบ dead CSS block (bot-pnl-legend, bot-pnl-a11y-list)
6. **[Minor]** ลบ `MANUAL_LABEL` alias, ใช้ `MANUAL_BOT_LABEL` โดยตรง
7. **[Minor]** เพิ่ม Escape key handler ใน sheet dialog
8. **[Suggestion]** Early return ใน `handlePointerDown` หลัง artwork dismiss

---

_Generated by UI Design Review — 2026-06-29_
