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
- [ ] **Database Optimization:** Review and add composite indexes to `Deal` and `Position` tables for improved analytical query performance.
- [ ] **Worker Health Monitoring:** Implement heartbeat/health-check endpoints for the background worker and collector sidecars.

