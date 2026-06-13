# Shared Architecture — iPad View Size Increase

## Architecture Summary

This is a **pure CSS change** — no JS, no React components, no state management.

### File to Modify
- `src/app/globals.css` — single source of truth for all responsive/platform CSS

### Change Location
Append a new `@media` block at the end of `globals.css` (after the existing portrait query at line ~3251).

### Media Query Design
```css
/* ── iPad — touch device, min 744px (all iPad models) ── */
@media (hover: none) and (pointer: coarse) and (min-width: 744px) {
  html { zoom: 1.25; }

  body { font-size: 18px; }

  /* Account card header */
  .dashboard-section > .account-card .sp-name        { font-size: clamp(22px, 2.8vw, 28px); }
  .dashboard-section > .account-card .sp-account     { font-size: 15px; }
  .dashboard-section > .account-card .sp-growth      { font-size: clamp(14px, 1.7vw, 18px); }
  .dashboard-section > .account-card .sp-balance strong { font-size: clamp(26px, 3vw, 36px); }

  /* KPI chips */
  .dashboard-section > .account-card .kgrid .kl,
  .dashboard-section > .account-card .kpi-detail-grid .kl { font-size: 11px; }
  .dashboard-section > .account-card .kv                  { font-size: 14px; }

  /* Timeframe strip */
  .dashboard-section > .account-card .timeframe-pill { font-size: 11px; }
}
```

### Why This Approach Works
1. `hover: none` → no desktop mouse (iPads in desktop Safari mode still report pointer: coarse)
2. `pointer: coarse` → touch input device
3. `min-width: 744px` → minimum iPad mini width, excludes phones (≤430px)
4. CSS `zoom` scales the entire layout proportionally, matching the existing phone pattern
5. Font overrides supplement zoom for elements that use px values

### No Component Changes Required
The existing React components use Tailwind + CSS classes already defined in globals.css. The new media query hooks into the same class names. Zero JSX changes.

### Cascade Order
The new iPad block must come AFTER the portrait block to properly override portrait-only rules on iPad portrait orientation.
