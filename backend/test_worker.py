import pytest
import json
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime

@pytest.mark.asyncio
async def test_persistence_worker_syncs_redis_to_pg():
    # Mock Redis state
    mock_redis = AsyncMock()
    mock_redis.keys.return_value = ["acc:state:12345"]
    state = {
        "account_id": 12345,
        "balance": 1000.0,
        "equity": 1050.0,
        "margin": 100.0,
        "pnl": 50.0,
        "free_margin": 950.0,
        "margin_level": 1050.0,
        "credit_facility": 0.0
    }
    mock_redis.get.return_value = json.dumps(state)

    # Mock asyncpg connection
    mock_conn = AsyncMock()
    mock_conn.is_closed.return_value = False # Set as normal return value, not coroutine
    
    with patch("backend.main.redis_client", mock_redis):
        with patch("backend.worker.asyncpg.connect", return_value=mock_conn):
            from backend.worker import persistence_worker
            
            # Use a short sleep and then cancel
            with patch("asyncio.sleep", side_effect=[None, asyncio.CancelledError]):
                try:
                    await persistence_worker()
                except asyncio.CancelledError:
                    pass
            
            # Verify asyncpg execute was called with correct parameters
            mock_conn.execute.assert_called()
            args = mock_conn.execute.call_args[0]
            query = args[0]
            
            # The query uses $1, $2, etc. so parameters should follow
            assert 'INSERT INTO "AccountSnapshot"' in query
            
            # args[0] is query
            # args[1] is id (uuid)
            # args[2] is account_id
            # args[3] is balance
            # args[4] is equity
            assert args[2] == 12345 # account_id
            assert args[3] == 1000.0 # balance
            assert args[4] == 1050.0 # equity
