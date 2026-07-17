# UI Data Flow Audit Report

This report details the current data flow of the dashboard UI, mapping each section to its data source and identifying deviations from the target architecture.

## Target Architecture

The correct and only source of truth for the UI is the path:
**MT5 API → Python Bridge → Redis → Worker → Prisma/PostgreSQL → API → Dashboard**

All other paths, such as FTP, statement files, or local conversions, are invalid.

## UI Data Flow Mapping

| UI Section                     | Component File            | Hook/API Used                                                        | Current Data Source                        | Correct Source                     | Issue / Risk                                                                                                       | Recommended Fix                                                                                                                 |
| :----------------------------- | :------------------------ | :------------------------------------------------------------------- | :----------------------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **Account Status Dot**         | `DashboardCard.tsx`       | `account.status`, `hasLiveBridgeConnection` props                    | **Mixed**: PostgreSQL + Redis              | Redis Heartbeat                    | **Stale DB Status**: `account.status` is derived from a potentially stale `lastUpdated` timestamp in the database. | The status dot logic should only rely on the live Redis heartbeat (`terminalConnected` field from the `Mt5LiveInfo` object).    |
| **Account Overview Cards**     | `DashboardCard.tsx`       | `/api/accounts/[id]/overview`                                        | **PostgreSQL** (via `preaggregated-cache`) | PostgreSQL                         | ✅ Correct                                                                                                         | None.                                                                                                                           |
| **Open Positions**             | `OpenPositionsPanel.tsx`  | `useLiveData` hook -> `/api/accounts/[id]/live`                      | **Redis**                                  | Redis                              | ✅ Correct                                                                                                         | None.                                                                                                                           |
| **Closed Trades**              | `TradeHistoryPanel.tsx`   | `/api/accounts/[id]/positions`                                       | **PostgreSQL** (via `preaggregated-cache`) | PostgreSQL                         | ✅ Correct                                                                                                         | None.                                                                                                                           |
| **MAE/MFE**                    | _Not Implemented_         | _N/A_                                                                | _N/A_                                      | `PositionState` / `ClosedPosition` | **Missing Feature**: The backend processes MAE/MFE data, but no UI component displays it.                          | Implement a UI to show MAE/MFE data for trades, sourcing from the `ClosedPosition` model.                                       |
| **Equity/Drawdown**            | `DrawdownEquityPanel.tsx` | `useLiveData` (live) & `/api/accounts/[id]/balance-detail` (history) | **Mixed**: Redis + PostgreSQL              | `EquityState` or sampled history   | ✅ Correct                                                                                                         | Using Redis for live values and PostgreSQL for the historical chart is the correct approach.                                    |
| **Heat Map**                   | `ProfitHeatmapPanel.tsx`  | `/api/accounts/[id]/profit-detail` (Assumed)                         | **PostgreSQL** (via `preaggregated-cache`) | Aggregated `ClosedPosition`        | ✅ Correct                                                                                                         | None.                                                                                                                           |
| **Yearly/Monthly Performance** | `PerformanceBars.tsx`     | `/api/accounts/[id]/overview` (Assumed)                              | **PostgreSQL** (via `preaggregated-cache`) | Aggregated `ClosedPosition`        | ✅ Correct                                                                                                         | None.                                                                                                                           |
| **Bridge/Debug Status**        | _Not Found_               | _Not Found_                                                          | _Not Found_                                | Redis keys + streams               | **Missing Feature/Info**: No component or page for this was found in the codebase.                                 | Clarify if this page should exist. If so, it should be built with a dedicated API to query Redis directly for operational data. |

## Summary of Findings & Next Steps

The dashboard's data flow is largely aligned with the target architecture. Live components correctly use Redis, and analytics components correctly use PostgreSQL. No dependencies on invalid paths (FTP, statement files) were found.

The main issues identified are:

1.  **Stale Account Status**: The status dot incorrectly uses data from PostgreSQL, which can be out of date.
2.  **Performance Risk**: Some analytics (Symbol/Strategy performance) are calculated on-the-fly in the API, which will be slow for large datasets.
3.  **Missing Features**: MAE/MFE data is not displayed, and a bridge debug page could not be located.

### Exact Files to Edit Next

Based on the audit, the following files are the primary candidates for the initial phase of fixes:

1.  **For the Account Status Dot fix:**
    - `src/components/trading-monitor/card/DashboardCard.tsx`

2.  **For the on-the-fly analytics performance fix:**
    - `src/app/api/accounts/[id]/route.ts`
    - `prisma/schema.prisma`
    - A new worker job file, to be created (e.g., `src/worker/jobs/aggregate-performance.ts`)
