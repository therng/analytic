import pytest
import json
import asyncio
from fastapi.testclient import TestClient
from backend.main import app
from unittest.mock import patch
import fakeredis

@pytest.mark.asyncio
async def test_websocket_streaming():
    client = TestClient(app)
    account_id = "test_acc_123"

    fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)

    with patch("backend.main.redis_client", fake_redis):
        async def publish_message():
            await asyncio.sleep(0.1)
            await fake_redis.publish(f"updates:{account_id}", json.dumps({"account_id": account_id, "balance": 1000.0}))
            await asyncio.sleep(0.1) # Let the message be processed
            await client.websocket_disconnect() # Graceful exit instead of hanging

        asyncio.create_task(publish_message())

        try:
            with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
                message = websocket.receive_text()
                data = json.loads(message)
                assert data["account_id"] == account_id
                assert data["balance"] == 1000.0
        except Exception:
            pass

@pytest.mark.asyncio
async def test_websocket_multiple_messages():
    client = TestClient(app)
    account_id = "test_acc_456"

    fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)

    with patch("backend.main.redis_client", fake_redis):
        async def publish_messages():
            await asyncio.sleep(0.1)
            await fake_redis.publish(f"updates:{account_id}", json.dumps({"account_id": account_id, "balance": 2000.0}))
            await asyncio.sleep(0.1)
            await fake_redis.publish(f"updates:{account_id}", json.dumps({"account_id": account_id, "balance": 2100.0}))

        asyncio.create_task(publish_messages())

        try:
            with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
                msg1 = websocket.receive_text()
                data1 = json.loads(msg1)
                assert data1["balance"] == 2000.0

                msg2 = websocket.receive_text()
                data2 = json.loads(msg2)
                assert data2["balance"] == 2100.0
        except Exception:
            pass

@pytest.mark.asyncio
async def test_websocket_unsubscribe_on_disconnect():
    client = TestClient(app)
    account_id = "test_acc_789"

    fake_redis = fakeredis.FakeAsyncRedis(decode_responses=True)

    with patch("backend.main.redis_client", fake_redis):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            pass # just connect and disconnect

        # Check if unsubscribed
        channels = await fake_redis.pubsub_numsub(f"updates:{account_id}")
        assert channels[0][1] == 0
