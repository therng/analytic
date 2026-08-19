# Trading Analytics Review — account-list trades tie-break

- status: pass (after one targeted revision; see F1)
- date: 2026-08-19
- reviewer: trading-analytics-reviewer (read-only agent)
- reviewed scope: uncommitted working-tree diff vs `d3ac380` (`d3ac3805aa8b92dfca51c55006ac3178182497c5`), files: `CLAUDE.md`, `src/lib/trading/account-data.ts`, `src/lib/trading/account-data.test.ts`, `src/lib/trading/types.ts`, `src/components/trading-monitor/formatters.test.ts`
- change: account-list ordering tie-break chain gains `Trades 1D` (today's closed-position count) between `Pips 1D` and `balance desc`; new `getTodayTradeCount`, new required `SerializedAccount.today_trade_count`.

## Findings

### F1 — RESOLVED by revision: `getTodayTradeCount` formula/boundary had no asserting test coverage

- Original finding (first review round): new counting formula (`src/lib/trading/account-data.ts:285-311`) was executed but never asserted anywhere — the new sort test injected `today_trade_count` literals (comparator-only) and the `serializeAccountBundle` test asserted pips but not the count. Violated SKILL.md Validation "Tests cover the changed formula or boundary, not only rendering."
- Revision applied (test-only; production diff unchanged from first round):
  - `src/lib/trading/account-data.test.ts:222-238` — new boundary test "getTodayTradeCount counts only positions closed within the anchored report day window": exactly-at-start counted, exactly-at-end excluded, before-window excluded, null `closeTime` skipped, non-finite (`"not-a-date"`) skipped → asserts count 2. Mirrors the `getTodayNetPips` boundary test and pins the `[start, end)` semantics.
  - `src/lib/trading/account-data.test.ts:285-302` — `serializeAccountBundle` test extended with an out-of-window close (`2026-04-19T16:00Z`, pips 40) alongside the in-window one; asserts `serialized.today_trade_count === 1` and `today_net_pips` stays 18.5, proving window exclusion through the full serialization path for both sibling metrics.
- Re-verification (performed by reviewer, not taken from the coordinator's message): suite re-run 17/17 pass; `getTodayTradeCount` imported at test file top; `npx tsc --noEmit` still clean on all touched files.

## Verified clean (no action)

- Metric semantics: `Position` is the correct 1D trades authority — `src/lib/trading/metric-registry.ts:54-62` (`trades`: source `Position`, "Count scoped closed positions"), `AGENTS.md:163,168` ("timeframe-filtered closed `Position` rows only"), CLAUDE.md source boundaries. Deal counting would double-count entry/exit deals and mix funding operations.
- Window scoping: `getTodayTradeCount` mirrors `getTodayNetPips` exactly — same `getReportDayWindow(anchorDate)` (fixed UTC+7 Bangkok day, DST-free), same half-open `[startMs, endMs)` bounds, same `closeTime == null` and non-finite skips; both consume the single `anchorDate` computed once in `serializeAccountBundle` (`account-data.ts:488-490,526-527`) so pips and trades can never disagree on which day was scoped.
- Comparator: tie-break inserted between pips and balance, epsilon-guarded like siblings (`account-data.ts:149-152`; integer counts make the epsilon a harmless no-op); final chain growth → pips → trades → balance → accountNo matches the updated CLAUDE.md line.
- Serialization completeness: `serializeAccountBundle` is the only constructor and populates the field (`account-data.ts:527`); `applyTodayNetPips` spreads and preserves it; both test mocks updated. Consumers (`formatters.ts`, `DashboardClient.tsx`, `DashboardCard.tsx`, `LazyDashboardCard.tsx`, `DeferredDashboardCard.tsx`) are read-only; `/api/accounts` returns `getAccountListItems()` which both populates and sorts — additive field, no consumer misses it.
- List-path data sufficiency: positions fetched with `closeTime >= metricsSince` (7 days back) and `closeTime` selected (`account-data.ts:600-610`) — always covers the anchored today window for accounts within the 24h staleness filter.
- Doc accuracy: CLAUDE.md ordering line matches implementation; `AGENTS.md:128-130` defers ordering to CLAUDE.md, so no drift elsewhere.

## Checks performed

- Round 1: `node --import tsx --test src/lib/trading/account-data.test.ts` 16/16; `node --import tsx --test src/components/trading-monitor/formatters.test.ts` 4/4; `npm run lint` 0 errors (1 pre-existing warning in untouched `balance-curve-24h.test.ts`); `npx tsc --noEmit` clean on touched files.
- Round 2 (post-revision): `node --import tsx --test src/lib/trading/account-data.test.ts` 17/17; `npx tsc --noEmit` still clean on touched files (only pre-existing errors in untouched `src/worker-v2/reconstruct-position-adapter.test.ts`, ingestion domain).
- Source-boundary trace: metric-registry `trades` entry, AGENTS.md boundary table, comparator, serializer, API route.

## Missing evidence

- `npm run build` not run by the reviewer (diff is lib + test files only; tsc covers compile-level risk). Coordinator should keep it in the release baseline before push.
