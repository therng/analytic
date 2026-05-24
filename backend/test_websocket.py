import pytest
import json
import asyncio
from fastapi.testclient import TestClient
from backend.main import app
from unittest.mock import patch, MagicMock

class MockPubSub:
    def __init__(self, messages):
        self.messages = messages
        self.index = 0
        self.unsubscribed = False

    async def subscribe(self, *args, **kwargs):
        pass

    async def get_message(self, ignore_subscribe_messages=False, timeout=0):
        if self.index < len(self.messages):
            msg = self.messages[self.index]
            self.index += 1
            return {"type": "message", "data": json.dumps(msg)}
        # Return None after all messages are sent, simulating no new messages
        return None

    async def unsubscribe(self, *args, **kwargs):
        self.unsubscribed = True

def test_websocket_streaming():
    client = TestClient(app)
    account_id = "test_acc_123"
    messages = [{"account_id": account_id, "balance": 1000.0}]
    mock_pubsub = MockPubSub(messages)

    import backend.main
    with patch.object(backend.main.redis_client, "pubsub", return_value=mock_pubsub):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            message = websocket.receive_text()
            data = json.loads(message)
            assert data["account_id"] == account_id
            assert data["balance"] == 1000.0

def test_websocket_multiple_messages():
    client = TestClient(app)
    account_id = "test_acc_456"
    messages = [
        {"account_id": account_id, "balance": 2000.0},
        {"account_id": account_id, "balance": 2100.0}
    ]
    mock_pubsub = MockPubSub(messages)

    import backend.main
    with patch.object(backend.main.redis_client, "pubsub", return_value=mock_pubsub):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            msg1 = websocket.receive_text()
            data1 = json.loads(msg1)
            assert data1["balance"] == 2000.0

            msg2 = websocket.receive_text()
            data2 = json.loads(msg2)
            assert data2["balance"] == 2100.0

def test_websocket_unsubscribe_on_disconnect():
    client = TestClient(app)
    account_id = "test_acc_789"
    mock_pubsub = MockPubSub([])

    import backend.main
    with patch.object(backend.main.redis_client, "pubsub", return_value=mock_pubsub):
        with client.websocket_connect(f"/ws/account/{account_id}") as websocket:
            pass # Just connect and disconnect

    assert mock_pubsub.unsubscribed is True
