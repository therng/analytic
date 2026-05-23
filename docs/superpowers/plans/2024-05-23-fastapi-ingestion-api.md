# FastAPI Ingestion API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement basic Ingestion API with HMAC validation.

**Architecture:** A FastAPI backend with Pydantic models for request validation and HMAC-based signature verification for security.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic, pydantic-settings, pytest, httpx.

---

### Task 1: Backend Setup & Requirements

**Files:**
- Create: `backend/requirements.txt`

- [ ] **Step 1: Create requirements.txt**

```text
fastapi
uvicorn
pydantic
pydantic-settings
pytest
httpx
```

- [ ] **Step 2: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add backend requirements"
```

### Task 2: HMAC Security Utility

**Files:**
- Create: `backend/security.py`
- Create: `backend/test_security.py`

- [ ] **Step 1: Write failing tests for signature verification**

```python
import time
import hmac
import hashlib
from backend.security import verify_signature

def test_verify_signature_valid():
    secret = "test-secret"
    payload = '{"test": "data"}'
    timestamp = str(int(time.time()))
    nonce = "test-nonce"
    msg = f"{timestamp}{nonce}{payload}".encode()
    signature = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    
    assert verify_signature(payload, signature, timestamp, nonce, secret) is True

def test_verify_signature_invalid_signature():
    assert verify_signature('{}', "wrong", "123", "nonce", "secret") is False

def test_verify_signature_expired():
    secret = "test-secret"
    payload = '{"test": "data"}'
    timestamp = str(int(time.time()) - 60) # 60 seconds ago
    nonce = "test-nonce"
    msg = f"{timestamp}{nonce}{payload}".encode()
    signature = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    
    assert verify_signature(payload, signature, timestamp, nonce, secret) is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/test_security.py`
Expected: FAIL (ImportError or ModuleNotFoundError)

- [ ] **Step 3: Implement minimal HMAC verification**

```python
import hmac, hashlib, time

def verify_signature(payload: str, signature: str, timestamp: str, nonce: str, secret: str) -> bool:
    try:
        ts_int = int(timestamp)
        if abs(int(time.time()) - ts_int) > 30:
            return False
    except ValueError:
        return False
        
    msg = f"{timestamp}{nonce}{payload}".encode()
    expected = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/test_security.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/security.py backend/test_security.py
git commit -m "feat: implement HMAC signature verification"
```

### Task 3: Configuration Management

**Files:**
- Create: `backend/config.py`

- [ ] **Step 1: Implement Settings class**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    SECRET: str = "change-me-in-production"

    class Config:
        env_file = ".env"

settings = Settings()
```

- [ ] **Step 2: Commit**

```bash
git add backend/config.py
git commit -m "feat: add configuration management"
```

### Task 4: Ingestion API Endpoint

**Files:**
- Modify: `backend/main.py`
- Create: `backend/test_main.py`

- [ ] **Step 1: Write failing tests for ingestion endpoint**

```python
import hmac
import hashlib
import time
import json
from fastapi.testclient import TestClient
from backend.main import app
from backend.config import settings

client = TestClient(app)

def test_ingest_update_valid():
    payload_dict = {
        "account_id": "test-acc",
        "balance": 1000.0,
        "equity": 1050.0,
        "margin": 100.0,
        "pnl": 50.0,
        "positions_hash": "hash",
        "positions": [],
        "mt5_connected": True,
        "timestamp": "2024-05-23T12:00:00"
    }
    payload_str = json.dumps(payload_dict, separators=(',', ':'))
    
    timestamp = str(int(time.time()))
    nonce = "nonce123"
    msg = f"{timestamp}{nonce}{payload_str}".encode()
    signature = hmac.new(settings.SECRET.encode(), msg, hashlib.sha256).hexdigest()
    
    response = client.post(
        "/api/v1/ingest/update",
        json=payload_dict,
        headers={
            "x-signature": signature,
            "x-timestamp": timestamp,
            "x-nonce": nonce
        }
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_ingest_update_invalid_signature():
    response = client.post(
        "/api/v1/ingest/update",
        json={"account_id": "test"},
        headers={
            "x-signature": "wrong",
            "x-timestamp": str(int(time.time())),
            "x-nonce": "nonce"
        }
    )
    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/test_main.py`
Expected: FAIL (404 or ImportError)

- [ ] **Step 3: Implement ingestion endpoint**

```python
from fastapi import FastAPI, Header, HTTPException, Request
from backend.security import verify_signature
from backend.config import settings
from shared.models import AccountUpdate
import json

app = FastAPI()

@app.post("/api/v1/ingest/update")
async def ingest_update(
    update: AccountUpdate,
    request: Request,
    x_signature: str = Header(...),
    x_timestamp: str = Header(...),
    x_nonce: str = Header(...)
):
    body = await request.body()
    payload = body.decode()
    
    if not verify_signature(payload, x_signature, x_timestamp, x_nonce, settings.SECRET):
        raise HTTPException(status_code=401, detail="Invalid signature")
        
    return {"status": "ok"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/test_main.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_main.py
git commit -m "feat: implement ingestion update endpoint with HMAC validation"
```
