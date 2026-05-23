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
