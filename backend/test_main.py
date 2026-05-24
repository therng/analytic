import pytest
from fastapi.testclient import TestClient
import hmac
import hashlib
import time
import json
from datetime import datetime, timezone

# We need to import the app after we've set up the env or just mock the settings if needed
# but since we have .env, it should work.
from backend.main import app
from backend.config import settings
from backend.models import AccountUpdate

from unittest.mock import AsyncMock, patch
import backend.main

@pytest.fixture(autouse=True)
def mock_redis():
    with patch("backend.main.redis_client", new_callable=AsyncMock) as mocked:
        yield mocked

client = TestClient(app)

def generate_signature(payload: str, timestamp: str, nonce: str, secret: str) -> str:
    msg = f"{timestamp}{nonce}{payload}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()

def test_ingest_update_valid_signature():
    payload_dict = {
        "account_id": "test_account",
        "balance": 1000.0,
        "equity": 1050.0,
        "margin": 100.0,
        "pnl": 50.0,
        "positions_hash": "abc",
        "positions": [],
        "mt5_connected": True,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    # Use the model to generate the payload string to match how main.py does it
    update_model = AccountUpdate(**payload_dict)
    payload_str = update_model.model_dump_json()
    
    timestamp = str(int(time.time()))
    nonce = "test_nonce"
    signature = generate_signature(payload_str, timestamp, nonce, settings.SECRET)
    
    headers = {
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
    }
    
    response = client.post("/api/v1/ingest/update", json=payload_dict, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_ingest_update_invalid_signature():
    payload_dict = {
        "account_id": "test_account",
        "balance": 1000.0,
        "equity": 1050.0,
        "margin": 100.0,
        "pnl": 50.0,
        "positions_hash": "abc",
        "positions": [],
        "mt5_connected": True,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    timestamp = str(int(time.time()))
    nonce = "test_nonce"
    signature = "wrong_signature"
    
    headers = {
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
    }
    
    response = client.post("/api/v1/ingest/update", json=payload_dict, headers=headers)
    assert response.status_code == 401

def test_ingest_update_expired_timestamp():
    payload_dict = {
        "account_id": "test_account",
        "balance": 1000.0,
        "equity": 1050.0,
        "margin": 100.0,
        "pnl": 50.0,
        "positions_hash": "abc",
        "positions": [],
        "mt5_connected": True,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    # 31 seconds ago
    timestamp = str(int(time.time()) - 31)
    nonce = "test_nonce"
    
    payload_str = json.dumps(payload_dict, separators=(',', ':'))
    signature = generate_signature(payload_str, timestamp, nonce, settings.SECRET)
    
    headers = {
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
    }
    
    response = client.post("/api/v1/ingest/update", json=payload_dict, headers=headers)
    assert response.status_code == 401

def test_ingest_deals_valid():
    deals = [
        {
            "ticket": 12345,
            "account_id": "test_account",
            "symbol": "EURUSD",
            "type": "buy",
            "volume": 0.1,
            "price": 1.1000,
            "profit": 10.0,
            "time": datetime.now(timezone.utc).isoformat()
        }
    ]
    payload_str = json.dumps(deals, separators=(',', ':'))
    
    timestamp = str(int(time.time()))
    nonce = "test_nonce_deals"
    signature = generate_signature(payload_str, timestamp, nonce, settings.SECRET)
    
    headers = {
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
    }
    
    response = client.post("/api/v1/ingest/deals", content=payload_str, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "count": 1}

def test_ingest_deals_invalid_signature():
    deals = [{"ticket": 1, "account_id": "a", "symbol": "s", "type": "t", "volume": 1, "price": 1, "profit": 1, "time": datetime.now(timezone.utc).isoformat()}]
    payload_str = json.dumps(deals)
    
    headers = {
        "x-signature": "wrong",
        "x-timestamp": str(int(time.time())),
        "x-nonce": "nonce"
    }
    
    response = client.post("/api/v1/ingest/deals", content=payload_str, headers=headers)
    assert response.status_code == 401

def test_ingest_deals_invalid_payload():
    payload_str = "not a list"
    timestamp = str(int(time.time()))
    nonce = "nonce"
    signature = generate_signature(payload_str, timestamp, nonce, settings.SECRET)
    
    headers = {
        "x-signature": signature,
        "x-timestamp": timestamp,
        "x-nonce": nonce
    }
    
    response = client.post("/api/v1/ingest/deals", content=payload_str, headers=headers)
    assert response.status_code == 422
