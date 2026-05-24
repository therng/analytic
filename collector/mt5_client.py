import os
from datetime import datetime

# Wrap MetaTrader5 library calls so we can mock them easily in tests
try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

def ensure_connected():
    if not mt5: return False
    
    path = os.getenv("MT5_PATH")
    
    # 1. Check if already initialized in this process
    terminal_info = mt5.terminal_info()
    if terminal_info is not None:
        if path and terminal_info.path.lower() != path.lower():
            # If path changed, we must shutdown and re-init
            mt5.shutdown()
        else:
            # Already connected to the right one, check if it was portable
            if not terminal_info.portable:
                print(f"CRITICAL: Connected terminal at {terminal_info.path} is NOT PORTABLE.")
                return False
            return True

    # 2. Try to initialize
    login = os.getenv("MT5_LOGIN")
    password = os.getenv("MT5_PASSWORD")
    server = os.getenv("MT5_SERVER")
    
    init_params = {
        "portable": True # STRICT REQUIREMENT: Must be portable to avoid Roaming folder collisions
    }
    if path: init_params["path"] = path
    if login: init_params["login"] = int(login)
    if password: init_params["password"] = password
    if server: init_params["server"] = server
    
    # Initialize MT5. If path is provided and terminal is NOT open, it will start it.
    # If it IS open, it will connect to it.
    if not mt5.initialize(**init_params):
        print(f"Failed to initialize MT5: {mt5.last_error()}")
        return False
    
    # 3. VERIFY: Double check that the terminal is actually running in portable mode
    terminal_info = mt5.terminal_info()
    if terminal_info is None or not terminal_info.portable:
        print(f"CRITICAL ERROR: Terminal at {path} started but is NOT in PORTABLE mode!")
        print("This usually happens due to permission issues (e.g. running from Program Files).")
        mt5.shutdown()
        return False

    print(f"Successfully connected to MT5 Portable: {terminal_info.path}")
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
