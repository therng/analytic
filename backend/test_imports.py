import unittest
import sys
import os

# Add root to sys.path to allow imports from shared
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class TestBackendImports(unittest.TestCase):
    def test_import_models(self):
        from backend.models import PositionSnapshot
        self.assertIsNotNone(PositionSnapshot)

if __name__ == '__main__':
    unittest.main()
