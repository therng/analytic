from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
import redis.asyncio as redis
import asyncio
from backend.models import AccountUpdate
from backend.security import verify_signature
from backend.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    from backend.worker import persistence_worker
    task = asyncio.create_task(persistence_worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)
redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

@app.post("/api/v1/ingest/update")
async def ingest_update(
    update: AccountUpdate,
    x_signature: str = Header(...),
    x_timestamp: str = Header(...),
    x_nonce: str = Header(...)
):
    # For Pydantic v2, we use model_dump_json() for consistent serialization
    payload = update.model_dump_json()
    
    if not verify_signature(payload, x_signature, x_timestamp, x_nonce, settings.SECRET):
        raise HTTPException(status_code=401, detail="Invalid signature")
        
    key = f"acc:state:{update.account_id}"
    await redis_client.set(key, update.model_dump_json(), ex=60)
    await redis_client.publish(f"updates:{update.account_id}", update.model_dump_json())
    
    return {"status": "ok"}

@app.websocket("/ws/account/{account_id}")
async def websocket_endpoint(websocket: WebSocket, account_id: str):
    await websocket.accept()
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(f"updates:{account_id}")
    
    try:
        while True:
            # We use timeout to avoid blocking forever and allow checking for disconnects
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message["type"] == "message":
                await websocket.send_text(message["data"])
            await asyncio.sleep(0.01) # Yield control
    except WebSocketDisconnect:
        pass
    except Exception:
        # Log error or handle other exceptions
        pass
    finally:
        await pubsub.unsubscribe(f"updates:{account_id}")
