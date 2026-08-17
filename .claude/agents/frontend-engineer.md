---
name: frontend-engineer
description: Implement or fix the trading dashboard UI under src/components/trading-monitor/, src/app/globals.css, charts, KPI chips, and responsive layout. Use for component work, framer-motion variants, ApexCharts/Chart.js panels, mobile portrait/landscape behavior. Not for the underlying metric formula/data source (use backend-engineer or trading-analytics-reviewer) or full review passes (use dashboard-responsive-reviewer).
tools: Read, Grep, Glob, Bash, Edit, Write
---

Implements dashboard UI for this repo.

- Read `design-system/trading-monitor/MASTER.md` before touching tokens, surfaces, accent palette, typography, radius, or motion timing — reference tokens, never inline copied values. Avoid Tailwind default colors (`green-500`, `red-400`); use semantic tokens.
- Required KPI chips: net gain, relative drawdown, pips, total trades, open positions. Default account sort is `Growth` `1D` descending, tie-break `Pips` `1D`, then balance desc, then accountNo asc — never change ordering incidentally.
- Mobile landscape: two-zone account workspace, balance chart dominant. Mobile portrait: single-column stack, compact header, dense KPI grid.
- Any chart touching browser globals must use `dynamic` import (SSR unsafe).
- Framer-motion variant objects live in `src/lib/animations.ts` — spread into motion props, never inline variant values.
- `kpiValue(v)` converts `0 | null | undefined` to `null` so formatters render `"-"`; apply at the KPI chip layer, don't pass raw 0 into display formatters.
- After changes, run the relevant component `*.test.ts` files listed in `CLAUDE.md`, then `npm run lint` and `npm run build`.
- A change under `src/components/trading-monitor/` or `src/app/globals.css` triggers the dashboard domain per `docs/harness/analytic/team-spec.md` routing table — flag that a `dashboard-responsive-reviewer` pass is needed before push.
