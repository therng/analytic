import asyncio
import json
import asyncpg
from datetime import datetime, timezone
from backend.config import settings
import uuid

async def persistence_worker():
    from backend.main import redis_client
    conn = None
    while True:
        try:
            if not conn or conn.is_closed():
                conn = await asyncpg.connect(settings.DATABASE_URL)
            
            keys = await redis_client.keys("acc:state:*")
            for key in keys:
                try:
                    state_str = await redis_client.get(key)
                    if not state_str: continue
                    state = json.loads(state_str)
                    
                    await conn.execute(
                        """
                        INSERT INTO "AccountSnapshot" 
                        (id, account_id, balance, equity, margin, floating_pl, free_margin, margin_level, credit_facility, report_date, updated_at) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (account_id) DO UPDATE SET
                        balance = EXCLUDED.balance, equity = EXCLUDED.equity, margin = EXCLUDED.margin,
                        floating_pl = EXCLUDED.floating_pl, free_margin = EXCLUDED.free_margin,
                        margin_level = EXCLUDED.margin_level, updated_at = EXCLUDED.updated_at
                        """,
                        str(uuid.uuid4()), state["account_id"], state["balance"], state["equity"], 
                        state["margin"], state.get("pnl", 0), state.get("free_margin", 0), 
                        state.get("margin_level", 0), state.get("credit_facility", 0), 
                        datetime.now(timezone.utc), datetime.now(timezone.utc)
                    )
                except Exception as e:
                    print(f"Error processing account {key}: {e}")
        except Exception as e:
            print(f"Worker Error: {e}")
            conn = None
        await asyncio.sleep(60)

if __name__ == "__main__":
    print("Starting persistence_worker script...")
    asyncio.run(persistence_worker())
