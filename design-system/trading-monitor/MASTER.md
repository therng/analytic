# Design System — Trading Monitor

**Project:** Analytic Trading Monitor  
**Stack:** Next.js 16 + React 19, Tailwind-free (raw CSS custom properties)  
**Theme:** Dark OLED, optimized for iOS Safari mobile

---

## Typography

| Role | Font Stack | Variable |
|------|-----------|---------|
| Display / Headings | Manrope → Prompt → Segoe UI | `--font-display` |
| Body | -apple-system → Manrope → Segoe UI | `--font-body` |
| Monospace / Numbers | Azeret Mono → SFMono → ui-monospace | `--font-mono` |
| Thai body | Noto Sans Thai → Prompt | `--font-thai` |
| Thai bold | Mitr → Noto Sans Thai | `--font-thai-bold` |
| Thai alt / news | Bai Jamjuree → Noto Sans Thai | `--font-news` |

**Numeric values always use `--font-mono` with `font-variant-numeric: tabular-nums`.**

---

## Color Tokens

### Backgrounds

| Token | Value | Use |
|-------|-------|-----|
| `--bg-void` | `#000000` | True black (OLED) |
| `--bg-base` | `#03040a` | App background |
| `--bg-surface` | `#060810` | Default surface |
| `--bg-elevated` | `#0a0c16` | Elevated cards |
| `--bg-panel` | `#0e111c` | Panels, sheets |
| `--bg-hover` | `#121523` | Hover state |
| `--bg-active` | `#171b2a` | Active/pressed |

### Borders

| Token | Value |
|-------|-------|
| `--border-dim` | `rgba(255,255,255,0.04)` |
| `--border-subtle` | `rgba(255,255,255,0.08)` |
| `--border-mid` | `rgba(255,255,255,0.12)` |
| `--border-strong` | `rgba(255,255,255,0.18)` |

### Semantic

| Token | Value | Use |
|-------|-------|-----|
| `--positive` | `#3dd68c` | Profit, gain |
| `--positive-dim` | `rgba(61,214,140,0.12)` | Background tint |
| `--negative` | `#f04d4d` | Loss, drawdown |
| `--negative-dim` | `rgba(240,77,77,0.12)` | Background tint |
| `--warning` | `#f5a623` | Caution |
| `--neutral` | `#4da8f5` | Neutral metric |
| `--accent-400` | `#3b82f6` | Primary accent (blue) |
| `--accent-glow` | `rgba(59,130,246,0.15)` | Glow / halo |

### Text

| Token | Value |
|-------|-------|
| `--text-primary` | `#f0f2f5` |
| `--text-secondary` | `rgba(240,242,245,0.65)` |
| `--text-muted` | `rgba(240,242,245,0.38)` |
| `--text-ghost` | `rgba(240,242,245,0.20)` |

### Account Card (component-scoped)

| Token | Value |
|-------|-------|
| `--card-bg-top` | `#06091a` |
| `--card-bg-bot` | `#030610` |
| `--card-ink` | `#e8ecf2` |
| `--card-muted` | `rgba(232,236,242,0.60)` |
| `--card-dim` | `rgba(232,236,242,0.22)` |
| `--card-border` | `rgba(255,255,255,0.07)` |
| `--card-chip` | `rgba(255,255,255,0.04)` |
| `--card-chart` | `#3b82f6` |
| `--card-positive` | `#3dd68c` |
| `--card-negative` | `#f04d4d` |

---

## Spacing

| Token | Value |
|-------|-------|
| `--sp-1` | `4px` |
| `--sp-2` | `6px` |
| `--sp-3` | `8px` |
| `--sp-4` | `10px` |
| `--sp-5` | `12px` |
| `--sp-6` | `14px` |
| `--sp-7` | `16px` |
| `--sp-8` | `20px` |
| `--sp-9` | `24px` |
| `--sp-10` | `32px` |

---

## Border Radius

| Token | Value |
|-------|-------|
| `--r-xs` | `4px` |
| `--r-sm` | `8px` |
| `--r-md` | `12px` |
| `--r-lg` | `16px` |
| `--r-xl` | `22px` |
| `--r-2xl` | `28px` |
| `--r-pill` | `999px` |

---

## Motion

| Token | Value | Use |
|-------|-------|-----|
| `--t-instant` | `80ms ease-out` | Micro feedback |
| `--t-fast` | `120ms ease-out` | Button, chip |
| `--t-base` | `200ms ease-out` | Default |
| `--t-slow` | `300ms ease-out` | Panel, card |
| `--t-enter` | `240ms spring` | Entrance |
| `--t-exit` | `160ms ease-in` | Exit |
| `--ease-spring` | `cubic-bezier(0.16,1,0.3,1)` | Natural bounce |

**All animations use framer-motion variants from `src/lib/animations.ts` — never inline values.**

---

## Shadows

```css
--shadow-card:   0 1px 0 rgba(255,255,255,0.04) inset, ...
--shadow-float:  0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)
--glow-accent:   0 0 8px var(--accent-glow)
--glow-positive: 0 0 8px rgba(61,214,140,0.55)
```

---

## Mobile / PWA

- Safe area: `env(safe-area-inset-top)` via `--safe-top`, `--safe-bottom`
- All scrollable content is **full-bleed** (no padding cut by safe-area)
- Touch targets minimum **44×44px** (iOS HIG)
- `touch-action: manipulation` on all interactive elements
- `-webkit-tap-highlight-color: transparent` on buttons

---

## Anti-Patterns

- ❌ Tailwind color utilities (`green-500`, `red-400`) — use semantic tokens
- ❌ Inline hardcoded hex — reference CSS variables
- ❌ Emojis as icons — use SVG (Heroicons / Lucide)
- ❌ Missing `cursor: pointer` on clickable elements
- ❌ No `focus-visible` ring on interactive elements
- ❌ `transition: none` — always animate state changes
- ❌ `font-family` hardcoded — use `--font-*` tokens
- ❌ Light backgrounds — this is a dark-only UI

---

## Number Formatting Rules

- Full currency: `$1,234.57` (2 decimals, symbol, no space)
- Compact: `1.2K`, `3.4M` (no symbol, max 1 decimal, strip trailing `.0`)
- Zero/null → display `"-"` (never `"0"`)
- All numerics: `--font-mono` + `tabular-nums`
