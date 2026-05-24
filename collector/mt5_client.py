import os
from datetime import datetime

# Wrap MetaTrader5 library calls so we can mock them easily in tests
try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

def ensure_connected():
    if not mt5: return False
    
    # Check if already initialized
    terminal_info = mt5.terminal_info()
    if terminal_info is not None:
        return True

    # Try to initialize using env vars
    path = os.getenv("MT5_PATH")
    login = os.getenv("MT5_LOGIN")
    password = os.getenv("MT5_PASSWORD")
    server = os.getenv("MT5_SERVER")
    
    init_params = {}
    if path: init_params["path"] = path
    if login: init_params["login"] = int(login)
    if password: init_params["password"] = password
    if server: init_params["server"] = server
    
    if not mt5.initialize(**init_params):
        print(f"Failed to initialize MT5: {mt5.last_error()}")
        return False
    return True

def get_state():
    if not ensure_connected(): return None
    acc_info = mt5.account_info()
    if acc_info is None: return None
    acc_dict = acc_info._asdict()
    positions = mt5.positions_get()
    pos_dicts = [p._asdict() for p in positions] if positions else []
    return acc_dict, pos_dicts

def get_deals(from_ticket=0):
    if not ensure_connected(): return []
    # history_deals_get requires a time range
    deals = mt5.history_deals_get(datetime(1970, 1, 1), datetime.now())
    if deals is None:
        return []
    return [d._asdict() for d in deals if d.ticket > from_ticket]
