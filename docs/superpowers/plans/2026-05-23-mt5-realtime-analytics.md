# MT5 Realtime Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the MT5 analytics system into a near-realtime, multi-tenant architecture using a Python sidecar, Redis, and a FastAPI gateway.

**Architecture:** A "Gateway Proxy" model where lightweight Python sidecars push signed MT5 snapshots to a FastAPI server. FastAPI manages a Redis live cache and broadcasts updates via WebSockets, while a background worker persists 1-minute snapshots to PostgreSQL.

**Tech Stack:** Python 3.11+, MetaTrader5 API, FastAPI, Redis, PostgreSQL, Next.js, PyInstaller.

---

### Task 1: Shared Schemas & Models

**Files:**
- Create: `shared/models.py`
- Create: `backend/models.py`
- Create: `collector/models.py`

- [ ] **Step 1: Define shared Pydantic models for snapshots and deals**

```python
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class PositionSnapshot(BaseModel):
    ticket: int
    symbol: str
    type: str
    volume: float
    profit: float

class AccountUpdate(BaseModel):
    account_id: str
    balance: float
    equity: float
    margin: float
    pnl: float
    positions_hash: str
    positions: List[PositionSnapshot]
    mt5_connected: bool
    timestamp: datetime

class DealSync(BaseModel):
    ticket: int
    account_id: str
    symbol: str
    type: str
    volume: float
    price: float
    profit: float
    time: datetime
```

- [ ] **Step 2: Commit**

```bash
git add shared/models.py
git commit -m "feat: define shared data models"
```

---

### Task 2: FastAPI Ingestion API

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/main.py`
- Create: `backend/security.py`
- Create: `backend/config.py`

- [ ] **Step 1: Implement HMAC security utility**

```python
import hmac, hashlib, time

def verify_signature(payload: str, signature: str, timestamp: str, nonce: str, secret: str) -> bool:
    if abs(int(time.time()) - int(timestamp)) > 30:
        return False
    msg = f"{timestamp}{nonce}{payload}".encode()
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

- [ ] **Step 2: Implement basic Ingestion API with HMAC validation**

```python
@app.post("/api/v1/ingest/update")
async def ingest_update(
    update: AccountUpdate,
    x_signature: str = Header(...),
    x_timestamp: str = Header(...),
    x_nonce: str = Header(...)
):
    if not verify_signature(update.json(), x_signature, x_timestamp, x_nonce, settings.SECRET):
        raise HTTPException(401)
    # Logic to be added in next task
    return {"status": "ok"}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: implement fastapi ingestion api with hmac"
```

---

### Task 3: Redis Live-State Layer

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Integrate Redis for live state caching and Pub/Sub**

```python
@app.post("/api/v1/ingest/update")
async def ingest_update(update: AccountUpdate, ...):
    # ... after auth ...
    key = f"acc:state:{update.account_id}"
    await redis_client.set(key, update.json(), ex=60)
    await redis_client.publish(f"updates:{update.account_id}", update.json())
    return {"status": "ok"}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: integrate redis live-state and pub/sub"
```

---

### Task 4: Collector Implementation (Sidecar)

**Files:**
- Create: `collector/main.py`
- Create: `collector/mt5_client.py`
- Create: `collector/resilience.py`

- [ ] **Step 1: Implement MT5 polling, FIFO ring buffer, and HMAC signing**

```python
class SidecarCollector:
    def __init__(self):
        self.buffer = deque(maxlen=50)
        self.last_state = None

    def poll_and_send(self):
        state = self.get_mt5_state()
        if self.has_changed(state):
            if self.is_online():
                self.flush_buffer()
                self.send_to_gateway(state)
            else:
                self.buffer.append(state)
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: implement python sidecar with resilience and signing"
```

---

### Task 5: WebSocket Fanout

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Implement WebSocket endpoint for clients**

```python
@app.websocket("/ws/account/{account_id}")
async def websocket_endpoint(websocket: WebSocket, account_id: str):
    await websocket.accept()
    # Subscribe to redis channel and stream messages to client
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: implement websocket fanout"
```

---

### Task 6: Snapshot Worker

**Files:**
- Create: `backend/worker.py`

- [ ] **Step 1: Implement 1-minute PostgreSQL persistence worker**

```python
async def persistence_worker():
    while True:
        # Pull latest snapshots from Redis and save to Postgres once per minute
        await asyncio.sleep(60)
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: add snapshot persistence worker"
```

---

### Task 7: Trade Reconciliation

**Files:**
- Modify: `collector/main.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Implement incremental deal sync using ticket cursors**

```python
def sync_deals(self):
    deals = mt5.history_deals_get(from_ticket=self.last_ticket)
    # Send to /api/v1/ingest/deals
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: implement incremental trade reconciliation"
```

---

### Task 8: Frontend Integration

**Files:**
- Create: `src/hooks/useRealtimeAccount.ts`
- Modify: `src/components/trading-monitor/AccountCard.tsx`

- [ ] **Step 1: Add useRealtimeAccount hook and connect to WebSocket**

```typescript
export function useRealtimeAccount(accountId: string) {
    // ws connection logic
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: connect frontend to realtime websocket"
```

---

### Task 9: Packaging & Deployment

**Files:**
- Create: `collector/build.ps1`

- [ ] **Step 1: Create PyInstaller build script for sidecar**

```powershell
pyinstaller --onefile --name mt5-collector main.py
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: add packaging script for collector"
```
