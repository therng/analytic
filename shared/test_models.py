import unittest
from datetime import datetime
try:
    from shared.models import PositionSnapshot, AccountUpdate, DealSync
except ImportError:
    PositionSnapshot = None
    AccountUpdate = None
    DealSync = None

class TestModels(unittest.TestCase):
    def test_position_snapshot(self):
        if PositionSnapshot is None:
            self.fail("PositionSnapshot not found in shared.models")
        data = {
            "ticket": 123,
            "symbol": "XAUUSD",
            "type": "buy",
            "volume": 0.1,
            "profit": 10.5
        }
        snapshot = PositionSnapshot(**data)
        self.assertEqual(snapshot.ticket, 123)
        self.assertEqual(snapshot.symbol, "XAUUSD")

    def test_account_update(self):
        if AccountUpdate is None:
            self.fail("AccountUpdate not found in shared.models")
        snapshot_data = {
            "ticket": 123,
            "symbol": "XAUUSD",
            "type": "buy",
            "volume": 0.1,
            "profit": 10.5
        }
        data = {
            "account_id": "ACC1",
            "balance": 1000.0,
            "equity": 1010.5,
            "margin": 100.0,
            "pnl": 10.5,
            "positions_hash": "hash123",
            "positions": [snapshot_data],
            "mt5_connected": True,
            "timestamp": datetime.now()
        }
        update = AccountUpdate(**data)
        self.assertEqual(update.account_id, "ACC1")
        self.assertEqual(len(update.positions), 1)
        self.assertIsInstance(update.positions[0], PositionSnapshot)

    def test_deal_sync(self):
        if DealSync is None:
            self.fail("DealSync not found in shared.models")
        data = {
            "ticket": 456,
            "account_id": "ACC1",
            "symbol": "XAUUSD",
            "type": "buy",
            "volume": 0.1,
            "price": 2000.0,
            "profit": 5.0,
            "time": datetime.now()
        }
        deal = DealSync(**data)
        self.assertEqual(deal.ticket, 456)
        self.assertEqual(deal.price, 2000.0)

if __name__ == '__main__':
    import sys
    import os
    # Add root to sys.path to allow imports from shared
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    unittest.main()
