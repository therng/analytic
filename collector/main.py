import os
import time
import uuid
import json
import hashlib
import requests
from typing import Optional, Dict, List, Any
from pydantic import BaseModel
from dotenv import load_dotenv

from mt5_client import get_state
from resilience import RingBuffer
from security import sign_payload

load_dotenv()

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8000/ingest")
API_SECRET = os.getenv("API_SECRET", "default_secret")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "1"))

class SidecarCollector:
    def __init__(self):
        self.ring_buffer = RingBuffer(maxlen=100)
        self.last_positions_hash = ""
        self.last_ticket = 0

    def calculate_hash(self, positions: List[Dict[str, Any]]) -> str:
        # Sort positions by ticket to ensure stable hash
        sorted_positions = sorted(positions, key=lambda x: x.get('ticket', 0))
        pos_str = json.dumps(sorted_positions, sort_keys=True)
        return hashlib.sha256(pos_str.encode()).hexdigest()

    def send_to_gateway(self, payload: Any, endpoint: str = "/update") -> bool:
        timestamp = str(int(time.time()))
        nonce = str(uuid.uuid4())
        payload_str = json.dumps(payload, sort_keys=True)
        
        signature = sign_payload(payload_str, timestamp, nonce, API_SECRET)
        
        headers = {
            "X-Signature": signature,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "Content-Type": "application/json"
        }
        
        base_url = os.getenv("GATEWAY_URL", "http://localhost:8000/api/v1/ingest")
        # Ensure base_url doesn't end with /update if we are adding it
        if base_url.endswith("/update"):
            base_url = base_url.replace("/update", "")
        url = f"{base_url}{endpoint}"
        
        try:
            response = requests.post(url, data=payload_str, headers=headers, timeout=5)
            return response.status_code == 200
        except Exception as e:
            print(f"Error sending to {url}: {e}")
            return False

    def sync_deals(self, account_id: str):
        from mt5_client import get_deals
        from datetime import datetime
        
        deals = get_deals(from_ticket=self.last_ticket)
        if deals:
            sync_data = []
            max_ticket = self.last_ticket
            for d in deals:
                sync_data.append({
                    "ticket": d['ticket'],
                    "account_id": str(account_id),
                    "symbol": d['symbol'],
                    "type": "buy" if d['type'] == 0 else "sell",
                    "volume": float(d['volume']),
                    "price": float(d['price']),
                    "profit": float(d['profit']),
                    "time": datetime.fromtimestamp(d['time']).isoformat()
                })
                max_ticket = max(max_ticket, d['ticket'])
            
            if self.send_to_gateway(sync_data, endpoint="/deals"):
                print(f"Synced {len(sync_data)} new deals. Last ticket: {max_ticket}")
                self.last_ticket = max_ticket

    def run(self):
        print(f"Starting SidecarCollector (Polling interval: {POLL_INTERVAL}s)...")
        while True:
            try:
                state = get_state()
                if state:
                    acc_dict, pos_dicts = state
                    account_id = str(acc_dict['login'])
                    
                    # Sync deals
                    self.sync_deals(account_id)
                    
                    current_hash = self.calculate_hash(pos_dicts)
                    
                    # Only send if state changed or periodically (every 60s)
                    if current_hash != self.last_positions_hash:
                        payload = {
                            "account": acc_dict,
                            "positions": pos_dicts,
                            "timestamp": time.time()
                        }
                        
                        if self.send_to_gateway(payload, endpoint="/update"):
                            self.last_positions_hash = current_hash
                            # If we have buffered items, try to send them? 
                            # For simplicity, we just send current state.
                        else:
                            self.ring_buffer.append(payload)
                
                time.sleep(POLL_INTERVAL)
            except Exception as e:
                print(f"Loop error: {e}")
                time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    collector = SidecarCollector()
    collector.run()
