import json
import pytest
from unittest.mock import AsyncMock, patch
import time
import hmac
import hashlib

from backend.config import settings


def make_signed_headers(payload: str, secret: str = None):
    if secret is None:
        secret = settings.SECRET
    timestamp = str(int(time.time()))
    nonce = "test-nonce-001"
    # security.py format: f"{timestamp}{nonce}{payload}" (no dots)
    message = f"{timestamp}{nonce}{payload}"
    sig = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {
        "x-signature": sig,
        "x-timestamp": timestamp,
        "x-nonce": nonce,
    }


@pytest.mark.asyncio
async def test_ingest_deals_publishes_to_each_account_channel():
    """Deals from two different accounts must publish to two separate channels."""
    deals = [
        {
            "account_id": "A1",
            "ticket": 1,
            "symbol": "EURUSD",
            "type": "buy",
            "volume": 0.1,
            "price": 1.1,
            "profit": 100.0,
            "time": "2026-01-01T00:00:00",
        },
        {
            "account_id": "B2",
            "ticket": 2,
            "symbol": "GBPUSD",
            "type": "sell",
            "volume": 0.2,
            "price": 1.2,
            "profit": -50.0,
            "time": "2026-01-01T00:00:01",
        },
    ]
    payload = json.dumps(deals)
    headers = make_signed_headers(payload)

    published = {}

    async def fake_publish(channel, data):
        published[channel] = json.loads(data)

    with patch("backend.main.redis_client") as mock_redis:
        mock_redis.publish = AsyncMock(side_effect=fake_publish)
        from fastapi.testclient import TestClient
        from backend.main import app
        client = TestClient(app)
        resp = client.post(
            "/api/v1/ingest/deals",
            content=payload,
            headers={**headers, "content-type": "application/json"},
        )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert "deals:A1" in published, "channel for account A1 must receive a publish"
    assert "deals:B2" in published, "channel for account B2 must receive a publish"
    assert all(d["account_id"] == "A1" for d in published["deals:A1"])
    assert all(d["account_id"] == "B2" for d in published["deals:B2"])
