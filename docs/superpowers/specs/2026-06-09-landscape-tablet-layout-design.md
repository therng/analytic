# Landscape & Tablet Layout Improvement — Design Spec

**Date:** 2026-06-09  
**Status:** Approved (all 4 sections)  
**Scope:** Responsive layout — mobile landscape overflow fix + dedicated tablet portrait/landscape layouts

---

## 1. Problem Statement

The current codebase uses a single `isLandscape` state and a single `600–1023px` breakpoint that covers both mobile landscape and tablet, causing:

- **Content overflow/clip** — `BotPnL` (170px fixed) and `Heatmap` (120px fixed) overflow the viewport on short-screen landscape devices (e.g. iPhone SE landscape at 568px height)
- **Wasted space on tablet** — iPad 768–1023px uses the same compact 2-col layout as a 667px phone; right panel is only 240–320px
- **No tablet-first layout** — tablet portrait (768×1024) has no dedicated treatment; it renders the same single-column mobile stack

---

## 2. Goals

1. Fix BotPnL and Heatmap overflow on mobile landscape
2. Deliver a dedicated tablet portrait layout: **2-column account overview grid** with tap-to-detail
3. Deliver a dedicated tablet landscape layout: **2-col, right panel 38%**, BotPnL+Heatmap side-by-side

**Not in scope:** Desktop layout changes, Mobile portrait changes, Gauges/Radar on tablet.

---

## 3. Architecture: 5-Tier Layout System

### Layout Tiers

| Tier | Breakpoint | Strategy |
|------|-----------|----------|
| Mobile Portrait | `< 600px` | Existing — no change |
| Mobile Landscape | `600–767px` | CSS-only overflow fixes |
| Tablet Portrait | `≥ 768px portrait` | New `TabletPortraitOverview` component |
| Tablet Landscape | `≥ 768px landscape, < 1024px` | New CSS class `account-card--tablet-landscape` |
| Desktop | `≥ 1024px` | Existing — no change |

### State Derivation — Single Source

Replace the existing independent `isLandscape` state with a **single-source** `layoutTier` derivation to prevent race conditions on iOS orientation change:

```tsx
type LayoutTier =
  | "mobile-portrait"
  | "mobile-landscape"
  | "tablet-portrait"
  | "tablet-landscape"
  | "desktop";

function deriveLayoutTier(): LayoutTier {
  const w = window.innerWidth;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  if (w >= 1024) return "desktop";
  if (w >= 768 && portrait)  return "tablet-portrait";
  if (w >= 768 && !portrait) return "tablet-landscape";
  if (w >= 600) return "mobile-landscape";
  return "mobile-portrait";
}
```

The hook listens to both `resize` and `orientationchange` events and calls `deriveLayoutTier()` once per event — mutually exclusive by construction.

### Rendering Priority (explicit, documented)

```
isTabletPortrait  → <TabletPortraitOverview>   (replaces entire account list)
     ↓
isDesktop         → account-card--desktop
     ↓
isTabletLandscape → account-card--tablet-landscape
     ↓
isMobileLandscape → account-card--landscape     (overflow-fixed)
     ↓
default           → mobile portrait stack
```

### Breakpoint Boundary Validation

Transitions to validate during implementation:
- `599 → 600` — portrait mobile → mobile landscape
- `767 → 768` — mobile landscape → tablet (portrait/landscape splits here)
- `1023 → 1024` — tablet landscape → desktop

No double-renders or flickering should occur at these points.

---

## 4. Section 2 — Mobile Landscape Overflow Fix (600–767px)

**CSS class:** `account-card--landscape` (existing, modified)  
**Approach:** CSS-only, no JSX changes

### Root Causes

| Issue | Current value | Fix |
|-------|--------------|-----|
| BotPnL height | `170px` fixed | `clamp(80px, 18vh, 140px)` fluid |
| Heatmap height | `120px` fixed | `clamp(60px, 14vh, 110px)` fluid |
| Right panel width | `clamp(240px, 34%, 320px)` | `clamp(180px, 36%, 260px)` |

### Grid Token Changes

```css
@media (min-width: 600px) and (max-width: 767px) {
  .dashboard-section > .account-card.account-card--landscape {
    --dc-chart-h:   clamp(90px, 18vh, 130px);
    --dc-botpnl-h:  clamp(80px, 18vh, 140px);   /* was 170px fixed */
    --dc-heatmap-h: clamp(60px, 14vh, 110px);   /* was 120px fixed */

    grid-template-columns: 1fr clamp(180px, 36%, 260px); /* was clamp(240px,34%,320px) */
    grid-template-rows: minmax(0, 1fr)
                        clamp(80px, 18vh, 140px)
                        clamp(60px, 14vh, 110px);
  }
}

/* Very short screens (e.g. iPhone SE landscape 568px) — merge BotPnL+Heatmap into one row */
@media (min-width: 600px) and (max-width: 767px) and (max-height: 500px) {
  .dashboard-section > .account-card.account-card--landscape {
    grid-template-areas: "middle right" "lower right";
    /* dc-botpnl and dc-heatmap stack inside .dc-lower row */
  }
}
```

---

## 5. Section 3 — Tablet Landscape (768–1023px landscape)

**CSS class:** `account-card--tablet-landscape` (new)  
**Approach:** CSS-only, new class — does not touch `account-card--landscape`

### Layout

```
┌─────────────────────────────┬──────────────────┐
│  MAIN (62%)                 │  RIGHT (38%)     │
│  Header                     │                  │
│  Chart (100–150px)          │  Positions /     │
│  KPI chips (5-col)          │  History /       │
│  BotPnL  │  Heatmap         │  EcoCalendar     │
│  (side-by-side, fluid)      │  (~290–388px)    │
└─────────────────────────────┴──────────────────┘
```

### CSS Tokens

```css
@media (min-width: 768px) and (max-width: 1023px) and (orientation: landscape) {
  .dashboard-section > .account-card.account-card--tablet-landscape {
    --dc-pad-x:     clamp(8px, 1vw, 12px);
    --dc-pad-y:     clamp(8px, 1vh, 12px);
    --dc-gap:       clamp(5px, 0.7vw, 9px);
    --dc-chart-h:   clamp(100px, 20vh, 150px);
    --dc-botpnl-h:  clamp(90px, 16vh, 140px);
    --dc-heatmap-h: clamp(70px, 13vh, 120px);

    display: grid !important;
    height: calc(100dvh - 16px);
    grid-template-columns: 1fr 38%;
    grid-template-rows: minmax(0, 1fr)
                        var(--dc-botpnl-h)
                        var(--dc-heatmap-h);
    grid-template-areas:
      "middle right"
      "botpnl right"
      "heatmap right";
  }

  .account-card--tablet-landscape .kgrid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
```

### Differences vs Mobile Landscape

| Token | Mobile Landscape | Tablet Landscape |
|-------|-----------------|-----------------|
| Right panel | 36% (~215–276px) | 38% (~290–388px) |
| Chart height | 90–130px | 100–150px |
| BotPnL height | 80–140px | 90–140px |
| BotPnL+Heatmap layout | side-by-side when height < 500px | always separate rows |

---

## 6. Section 4 — Tablet Portrait Overview (≥ 768px portrait)

**New component:** `src/components/trading-monitor/TabletPortraitOverview.tsx`  
**Approach:** New component mounted at root level in DashboardClient; replaces account list entirely when `layoutTier === "tablet-portrait"`

### Component Structure

```tsx
// TabletPortraitOverview.tsx
export function TabletPortraitOverview({ accounts, refreshKey }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (expandedId) {
    return (
      <TabletAccountDetail
        accountId={expandedId}
        onBack={() => setExpandedId(null)}
      />
    );
  }

  return (
    <TabletPortraitGrid
      accounts={accounts}
      onSelect={setExpandedId}
    />
  );
}
```

### Grid View — `TabletPortraitGrid`

**Layout:** CSS grid `grid-template-columns: 1fr 1fr`, gap 12px, scrollable vertically

**Each card shows:**
- Account name + live beacon dot (from `useRealtimeAccount`)
- Mini sparkline chart (32px height, reuses `SparklineChart`)
- Balance
- 3 KPI chips: growth%, pips, trades
- Tone-colored border (green / red / neutral from `toneFromNumber`)

**Data:** Uses `AccountOverviewResponse` only — no profit-detail or pips-summary fetched until tap

### Detail View — `TabletAccountDetail`

```tsx
function TabletAccountDetail({ accountId, onBack }) {
  return (
    <div className="tablet-detail-view">
      <BackBar onBack={onBack} />
      {/* forcePortrait prop overrides layoutTier — renders mobile portrait layout */}
      <AccountCard account={...} forcePortrait />
    </div>
  );
}
```

- `forcePortrait` prop added to `AccountCard` — bypasses `layoutTier`, always renders portrait stack
- Data fetch (profit-detail, pips-summary) starts on tap — same lazy pattern as existing portrait mobile
- Back navigation: `setExpandedId(null)` — no router push, preserves grid scroll position

### Transition Animation (framer-motion)

```tsx
// Grid → Detail: slide from right (iOS navigation feel)
<AnimatePresence>
  <motion.div
    key={expandedId ?? "grid"}
    initial={{ x: "100%", opacity: 0 }}
    animate={{ x: 0, opacity: 1 }}
    exit={{ x: "100%", opacity: 0 }}
    transition={{ duration: 0.22, ease: "easeOut" }}
  >
```

---

## 7. Files Changed

| File | Change |
|------|--------|
| `src/components/trading-monitor/DashboardClient.tsx` | Replace `isLandscape` state with `layoutTier` via `deriveLayoutTier()`; add `TabletPortraitOverview` render branch; pass `forcePortrait` support |
| `src/app/globals.css` | Split `600–1023px` block into 3 new blocks; add `account-card--tablet-landscape` class; fix overflow tokens |
| `src/components/trading-monitor/TabletPortraitOverview.tsx` | New file — `TabletPortraitOverview`, `TabletPortraitGrid`, `TabletAccountDetail` |

---

## 8. Testing Checklist

- [ ] iPhone SE landscape (375×667, 568px tall) — BotPnL+Heatmap ไม่ล้น
- [ ] iPhone 14 Pro landscape (844×390) — layout ถูกต้อง, right panel กว้างพอ
- [ ] iPad Mini landscape (1024×768) — `tablet-landscape` class ทำงาน, right panel 38%
- [ ] iPad portrait (768×1024) — grid overview แสดง, tap ไป detail, back กลับ grid
- [ ] Orientation change: portrait → landscape บน iPad — layout สลับไม่ flicker
- [ ] Desktop (1440px) — ไม่กระทบ
- [ ] `npm run build` ผ่าน, `npm run lint` ผ่าน
