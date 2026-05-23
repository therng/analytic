import pytest
from fastapi.testclient import TestClient
from backend.main import app
import json
import asyncio
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_websocket_streaming():
    client = TestClient(app)
    account_id = "test_acc_123"
    
    # Mock redis_client.pubsub
    mock_pubsub = AsyncMock()
    # Mock message format from redis-py
    # message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
    mock_pubsub.get_message.side_effect = [
        {"type": "message", "data": json.dumps({"account_id": account_id, "balance": 1000.0})},
        asyncio.exceptions.TimeoutError() # Simulate timeout to avoid infinite loop in some scenarios if needed
    ]
    
    with patch("backend.main.redis_client.pubsub", return_value=mock_pubsub):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            # We expect to receive the first message
            data = websocket.receive_json()
            assert data["account_id"] == account_id
            assert data["balance"] == 1000.0

@pytest.mark.asyncio
async def test_websocket_multiple_messages():
    client = TestClient(app)
    account_id = "test_acc_456"
    
    mock_pubsub = AsyncMock()
    mock_pubsub.get_message.side_effect = [
        {"type": "message", "data": json.dumps({"account_id": account_id, "balance": 2000.0})},
        {"type": "message", "data": json.dumps({"account_id": account_id, "balance": 2100.0})},
        asyncio.exceptions.TimeoutError()
    ]
    
    with patch("backend.main.redis_client.pubsub", return_value=mock_pubsub):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            data1 = websocket.receive_json()
            assert data1["balance"] == 2000.0
            data2 = websocket.receive_json()
            assert data2["balance"] == 2100.0

@pytest.mark.asyncio
async def test_websocket_unsubscribe_on_disconnect():
    client = TestClient(app)
    account_id = "test_acc_789"
    
    mock_pubsub = AsyncMock()
    # Return nothing to stay in the loop
    mock_pubsub.get_message.return_value = None
    
    with patch("backend.main.redis_client.pubsub", return_value=mock_pubsub):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            pass # Disconnect immediately
            
    # Verify unsubscribe was called
    mock_pubsub.unsubscribe.assert_called_with(f"updates:{account_id}")
