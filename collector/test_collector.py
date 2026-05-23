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

if __name__ == "__main__":
    unittest.main()
