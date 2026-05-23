import pytest
from httpx import AsyncClient
from backend.main import app
from unittest.mock import patch
import json
import hmac
import hashlib
import time
from datetime import datetime, timezone
import fakeredis

@pytest.mark.asyncio
async def test_ingest_update_redis_interaction():
    # Setup mock data that matches AccountUpdate model
    account_id = "test-account"
    # Need to use ISO format for datetime in JSON
    now = datetime.now(timezone.utc)
    payload_data = {
        "account_id": account_id,
        "balance": 1000.0,
        "equity": 1050.0,
        "margin": 100.0,
        "pnl": 50.0,
        "positions_hash": "some-hash",
        "positions": [],
        "mt5_connected": True,
        "timestamp": now.isoformat().replace("+00:00", "Z")
    }
    
    # We use model_dump_json() in main.py, so we should be careful with serialization
    # For signature calculation, we need the exact string that verify_signature will see
    from backend.models import AccountUpdate
    update_obj = AccountUpdate(**payload_data)
    payload_json = update_obj.model_dump_json()
    
    # Generate valid signature
    secret = "change-me-in-production"
    timestamp = str(int(time.time()))
    nonce = "test-nonce"
    message = f"{timestamp}{nonce}{payload_json}"
    signature = hmac.new(
        secret.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()

    # Use fakeredis
    fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    
    # We patch it in backend.main since that's where it's used
    from httpx import ASGITransport
    with patch("backend.main.redis_client", fake_redis):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            response = await ac.post(
                "/api/v1/ingest/update",
                content=payload_json,
                headers={
                    "x-signature": signature,
                    "x-timestamp": timestamp,
                    "x-nonce": nonce,
                    "content-type": "application/json"
                }
            )
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

        # Verify Redis interactions using the actual fake_redis
        key = f"acc:state:{account_id}"
        stored_data = await fake_redis.get(key)
        assert stored_data is not None
        assert json.loads(stored_data) == json.loads(payload_json)
        
        ttl = await fake_redis.ttl(key)
        assert ttl == 60

        # We can also check if it was published (though fakeredis pubsub is a bit more complex to check synchronously)
        # But for this test, verifying the 'set' worked is already a big improvement over AsyncMock.
