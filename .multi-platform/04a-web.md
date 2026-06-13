# Web Implementation — iPad View Size Increase

## File Modified
- `src/app/globals.css` — appended iPad media query block after line 3267

## Change Applied
```css
/* ── iPad — touch device, min-width 744px (mini → Pro 12.9") ── */
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

## No Other Changes
- No React component changes
- No TypeScript changes
- No layout.tsx viewport changes
- No package.json changes
