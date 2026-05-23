from datetime import datetime

# Wrap MetaTrader5 library calls so we can mock them easily in tests
try:
    import MetaTrader5 as mt5
except ImportError:
    mt5 = None

def get_state():
    if not mt5: return None
    acc_info = mt5.account_info()
    if acc_info is None: return None
    acc_dict = acc_info._asdict()
    positions = mt5.positions_get()
    pos_dicts = [p._asdict() for p in positions] if positions else []
    return acc_dict, pos_dicts

def get_deals(from_ticket=0):
    if not mt5: return []
    # history_deals_get requires a time range
    deals = mt5.history_deals_get(datetime(1970, 1, 1), datetime.now())
    if deals is None:
        return []
    return [d._asdict() for d in deals if d.ticket > from_ticket]
