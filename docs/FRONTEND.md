# Frontend — เอกสารสรุป

> อัปเดต: 2026-06-20

## ภาพรวม

Frontend เป็น Next.js 16 App Router + React 19 ออกแบบเพื่อ mobile-first บน iOS Safari portrait/landscape เป็นหลัก ไม่ใช่ marketing site — เป็น operational dashboard ที่ต้องตอบสนองเร็วและอ่านค่าได้ทันที

---

## 1. โครงสร้าง Pages

```
src/app/
├── layout.tsx           ← root layout: fonts, providers, PWA meta
├── loading.tsx          ← Suspense loading fallback
├── page.tsx             ← / → render <DashboardClient />
├── patterns/page.tsx    ← /patterns → candlestick pattern visualizer
├── stats/page.tsx       ← /stats → สถิติรวม
└── globals.css          ← CSS ทั้งหมด (2,950 บรรทัด)
```

---

## 2. Component Tree (Dashboard หลัก)

```
DashboardClient                      ← pull-to-refresh, account list fetch
└── LazyDashboardCard[]              ← intersection observer (lazy load เมื่อ scroll)
    └── DeferredDashboardCard        ← deferred render สำหรับ off-screen cards
        └── DashboardCard            ← account card หลัก (memo)
            ├── TimeframeStrip       ← tab 1D / 1W / 1M / 3M / 6M / 1Y / ALL
            ├── SparklineChart       ← SVG balance curve พร้อม hover tooltip
            ├── SummaryChip × 5      ← KPI chips (GAIN / DD / PIPS / TRADES / OPENS)
            ├── AnimatePresence      ← panel switching
            │   ├── PipsPerformanceTable + ProfitHeatmapPanel  (PIPS expanded)
            │   ├── TradeHistoryPanel                          (TRADES expanded)
            │   ├── OpenPositionsPanel                         (OPENS expanded)
            │   └── DD sub-panels (4 ตัว):
            │       ├── BotPnLPanel         (DD default)
            │       ├── PerformanceRadar    (ABS — Sharpe radar)
            │       ├── PerformanceQualityPanel (MAX — gauges)
            │       └── PerformanceBars + BotPnLPanel (LOAD)
            │       └── PiePanel            (EXPECT — symbol distribution)
            └── TradingViewAnalysisModal    ← overlay จาก OpenPositionsPanel
```

---

## 3. Data Fetching Pattern

### `useApiResource<T>` (src/components/trading-monitor/useApiResource.ts)

Hook กลางสำหรับ fetch API ทั้ง dashboard ทำงานแบบ:
- **refreshKey** — เมื่อ key เปลี่ยน จะ refetch ทั้งหมด (pull-to-refresh)
- **onRequestStateChange** — callback รายงาน loading state ขึ้น parent สำหรับ spinner

```ts
const overview = useApiResource<AccountOverviewResponse>(
  `/api/accounts/${account.id}/overview?timeframe=${timeframe}`,
  { refreshKey, onRequestStateChange }
);
// overview.data, overview.loading, overview.error
```

### API calls ต่อ DashboardCard (parallel fetch)
| Hook variable | Endpoint | เมื่อไหร่ |
|---------------|----------|-----------|
| `overview` | `/overview?timeframe=X` | ทุกครั้งที่ timeframe เปลี่ยน |
| `balanceDetail` | `/balance?timeframe=X` | ทุกครั้งที่ timeframe เปลี่ยน |
| `pipsDetail` | `/pips?timeframe=X` | ทุกครั้งที่ timeframe เปลี่ยน |
| `positionsDetail` | `/positions?timeframe=all` | คงที่ (all time) |

---

## 4. Animation System

ทุก animation อยู่ที่ **`src/lib/animations.ts`** เท่านั้น ห้ามเขียน variants inline ใน components

### หลักการ "Fast-and-Recede"
- Enter: decisive, brief
- Exit: fast fade, ไม่มี drama
- Spring: reserved สำหรับ tap feedback และ live signals เท่านั้น

### Variant สำคัญ

| Export | ใช้ที่ไหน | พฤติกรรม |
|--------|-----------|----------|
| `panelOverlay` | DashboardCard `sp-overlay-panel` | fade + y:6 → 0 (200ms) |
| `kpiDetailPanel` | DashboardCard `kpi-detail-panel` | slide-down y:-4 → 0 (180ms) |
| `expandRow` | OpenPositionsPanel, TradeHistoryPanel | height: 0 → auto |
| `backdrop` | ShoutModal, KpiPreviewCard | fade 140ms |
| `bottomSheet` | ShoutModal | spring slide-up (native-app feel) |
| `kpiCardVariants(reduceMotion)` | SummaryChip KpiPreviewCard | scale+fade, หรือ fade เมื่อ reduced |
| `tableRowMotion(index)` | PipsPerformanceTable | stagger delay 30ms ต่อ row |
| `tapChip` | SummaryChip | spring scale 0.94 |
| `tapPill` | TimeframeStrip | spring scale 0.86 |
| `tapRow` | trade rows | scale 0.99 |
| `heatmapCell` | ProfitHeatmapPanel | scale 1.18 hover, 0.88 tap |

### CSS Motion Tokens
```css
--t-instant: 80ms  cubic-bezier(0.2,0,0,1)
--t-fast:   120ms  cubic-bezier(0.2,0,0,1)
--t-base:   200ms  cubic-bezier(0.2,0,0,1)
--t-slow:   300ms  cubic-bezier(0.2,0,0,1)
--t-enter:  240ms  cubic-bezier(0.16,1,0.3,1)   ← ease-out-quint
--t-exit:   160ms  cubic-bezier(0.4,0,1,1)
```

---

## 5. Design Tokens (CSS Custom Properties)

ทั้งหมดใน `:root` ของ `globals.css` — อย่า hardcode ค่าสี

### Colors
```css
/* Background layers */
--bg-void     #000000
--bg-base     #03040a    ← main background
--bg-surface  #060810
--bg-elevated #0a0c16
--bg-panel    #0e111c
--bg-hover    #121523
--bg-active   #171b2a

/* Semantic */
--positive    #3dd68c   ← กำไร / ดี
--negative    #f04d4d   ← ขาดทุน / แย่
--warning     #f5a623
--neutral     #4da8f5
--accent-400  #3b82f6   ← blue accent

/* Text */
--text-primary    #f0f2f5
--text-secondary  rgba(240,242,245,0.65)
--text-muted      rgba(240,242,245,0.38)
--text-ghost      rgba(240,242,245,0.20)
```

### Typography
```css
--font-display:  Manrope (headers)
--font-body:     system → Manrope
--font-mono:     Azeret Mono (numbers, code)
--font-thai:     Noto Sans Thai (Thai body)
--font-thai-bold: Mitr
--font-thai-alt:  Prompt
--font-news:     Bai Jamjuree (numeric tables)
```

### Spacing (sp-scale)
```css
--sp-1: 4px  --sp-2: 6px  --sp-3: 8px   --sp-4: 10px
--sp-5: 12px --sp-6: 14px --sp-7: 16px  --sp-8: 20px
--sp-9: 24px --sp-10: 32px
```

### Border Radius
```css
--r-xs: 4px  --r-sm: 8px  --r-md: 12px  --r-lg: 16px
--r-xl: 22px --r-2xl: 28px --r-pill: 999px
```

---

## 6. Tone System (MetricTone)

```ts
type MetricTone = "positive" | "negative" | "warning" | "neutral" | "muted" | "info"
```

| Tone | ใช้เมื่อ | CSS class |
|------|---------|-----------|
| `positive` | กำไร, growth > 0 | `.tone-positive` → `var(--positive)` |
| `negative` | ขาดทุน, drawdown สูง | `.tone-negative` → `var(--negative)` |
| `warning` | ระวัง | `.tone-warning` → `var(--warning)` |
| `neutral` | ข้อมูลทั่วไป | `.tone-neutral` → `var(--neutral)` |
| `muted` | ไม่มีข้อมูล / inactive | `.tone-muted` → `var(--text-muted)` |
| `info` | open positions | `.tone-info` |

Tone helper functions:
- `toneFromNumber(value)` — positive/negative/neutral จากค่า
- `drawdownTone(pct)` — neutral / warning / negative ตาม drawdown %
- `absDrawdownTone(pct)` — เหมือน drawdown แต่ threshold ต่างกัน

---

## 7. Number Formatting (formatters.ts)

```ts
// Full currency: symbol + 2 decimals
formatCurrency(1234.57)          // "$1,234.57"
formatSignedCurrency(-500)       // "-$500.00"

// Compact: K/M/B, max 1 decimal, strip .0
formatCompactSignedNumber(1500)  // "+1.5K"
formatCompactSignedNumber(-2e6)  // "-2M"

// Percent
formatPercent(12.5, 1)           // "12.5%"
formatCompactPercent(12.5)       // "12.5%"

// Count
formatCompactCount(1234)         // "1.2K"

// Plain numbers
formatPlainNumberValue(3.14159, 2) // "3.14"
```

**กฎ:**
- ห้าม mix compact และ full currency ใน surface เดียวกัน
- Round only at presentation layer — ข้อมูลใน DB ใช้ `Decimal` precision เต็ม

---

## 8. CSS Class Naming Convention

### Account Card (BEM-like)
```
.account-card               ← card container
.account-card--active       ← มี live beacon
.account-card--inactive     ← dimmed

.sp-wrap                    ← card inner wrapper
.sp-header                  ← growth + balance header
.sp-top / .sp-top--compact  ← identity + side row
.sp-identity                ← name + account number
.sp-name                    ← account display name
.sp-account                 ← account number + status dot
.sp-account-status          ← status indicator (is-active / is-inactive)
.sp-side                    ← right: growth % + balance
.sp-growth                  ← growth value (tone-X modifier)
.sp-balance                 ← balance value

.sp-canvas-stack            ← chart + overlay panel container
.sp-canvas-stack--pips      ← taller สำหรับ pips panel
.sp-canvas-stack--dd        ← taller สำหรับ dd panel
.sp-canvas                  ← sparkline chart area
.sp-overlay-panel           ← panel ที่ overlay ทับ chart
.sp-overlay-panel--pips     ← pips-specific height

.tf-row                     ← timeframe strip row
.timeframe-strip            ← tab container
.timeframe-pill             ← individual tab
.timeframe-pill.is-active   ← selected tab

.kpi-stack                  ← KPI chips section
.kgrid                      ← 5-column chip grid
.kchip                      ← individual chip
.kchip.is-actionable        ← clickable chip
.kchip.is-selected          ← active/expanded chip
.kchip.is-static            ← non-interactive
.kchip.has-hint             ← has tooltip

.kpi-detail-panel           ← expand panel below chips
.kpi-detail-grid            ← grid ใน detail panel
.kpi-detail-item            ← individual detail chip
```

### Section States
```
.section-state.is-error     ← error message
.section-state.is-empty     ← empty state
.section-state.is-info      ← info state
.skeleton-chart             ← loading skeleton
```

---

## 9. Responsive + PWA

### Media Queries
| Query | ใช้สำหรับ |
|-------|-----------|
| `@media (hover: none) and (pointer: coarse)` | touch device (iOS Safari) |
| `@media (orientation: portrait)` | portrait layout adjustments |
| `@media (hover: none) and (pointer: coarse) and (min-width: 744px)` | iPad landscape |
| `@media (max-width: 700px)` | compact breakpoint |
| `@media (prefers-reduced-motion: reduce)` | ปิด animation |

### PWA
- Standalone mode: `env(safe-area-inset-top)` สำหรับ status bar
- Scroll content เป็น full-bleed intentionally
- Pull-to-refresh: custom implementation ใน DashboardClient (ไม่ใช้ browser default)
  - Threshold: 72px pull, resistance: `Math.pow(delta, 0.82) * 2.2`

---

## 10. Chart Libraries

### ApexCharts (primary)
- ใช้กับ: PerformanceRadar (7-axis), balance charts
- **ต้อง `dynamic` import** — SSR unsafe
- Config ผ่าน `@/lib/animations.ts` ไม่ใช่ inline

### SparklineChart (custom SVG)
- อยู่ใน `shared.tsx`
- เขียนด้วย raw SVG ไม่ใช่ library
- มี live beacon animation (heartbeat ring)
- Hover tooltip แสดง date/time/balance

### Chart.js (`react-chartjs-2`)
- Secondary charts (บางส่วนของ PerformanceQualityPanel)

---

## 11. Social Layer Components

| Component | คำอธิบาย |
|-----------|-----------|
| `ShoutTicker` | scrolling ticker bar ด้านบน dashboard |
| `ShoutModal` | bottom sheet (spring animation) สำหรับ compose/view shouts |
| `EmojiReactionBar` | emoji picker + reaction counter |
| `UsernameSetup` | modal setup username ครั้งแรก (OAuth) |

**Hooks:**
- `useShouts` — SSE subscription (`/api/social/shouts/stream`)
- `useReactions` — optimistic update reactions
- `useSocialSession` — ดึง username + session state

---

## 12. Patterns Page (`/patterns`)

| Component | คำอธิบาย |
|-----------|-----------|
| `PatternCanvas` | canvas renderer สำหรับ candlestick patterns |
| `PatternCard` | card wrapper ของแต่ละ pattern |
| `Candle` | single candle (body + wick) |
| `TrendTrace` | trend line overlay |

Pattern definitions: `src/lib/patterns/bullish.ts`, `bearish.ts`

---

## 13. Required KPI Chips

Dashboard card ต้องมี 5 chips เสมอ:

| Chip | ข้อมูล | Source |
|------|--------|--------|
| **GAIN** | net profit (compact signed) | `overview.kpis.netProfit` |
| **DD** | relative drawdown % | `overview.kpis.drawdown` |
| **PIPS** | net pips (compact signed) | `overview.kpis.netPips` |
| **TRADES** | closed trade count | `overview.kpis.trades` |
| **OPENS** | open position count | `positionsDetail.openPositions.length` |

---

## 14. Live Signal (Real-time)

`useRealtimeAccount` hook เชื่อมต่อ WebSocket กับ Gateway:
- แสดง live equity beacon (ring + heartbeat blink) บน SparklineChart
- อัปเดต equity/floating P/L แบบ real-time โดยไม่ต้อง refetch
- Beacon ปรากฏเฉพาะเมื่อ account status = Active

---

## 15. Performance Patterns

- **Lazy loading:** LazyDashboardCard ใช้ IntersectionObserver — cards ที่อยู่นอก viewport ไม่ render
- **Deferred:** DeferredDashboardCard — render skeleton ก่อน แล้วค่อย hydrate
- **memo:** DashboardCard ห่อด้วย `React.memo` เพื่อ prevent re-render จาก parent
- **startTransition:** timeframe change ใช้ `startTransition` เพื่อไม่ block UI
- **Loading animation:** force 2.2s initial animation loop ก่อนแสดง content (`setInitialAnimationDone`)
