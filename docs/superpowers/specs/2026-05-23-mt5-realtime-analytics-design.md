# Design Document: MT5 Realtime Analytics System

**Date:** 2026-05-23  
**Topic:** MT5 Realtime Analytics  
**Status:** Approved (v7.0)
**Author:** Gemini CLI

---

## 1. Executive Summary
Redesign the current fragile MT5 analytics/reporting system (HTML/FTP/Cheerio) into a robust, near-realtime, multi-tenant architecture. The system prioritizes the stability and latency of the MT5 trading terminal above all else by utilizing an external "Sidecar" collector and a "Gateway Proxy" ingestion model.

---

## 2. Architecture Overview

### 2.1 Component Diagram
```mermaid
graph TD
    subgraph "Windows MT5 Node (Execution Layer)"
        MT5[MT5 Terminal]
        Sidecar[Python Sidecar Collector\n(Frozen Executable)]
        MT5 -- Local IPC --> Sidecar
    end

    subgraph "Linux Backend (Analytics Layer)"
        Gateway[FastAPI Ingestion Gateway]
        Redis[(Redis\nLive State Cache)]
        Worker[Snapshot Persistence Worker]
        Postgres[(PostgreSQL\nHistorical Archive)]
        WS[WebSocket Manager]
        NextJS[Next.js Dashboard]

        Sidecar -- HTTPS POST (HMAC Signed) --> Gateway
        Gateway -- Update State --> Redis
        Gateway -- Fan-out --> WS
        Worker -- Read Snapshot (1m) --> Redis
        Worker -- Write Snapshot --> Postgres
        WS -- Push Update --> NextJS
    end
```

---

## 3. Detailed Specifications

### 3.1 Windows Sidecar (The Collector)
*   **Runtime:** Standalone/Frozen executable (PyInstaller) to ensure system isolation.
*   **Responsibilities:**
    *   Connect to MT5 via official `MetaTrader5` Python library.
    *   Poll `account_info()` and `positions_get()` every 1–2 seconds.
    *   **Change Detection:** Maintain local hash of `equity`, `balance`, and `positions`. Only send update if delta > 0 or hash mismatch.
    *   **Offline Resilience:** Maintain a small FIFO ring buffer (~50 events) for network jitter.
    *   **Recovery:** On reconnection, push the *latest* snapshot immediately, then flush the ring buffer.
*   **Security:** Sign every JSON payload with an HMAC-SHA256 signature. Include a `timestamp`, `nonce`, and validate against a 30-second replay window at the Gateway.

### 3.2 Linux Backend (The Gateway)
*   **Ingestion Endpoint:** `/api/v1/ingest/update` (FastAPI).
*   **Authentication:** Validates HMAC signature, `timestamp` drift, and `nonce` uniqueness; verifies `account_id` ownership.
*   **Live Path (Redis):**
    *   Store state in `acc:state:{id}` with a 60-second TTL.
    *   Payload: `{ balance, equity, margin, pnl, positions_hash, mt5_connected, last_update }`.
*   **Distribution Path (WebSockets):**
    *   Broadcast the update payload to the specific account channel.

### 3.3 Persistence & Storage
*   **Snapshot Worker:** A separate background process (e.g., Celery or FastAPI BackgroundTask) that reads from Redis every 60 seconds and commits a row to `account_snapshots` in PostgreSQL.
*   **Trade History:** A separate reconciliation loop (every 60s) in the Sidecar pulls closed deals using incremental cursors (`last_deal_ticket` and `last_sync_time`). Deals are synced to `/api/v1/ingest/deals` to ensure no trades are missed due to "latest only" realtime logic.

---

## 4. Multi-Tenant Isolation
*   **Terminal Farm Management:** Each account runs one MT5 instance and one Sidecar instance.
*   **Process Monitoring:** Sidecars are managed by NSSM or PM2 to ensure auto-restart on failure.
*   **Authentication:** Next.js users authenticate via Auth.js; FastAPI validates WebSocket subscription requests against the `user_accounts` mapping in Postgres.

---

## 5. Success Criteria & KPIs
*   **Realtime Latency:** UI updates within 2 seconds of MT5 state change.
*   **MT5 Stability:** Zero impact on EA execution latency or terminal memory leaks.
*   **Accuracy:** 100% reconciliation of closed deals between MT5 and PostgreSQL.
*   **Resource Usage:** Sidecar CPU usage < 1% on MT5 nodes.

---

## 6. Risks & Tradeoffs
*   **Data Completeness vs Stability:** By choosing "Latest Only" for realtime state, some sub-second equity fluctuations might not be captured in the 1-minute historical snapshots. This is an intentional tradeoff to protect MT5 resources.
*   **Windows Dependency:** Sidecar remains Windows-only due to the MT5 library.

---

---

## 8. Post-Implementation Review (2026-05-24)
*   **Status:** Transition Complete (v6.6.0).
*   **Outcome:** The real-time architecture has been successfully implemented. 
    *   FastAPI gateway handles HMAC-signed updates from the Python collector.
    *   Redis Pub/Sub correctly routes messages to frontend WebSockets.
    *   WebSocket disconnect detection is robust using `asyncio.wait`.
    *   Persistence worker successfully migrates 1-minute snapshots to PostgreSQL.
*   **Known Deviations:** Initially, some test state pollution and WebSocket hanging issues were encountered but have been resolved. The system is stable and passing all 22 tests.

