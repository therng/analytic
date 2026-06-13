# API Contracts — iPad View Size Increase

## Feature Summary
Increase UI element sizes on iPad viewport for better readability and touch ergonomics on larger screens.

## API Impact
**None.** This feature is a pure CSS/presentation-layer change with zero API surface changes.

- No new endpoints required
- No schema changes
- No WebSocket event changes
- No authentication changes

## Platform
- **Web only** (Next.js PWA, served via Caddy at `therng.duckdns.org`)
- iPad renders in Safari iOS (portrait and landscape orientations)

## Viewport Context
Current `layout.tsx` viewport metadata:
```ts
width: "device-width",
initialScale: 1,
maximumScale: 5,
minimumScale: 1,
userScalable: true,
viewportFit: "cover"
```

Current `html` element has `zoom: 1.1` (10% base zoom for all touch devices).
Portrait media query adds `font-size: 17px` on `body` and larger account card typography.

## Target iPad Breakpoints
- iPad mini (6th gen): 744px × 1133px portrait / 1133px × 744px landscape
- iPad (10th gen) / iPad Air: 820px × 1180px portrait / 1180px × 820px landscape  
- iPad Pro 11": 834px × 1194px portrait / 1194px × 834px landscape
- iPad Pro 12.9": 1024px × 1366px portrait / 1366px × 1024px landscape

## Detection Strategy
iPad cannot be reliably detected by user-agent in modern iPads (iPadOS 13+ reports as desktop Safari).
Use CSS media query combining:
- `(hover: none) and (pointer: coarse)` — touch device
- `(min-width: 744px)` — minimum iPad width

This excludes typical phone widths (≤430px) and desktop mice (hover: hover).
