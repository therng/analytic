# Shared Schemas & Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define shared Pydantic models for snapshots and deals to be used by both backend and collector services.

**Architecture:** Centralized Pydantic models in a `shared` package, with `backend` and `collector` services importing them to ensure consistency in data structures for account updates and deal synchronization.

**Tech Stack:** Python 3, Pydantic v2 (assumed), Unittest (for TDD).

---

### Task 1: Shared Models Implementation

**Files:**
- Create/Modify: `shared/models.py`
- Create: `shared/test_models.py`

- [ ] **Step 1: Write the failing test for shared models**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python3 shared/test_models.py`
Expected: FAIL with "PositionSnapshot not found in shared.models"

- [ ] **Step 3: Implement minimal shared models**

In `shared/models.py`:
```python
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class PositionSnapshot(BaseModel):
    ticket: int
    symbol: str
    type: str
    volume: float
    profit: float

class AccountUpdate(BaseModel):
    account_id: str
    balance: float
    equity: float
    margin: float
    pnl: float
    positions_hash: str
    positions: List[PositionSnapshot]
    mt5_connected: bool
    timestamp: datetime

class DealSync(BaseModel):
    ticket: int
    account_id: str
    symbol: str
    type: str
    volume: float
    price: float
    profit: float
    time: datetime
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python3 shared/test_models.py`
Expected: PASS

- [ ] **Step 5: Commit shared models**

```bash
git add shared/models.py
git commit -m "feat: add shared Pydantic models for MT5 analytics"
```

### Task 2: Service Model Integration

**Files:**
- Create: `backend/models.py`
- Create: `collector/models.py`
- Create: `backend/test_imports.py`
- Create: `collector/test_imports.py`

- [ ] **Step 1: Create backend/models.py and collector/models.py**

In `backend/models.py`:
```python
from shared.models import *
```

In `collector/models.py`:
```python
from shared.models import *
```

- [ ] **Step 2: Write failing test for backend imports**

In `backend/test_imports.py`:
```python
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
```

- [ ] **Step 3: Run backend import test**

Run: `PYTHONPATH=. python3 backend/test_imports.py`
Expected: PASS

- [ ] **Step 4: Write failing test for collector imports**

In `collector/test_imports.py`:
```python
import unittest
import sys
import os

# Add root to sys.path to allow imports from shared
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class TestCollectorImports(unittest.TestCase):
    def test_import_models(self):
        from collector.models import PositionSnapshot
        self.assertIsNotNone(PositionSnapshot)

if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 5: Run collector import test**

Run: `PYTHONPATH=. python3 collector/test_imports.py`
Expected: PASS

- [ ] **Step 6: Commit service models**

```bash
git add backend/models.py collector/models.py
git commit -m "feat: integrate shared models into backend and collector"
```

- [ ] **Step 7: Cleanup test files**

```bash
rm shared/test_models.py backend/test_imports.py collector/test_imports.py
```
