# Design Review: PerformanceQualityPanel

**Review ID:** PerformanceQualityPanel_20260604_202425
**Reviewed:** 2026-06-04 20:24
**Target:** src/components/trading-monitor/PerformanceQualityPanel.tsx
**Focus:** Visual · Usability · Code · Performance
**Platform:** Mobile-first responsive (iOS Safari primary)

## Summary

PerformanceQualityPanel เป็น component ที่ออกแบบได้ดีในภาพรวม — SVG gauge geometry ชัดเจน, zone definitions แยกออกมาเป็น constants, และ touch interaction ครบ (longpress, vibration) สำหรับ mobile. พบปัญหาหลัก 3 จุด: hook ref type mismatch ที่ซ้ำใน 3 component, `meta` field ที่ compute ไว้แต่ไม่ render, และ bars array ที่สร้างใหม่ทุก render โดยไม่จำเป็น.

**Issues Found:** 7

- Critical: 0
- Major: 3
- Minor: 2
- Suggestions: 2

---

## Major Issues

### Issue 1: Hook ref type mismatch — triple cast ซ้ำ 3 ครั้ง

**Severity:** Major
**Location:** PerformanceQualityPanel.tsx:517, :631, :675
**Category:** Code

**Problem:**
`useKpiHint` คืน `chipRef: React.RefObject<HTMLElement | null>` แต่ทุก consumer ต้องใช้ `as unknown as React.RefObject<HTMLDivElement>` เพื่อให้ compile ผ่าน pattern นี้ปรากฏ 3 ครั้งใน QualityGauge, ProfitabilityBar, ComparisonBar.

**Impact:**
`as unknown as` ทำลาย type safety ทั้งหมด — TypeScript จะไม่ catch ถ้า hook เปลี่ยน ref type ในอนาคต. Pattern นี้ยังบ่งชี้ว่า hook signature แคบเกินไป.

**Recommendation:**
แก้ที่ `useKpiHint` hook ใน SummaryChip.tsx ให้รับ generic parameter หรือเปลี่ยนเป็น `useRef<HTMLDivElement | null>`:

```tsx
// SummaryChip.tsx — ก่อน
const chipRef = useRef<HTMLElement | null>(null);

// หลัง
const chipRef = useRef<HTMLDivElement | null>(null);

// consumer — ก่อน
ref={triggerRef as unknown as React.RefObject<HTMLDivElement>}

// หลัง
ref={triggerRef}
```

---

### Issue 2: `meta` field computed แต่ไม่ถูก render

**Severity:** Major
**Location:** PerformanceQualityPanel.tsx:98, :305 / ComparisonBar component:685–687
**Category:** Usability

**Problem:**
`ComparisonBarConfig.meta` ถูก populate ใน `buildLongShortTradeBar` เป็น `"TOTAL 20"` (total trade count) แต่ `ComparisonBar` component ไม่ render `config.meta` ที่ไหนเลย. ข้อมูลสำคัญหายเงียบๆ.

**Impact:**
User ไม่เห็น total trade count ที่ควรช่วย interpret LONG/SHORT split — ถ้ามีเทรดแค่ 2 ครั้ง (1 Long, 1 Short) กับ 200 ครั้ง split 50/50 ดูเหมือนกันทั้งที่ความหมายต่างกันมาก.

**Recommendation:**
Render `meta` ใน title row ของ `ComparisonBar`:

```tsx
// ก่อน
<div className="comparison-bar__title-row">
  <span className="comparison-bar__title">{config.title}</span>
</div>

// หลัง
<div className="comparison-bar__title-row">
  <span className="comparison-bar__title">{config.title}</span>
  {config.meta ? (
    <span className="comparison-bar__meta">{config.meta}</span>
  ) : null}
</div>
```

และ restore `.comparison-bar__meta` CSS rule ที่ถูกลบใน refactor รอบก่อน.

---

### Issue 3: `bars` array สร้างใหม่ทุก render

**Severity:** Major
**Location:** PerformanceQualityPanel.tsx:738–773
**Category:** Performance

**Problem:**
`bars` array ภายใน `PerformanceQualityPanelImpl` ถูกสร้างใหม่ทุก render — แต่ละ element มี `zones`, `zoneColors`, `scaleMax` ที่เป็น stable constants. มีแค่ `value` เท่านั้นที่ขึ้นกับ props.

**Impact:**
`QualityGauge` component ที่ wrap ด้วย `memo` ไม่ได้ใช้ memo เนื่องจาก `config` object reference เปลี่ยนทุก render แม้ค่าจะเหมือนเดิม.

**Recommendation:**
```tsx
// ก่อน — array literal ใน component body
const bars: BarConfig[] = [
  { key: "sharpe", value: sharpeRatio, zones: SHARPE_ZONES, ... },
  ...
];

// หลัง — memoize โดย depend เฉพาะ values ที่เปลี่ยน
const bars = useMemo<BarConfig[]>(() => [
  { key: "sharpe", value: sharpeRatio, zones: SHARPE_ZONES, scaleMax: 5, zoneColors: ZONE_COLORS, label: "SHARPE", hint: { definition: "ความคุ้มค่าของผลตอบแทนเมื่อเทียบกับความเสี่ยง" } },
  { key: "pf", value: profitFactor, zones: PROFIT_FACTOR_ZONES, scaleMax: 4, zoneColors: ZONE_COLORS, label: "PROFIT F.", infinityZoneIndex: 2, hint: { definition: "ความสามารถในการทำกำไรเทียบกับการขาดทุน" } },
  { key: "recovery", value: recoveryFactor, zones: RECOVERY_ZONES, scaleMax: 7, zoneColors: ZONE_COLORS, label: "RECOVERY", hint: { definition: "ความสามารถในการฟื้นตัวจาก Drawdown" } },
], [sharpeRatio, profitFactor, recoveryFactor]);
```

---

## Minor Issues

### Issue 4: ProfitabilityBar แสดง 50/50 เมื่อไม่มีข้อมูล

**Severity:** Minor
**Location:** PerformanceQualityPanel.tsx:615
**Category:** Visual / Usability

**Problem:**
```tsx
const winPct = hasValue ? Math.max(0, Math.min(winPercent as number, 100)) : 50;
```
เมื่อไม่มีข้อมูล bar แสดง 50/50 split (dimmed ด้วย `data-empty`) แต่ 50/50 เป็น "ข้อมูลจริง" ที่มีความหมาย — user อาจอ่านผิดว่า win rate คือ 50% ทั้งที่ยังไม่มีข้อมูล.

**Recommendation:**
ใช้ width 0 / 100 แบบ single solid block หรือ hide bar ทั้งหมดเมื่อ `!hasValue`:

```tsx
const winPct = hasValue ? Math.max(0, Math.min(winPercent as number, 100)) : 0;
const lossPct = hasValue ? 100 - winPct : 0;
// และใน JSX เพิ่ม: data-empty ทำให้ opacity ลง แต่ width 0 ชัดเจนกว่า
```

---

### Issue 5: `QualityGauge` build-time hint objects สร้างใหม่ทุก render

**Severity:** Minor
**Location:** PerformanceQualityPanel.tsx:746–771
**Category:** Performance

**Problem:**
`hint: { definition: "..." }` ภายใน bars array เป็น inline object literal — ทุก render สร้าง object ใหม่แม้ค่าจะ identical. เมื่อแก้ Issue 3 ด้วย `useMemo` จะแก้ issue นี้ด้วยในตัว.

---

## Suggestions

### Suggestion 1: ลบ `meta` ออกจาก interface หรือ render ให้ครบ

**Location:** PerformanceQualityPanel.tsx:98
**Category:** Code

`ComparisonBarConfig.meta?: string` ควร render หรือลบออกจาก interface เลย. ปัจจุบันเป็น "ghost field" ที่ทำให้ API เข้าใจผิด. แนะนำให้ render (ดู Issue 2) เพราะ total trade count มีประโยชน์.

---

### Suggestion 2: ย้าย GAUGE constant ออกนอก module scope เป็น `const` typed

**Location:** PerformanceQualityPanel.tsx:111
**Category:** Code

```tsx
// ปัจจุบัน
const GAUGE = { cx: 100, cy: 100, r: 80, sw: 13 } as const;

// ดีกว่า — explicit type ช่วย doc
interface GaugeGeometry { cx: number; cy: number; r: number; sw: number; }
const GAUGE: GaugeGeometry = { cx: 100, cy: 100, r: 80, sw: 13 };
```

---

## Positive Observations

- **SVG gauge เป็น pure calculation** — `gaugePoint`, `arcPath`, `clamp01` ไม่มี side effect และ testable ได้ง่าย
- **Zone definitions แยกเป็น constants** (SHARPE_ZONES, PROFIT_FACTOR_ZONES, RECOVERY_ZONES) พร้อม Thai labels — maintainable มาก
- **Touch interaction ครบ** — `handleTouchStart/Move/Cancel/End` + vibration สำหรับ mobile UX
- **Accessibility ครบ** — `role="img"`, `aria-label` ที่มี Thai zone label, `data-empty` attribute
- **Export ที่ตั้งใจ** — builder functions (buildAverageProfitLossBar ฯลฯ) export ออกมาเพื่อ test ได้โดยตรง ไม่ต้อง mount component
- **`memo` wrapper** บน component หลัก และ `PerformanceQualityPanel` เป็น named export ที่ชัดเจน

## Next Steps (เรียงตาม priority)

1. **Issue 2 (meta)** — render `config.meta` ใน ComparisonBar + restore CSS rule (ข้อมูล total trade count หายไปจาก UI)
2. **Issue 3 (bars memo)** — wrap bars ด้วย `useMemo` เพื่อให้ QualityGauge memo ทำงานจริง
3. **Issue 1 (ref type)** — แก้ `useKpiHint` hook ใน SummaryChip.tsx เปลี่ยน `HTMLElement` → `HTMLDivElement`
4. **Issue 4 (empty bar)** — เปลี่ยน fallback จาก `50` เป็น `0` เพื่อ clarity

---

_Generated by UI Design Review — 2026-06-04_
