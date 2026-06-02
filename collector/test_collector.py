import unittest
from unittest.mock import patch, MagicMock
import json
import time

from collector.main import SidecarCollector

class TestSidecarCollector(unittest.TestCase):
    def setUp(self):
        self.collector = SidecarCollector()

    def test_calculate_hash_stability(self):
        positions = [
            {"ticket": 1, "symbol": "EURUSD"},
            {"ticket": 2, "symbol": "GBPUSD"}
        ]
        hash1 = self.collector.calculate_hash(positions)
        
        # Reverse order
        positions_rev = [
            {"ticket": 2, "symbol": "GBPUSD"},
            {"ticket": 1, "symbol": "EURUSD"}
        ]
        hash2 = self.collector.calculate_hash(positions_rev)
        
        self.assertEqual(hash1, hash2)

    @patch('requests.post')
    def test_send_to_gateway_success(self, mock_post):
        mock_post.return_value.status_code = 200
        payload = {"test": "data"}
        
        result = self.collector.send_to_gateway(payload)
        
        self.assertTrue(result)
        mock_post.assert_called_once()
        # Verify headers
        args, kwargs = mock_post.call_args
        self.assertIn("X-Signature", kwargs["headers"])
        self.assertIn("X-Timestamp", kwargs["headers"])
        self.assertIn("X-Nonce", kwargs["headers"])

    @patch('requests.post')
    def test_send_to_gateway_failure(self, mock_post):
        mock_post.side_effect = Exception("Connection refused")
        payload = {"test": "data"}
        
        result = self.collector.send_to_gateway(payload)
        
        self.assertFalse(result)

    @patch('collector.main.get_deals', create=True)
    def test_sync_deals(self, mock_get_deals):
        # We need to mock get_deals which is imported inside the method
        with patch.dict('sys.modules', {'mt5_client': MagicMock(get_deals=mock_get_deals)}):
            mock_get_deals.return_value = [
                {"ticket": 100, "symbol": "EURUSD", "type": 0, "volume": 0.1, "price": 1.1, "profit": 5.0, "time": 1600000000},
                {"ticket": 101, "symbol": "GBPUSD", "type": 1, "volume": 0.2, "price": 1.2, "profit": -2.0, "time": 1600000010}
            ]
            
            with patch.object(self.collector, 'send_to_gateway') as mock_send:
                mock_send.return_value = True
                
                self.collector.sync_deals("12345")
                
                mock_send.assert_called_once()
                args, kwargs = mock_send.call_args
                payload = args[0]
                
                self.assertEqual(len(payload), 2)
                self.assertEqual(payload[0]["ticket"], 100)
                self.assertEqual(payload[0]["type"], "buy")
                self.assertEqual(payload[1]["type"], "sell")
                self.assertEqual(kwargs["endpoint"], "/deals")
                self.assertEqual(self.collector.last_ticket, 101)

if __name__ == "__main__":
    unittest.main()
