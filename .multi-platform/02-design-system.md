# Design System — iPad View Size Increase

## Current State

### Base Scaling
- `html { zoom: 1.1 }` — 10% zoom applied globally
- `body { font-size: 15px }` — base body font (landscape/desktop)
- Portrait query: `body { font-size: 17px }` + larger account card typography

### Design Tokens (existing, no change)
- 4px base spacing grid (`--sp-1` through `--sp-10`)
- Typography scale: 10px → 32px+ via clamp()
- Radii: 4px → 28px via `--r-xs` → `--r-2xl`

## iPad-Specific Design Decisions

### Scaling Strategy
Use CSS `zoom` on `html` element for iPad, similar to the existing portrait approach.
iPad has 2× retina pixel density, but logical CSS pixels are already accounted for by the viewport meta.

**Target zoom levels:**
- iPad portrait (744px–1024px wide): `zoom: 1.25` (25% increase over base)
- iPad landscape (768px–1366px wide, touch): retain base zoom but increase font-size

Rationale: iPad users sit farther from the screen than phone users, and the screen real estate can accommodate larger elements. The 25% increase keeps the layout readable at arm's length.

### Typography Adjustments for iPad
| Element | Phone Portrait | iPad Target |
|---------|---------------|-------------|
| Body font-size | 17px | 18px |
| Account name | clamp(20px, 2.4vw, 24px) | clamp(22px, 2.8vw, 28px) |
| Account number | 14px | 15px |
| Growth badge | clamp(13px, 1.5vw, 16px) | clamp(14px, 1.7vw, 18px) |
| Balance strong | clamp(24px, 2.7vw, 32px) | clamp(26px, 3vw, 36px) |
| KPI label | 10px | 11px |
| KPI value | 13px | 14px |
| Timeframe pill | 10px | 11px |

### Touch Target Sizing
Apple HIG recommends 44×44pt minimum touch targets on iPad. With current `zoom: 1.1`, small chips may be 38–40pt. Increasing to 1.25 brings them into compliance.

## Implementation Approach
Add a new `@media` block targeting iPad:
```css
@media (hover: none) and (pointer: coarse) and (min-width: 744px) {
  html { zoom: 1.25; }
  /* + typography overrides */
}
```

Since portrait query is `@media (orientation: portrait)` and iPad portrait also triggers it, we override within the iPad block using combined selectors or specificity.
