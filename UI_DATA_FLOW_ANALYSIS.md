# UI Data Flow Audit Report

This report details the current data flow of the dashboard UI, maps UI components to their data sources, and identifies deviations from the target architecture as of July 8, 2026.

## 1. Target Architecture

The single source of truth is the production runtime path:
**MT5 API → Python Bridge → Redis (live hashes + streams) → Worker → PostgreSQL (via Prisma) → API → Dashboard UI**

- **Live Data:** Sourced from Redis live hashes and heartbeats.
- **Analytics Data:** Sourced from PostgreSQL.
- **Legacy Paths (Invalid):** FTP statement pipeline, HTML statement files, and local conversion scripts are deprecated.

## 2. UI Data Flow Mapping

| UI Section                  | Component / File              | Endpoint/Hook                                                                           | Current Source                                                                   | Correct Source                          | Issue / Risk                                                                                     | Recommended Fix                                                                                                                                                          |
| :-------------------------- | :---------------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :-------------------------------------- | :----------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account Status Dot**      | `DashboardCard.tsx`           | `account.status`, `hasLiveBridgeConnection` props                                       | **Mixed**: PostgreSQL (for `status`) + **Redis** (for `hasLiveBridgeConnection`) | Redis heartbeat                         | **Stale DB Status**: The `status` field relies on `lastUpdated` from the DB, which can be stale. | Use only the Redis heartbeat (`terminalConnected` from `Mt5LiveInfo`) to determine live status. Remove the dependency on `account.status` from PostgreSQL.               |
| **Account Overview Cards**  | `DashboardCard.tsx`           | `/api/accounts/[id]/overview`                                                           | PostgreSQL                                                                       | PostgreSQL                              | ✅ Correct                                                                                       | None.                                                                                                                                                                    |
| **Open Positions Table**    | `OpenPositionsPanel.tsx`      | `useLiveData` hook -> `/api/accounts/[id]/live`                                         | **Redis**                                                                        | Redis                                   | ✅ Correct                                                                                       | None.                                                                                                                                                                    |
| **Closed Trades Table**     | `TradeHistoryPanel.tsx`       | `/api/accounts/[id]/positions`                                                          | PostgreSQL                                                                       | PostgreSQL                              | ✅ Correct                                                                                       | None.                                                                                                                                                                    |
| **MAE / MFE Display**       | _N/A_                         | _N/A_                                                                                   | _N/A_                                                                            | `PositionState` / `ClosedPosition`      | **Missing Feature**: MAE/MFE data is processed by the backend but not displayed in the UI.       | Create a new UI component to display MAE/MFE data for closed trades, fetching from the `ClosedPosition` table.                                                           |
| **Equity/Drawdown Display** | `DrawdownEquityPanel.tsx`     | `useLiveData` hook (for live values), `/api/accounts/[id]/balance-detail` (for history) | **Mixed**: Redis (live) + PostgreSQL (historical `BalanceHistory`)               | `EquityState` or sampled equity history | ✅ Correct                                                                                       | The use of mixed sources is appropriate here: live data for the current value and historical data for the chart.                                                         |
| **Profit Heat Map**         | `ProfitHeatmapPanel.tsx`      | `/api/accounts/[id]/profit-detail` (Assumed)                                            | PostgreSQL                                                                       | Aggregated `ClosedPosition`             | ✅ Correct                                                                                       | None.                                                                                                                                                                    |
| **Yearly/Monthly Perf.**    | `PerformanceBars.tsx`         | `/api/accounts/[id]/overview` (Assumed)                                                 | PostgreSQL                                                                       | Aggregated `ClosedPosition`             | ✅ Correct                                                                                       | None.                                                                                                                                                                    |
| **Symbol/Strategy Perf.**   | Part of `DashboardClient.tsx` | `/api/accounts/[id]?groupBy=...`                                                        | PostgreSQL (Live Aggregation)                                                    | Pre-aggregated table                    | **Performance Risk**: Fetches all `ClosedPosition` records on every request.                     | The worker should pre-aggregate this data into a summary table. The API should query that table instead.                                                                 |
| **Bridge/Debug Status**     | _Not Found_                   | _Not Found_                                                                             | _Not Found_                                                                      | Redis keys + streams                    | **Missing Feature/Info**: Could not locate a specific bridge/debug status page in the codebase.  | Clarify if this page exists or needs to be created. If so, it should fetch data directly from Redis admin commands (`KEYS`, `XINFO`, etc.) via a dedicated API endpoint. |

## 3. Audit Flags

- [x] **Stale DB status usage**: The "Account Status Dot" uses a status derived from the database's `updatedAt` field, which can be stale.
- [ ] **Redis heartbeat ignored**: The heartbeat is partially used (`hasLiveBridgeConnection`), but it's not the single source of truth for the status dot.
- [x] **Frontend fetching all history**: The `groupBy` endpoint for Symbol/Strategy performance fetches all `ClosedPosition` records.
- [ ] **Duplicate fetching**: No significant duplicate fetching was observed. The UI seems to correctly partition live and analytics requests.
- [ ] **Browser-side heavy analytics**: No significant browser-side analytics were found. The heavy lifting is done in the API routes (which is still an issue, but not in the browser).
- [ ] **Legacy FTP/statement dependencies**: **None found.** The UI data flow appears to be clean of legacy paths.

## 4. Summary & Implementation Order

The dashboard is in a good state and largely adheres to the target architecture. The data flow from the Bridge/Redis/Postgres backend to the UI is mostly correct. No legacy file-based data sources were found.

The primary issues are a performance bottleneck in the analytics API and a minor logical flaw in how live connection status is displayed.

**Recommended Implementation Order:**

1.  **Fix Account Status Dot (High Priority, Low Effort):**
    - **File to edit**: `src/components/trading-monitor/card/DashboardCard.tsx`.
    - **Action**: Modify the logic for the `active` status. Remove the reliance on `account.status`. The single source of truth should be the live data coming from the `useLiveData` hook, specifically a field like `data.live.terminalConnected`. This ensures the status dot accurately reflects the real-time connection state from the Redis heartbeat.

2.  **Fix On-the-Fly Aggregation (High Priority, High Effort):**
    - **File to edit (API)**: `src/app/api/accounts/[id]/route.ts`.
    - **File to edit (DB)**: `prisma/schema.prisma`.
    - **File to create (Worker)**: `src/worker/jobs/aggregate-performance.ts` (or similar).
    - **Action**:
      1.  Create new tables in `schema.prisma` for `AccountPerformanceBySymbol` and `AccountPerformanceByStrategy`.
      2.  Create a new worker job to periodically calculate these aggregations and store them in the new tables.
      3.  Refactor the `/api/accounts/[id]` GET endpoint to query these new pre-aggregated tables instead of calculating on the fly.

3.  **Add MAE/MFE Display (Medium Priority, Medium Effort):**
    - **File to create/edit**: `src/components/trading-monitor/TradeHistoryPanel.tsx` (or a new component).
    - **Action**: Enhance the closed trades display to include the MAE/MFE data, which is already available in the `ClosedPosition` model. This is a feature enhancement.

4.  **Clarify/Create Bridge Debug Page (Low Priority):**
    - **Action**: Discuss with the team to determine if a debug page is needed. If so, create a new page/component and a corresponding API endpoint that can query Redis for stream/key information.
