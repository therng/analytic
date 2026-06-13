# MT5 Realtime Analytics TODO

- [x] Task 1: Shared Schemas & Models
- [x] Task 2: FastAPI Ingestion API
- [x] Task 3: Redis Live-State Layer
- [x] Task 4: Collector Implementation (Sidecar)
- [x] Task 5: WebSocket Fanout
- [x] Task 6: Snapshot Worker
- [x] Task 7: Trade Reconciliation
- [x] Task 8: Frontend Integration
- [x] Task 9: Packaging & Deployment

## Upcoming Improvements

- [ ] **Incremental Historical Updates:** Implement incremental deal syncing for historical reports to avoid full re-computations and improve worker performance.
- [ ] **Enhanced Backend Testing:** Add full `pytest` coverage for the Python `collector` and `backend` transformation layers.
- [ ] **Config Centralization:** Consolidate hardcoded API paths and server ports into a unified configuration management system.
- [x] **Database Optimization:** Review and add composite indexes to `Deal` and `Position` tables for improved analytical query performance.
- [x] **Worker Health Monitoring (background worker):** Heartbeat HTTP endpoint (`GET /health`) on the Node import worker, wired into the Docker healthcheck.
- [ ] **Worker Health Monitoring (collector sidecars):** Add an equivalent heartbeat/health-check endpoint to the Python collector sidecars.

