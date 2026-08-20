# Dashboard Review — Phase 1 performance (client loading + tick responsiveness)

Status: **pass**

Scope: `src/components/trading-monitor/` (DashboardClient, MonitorShared, SummaryChip, card/DashboardCard, card/BalancePanel, BotPnLPanel, useApiResource), `src/hooks/useLiveData.ts`, `src/app/api/accounts/[id]/live/route.ts`, `src/lib/trading/preaggregated/positions.ts`, `src/app/globals.css`, `package.json`.

## Findings

1. **1400ms artificial loading gate removed** (`DashboardClient.tsx`) — content renders as soon as `/api/accounts` resolves; route-level `loading.tsx` candle state retained. No layout shift: skeletons unchanged.
2. **Memoization added** — `SparklineChart`/`TimeframeStrip`/`SummaryChip`/`BalancePanel` wrapped in `memo`; sparkline geometry (scales, projection, segment paths) moved into `useMemo`; `kpiItems`/`detailRows`/`mapLivePositions` memoized; DD sub-chips + KPI grid extracted into isolated memo boundaries (`KpiChipGrid`, `DdSubPanelChips`, `DetailChipsPanel`); inline `onHighlightBalanceChange` stabilized via `useCallback`. Live-equity dot intentionally recomputes on each poll (`liveEquityFallback` is a dep — documented in source).
3. **Positions page cap 250→1000** (`positions.ts` `MAX_POSITION_HISTORY_LIMIT`; `BotPnLPanel.tsx` `BOT_POSITION_PAGE_LIMIT`) — reduces serial cursor round trips ~4x for the BotPnL do/while loop. Cursor keyset semantics untouched; `timeframe=all` bypass unchanged. Contract tests updated to new cap.
4. **Live poll conditional requests** — `/api/accounts/[id]/live` now returns a SHA-1 `ETag` and `304` on `If-None-Match` match; `useLiveData` stores the ETag and skips parse/render on 304. Beacon semantics unchanged (data-equality path identical to prior raw-text compare).
5. **useApiResource stale-while-revalidate** — after first refresh, cached data renders instantly and revalidates in background; pull-to-refresh spinner accounting still resolves on network completion (`settleRequest` not short-circuited by stale serve).
6. **Bundle hygiene** — unused `@fontsource/sarabun` removed; unused `azeret-mono/300` weight import removed (no `font-weight: 300` anywhere in `src`); `playwright` moved to devDependencies (no runtime import in app code — only tests/driver use it).

## Checks performed

- `npm run lint` — 0 errors (1 pre-existing warning in untouched `balance-curve-24h.test.ts`)
- Focused tests: MonitorShared, DashboardCard, BotPnLPanel, formatters, touch-targets (portrait+landscape), page, redis-mt5.time, worker-v2/live-sync, preaggregated-cache, report-view-cache, trade-history — all pass (70 tests)
- `npx next build` — success; `npx tsc --noEmit` — no errors in touched files (pre-existing errors confined to untouched `reconstruct-position-adapter.test.ts`)
- Runtime smoke on production build: `/api/health` 200, `/api/accounts` 200 (5 accounts); Playwright driver portrait (`--click-first`, first card drill OK) and landscape — `state: "accounts"` both orientations
- KPI→panel mapping, timeframe scopes, source boundaries: unchanged (asserted by existing contract tests)

## Required action

None. User-visible changes: dashboard content appears immediately after data load (no 1400ms candle gate); unchanged visuals otherwise.
