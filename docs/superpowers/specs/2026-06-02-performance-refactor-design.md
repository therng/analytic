# Design Spec: Performance Refactoring & Code Cleanup (Hybrid Approach)

**Date:** 2026-06-02
**Status:** Approved

## Overview
Implement a "Hybrid Approach" to significantly improve dashboard load speeds, reduce data import times, and clean up the codebase. This involves consolidating trading logic, modularizing large files, and introducing incremental data processing and server-side downsampling.

## 1. Code Cleanup & Consolidation
### 1.1 Unified Core Library
Move all pure calculation functions from `analytics.ts` and `account-data.ts` into a new modular structure:
- `src/lib/trading/core/growth.ts`: Growth and gain calculations.
- `src/lib/trading/core/drawdown.ts`: Drawdown and risk metrics.
- `src/lib/trading/core/execution.ts`: Win rates, averages, and distribution.
- `src/lib/trading/core/position-logic.ts`: Position-specific logic (net PnL, pips).

### 1.2 Modularized Pre-aggregation
Split `src/lib/trading/preaggregated-cache.ts` (>1,300 lines) into:
- `src/lib/trading/cache/store.ts`: In-memory Map management and TTL logic.
- `src/lib/trading/cache/builders.ts`: Logic for constructing timeframe-specific views.
- `src/lib/trading/cache/probes.ts`: Version check and invalidation logic.

## 2. Performance Optimizations
### 2.1 Incremental Worker Updates
Modify the background worker (`src/worker/index.ts`) to avoid full re-computations:
- **Partial Re-computation:** Only re-calculate `AccountReportResult` for the period affected by new deals/positions.
- **Efficient Upserts:** Ensure `createMany` and `update` calls are as surgical as possible.

### 2.2 Server-Side Chart Downsampling
Instead of sending every trade to the frontend for balance curves:
- Implement the "LTTB" (Largest Triangle Three Buckets) or a simple interval-based downsampling algorithm on the server.
- Limit balance curve data to ~500 points per timeframe.

### 2.3 API & UI Enhancements
- **Lazy Loading:** Update the dashboard to load heavy sections (like deep historical trades) only when requested or when they enter the viewport.
- **Payload Reduction:** Strip unnecessary fields from API responses that aren't used by the UI components.

## 3. Implementation Plan Summary (Transition to `writing-plans`)
1. **Refactor Core Logic:** Extract and unit test the modular core library.
2. **Modularize Cache:** Split the cache file and verify API parity.
3. **Optimize Worker:** Implement incremental logic and measure sync time improvement.
4. **Implement Downsampling:** Add server-side point reduction for balance curves.
5. **UI Cleanup:** Optimize data fetching and lazy-load components.

## 4. Success Criteria
- Dashboard initial load (TTI) improved by >50% for large accounts.
- Worker sync time reduced for incremental updates.
- Codebase reduction in duplication (verified by grep/diff).
