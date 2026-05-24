from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect, Request
from contextlib import asynccontextmanager
import redis.asyncio as redis
import asyncio
import json
from backend.models import AccountUpdate, DealSync
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

@app.post("/api/v1/ingest/deals")
async def ingest_deals(
    request: Request,
    x_signature: str = Header(...),
    x_timestamp: str = Header(...),
    x_nonce: str = Header(...)
):
    body = await request.body()
    payload = body.decode()
    
    if not verify_signature(payload, x_signature, x_timestamp, x_nonce, settings.SECRET):
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    try:
        data = json.loads(payload)
        if not isinstance(data, list):
            raise ValueError("Payload must be a list of deals")
        deals = [DealSync.model_validate(d) for d in data]
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid payload format: {str(e)}")
    
    if not deals:
        return {"status": "ok", "count": 0}
        
    account_id = deals[0].account_id
    await redis_client.publish(f"deals:{account_id}", payload)
    
    return {"status": "ok", "count": len(deals)}

@app.websocket("/ws/account/{account_id}")
async def websocket_endpoint(websocket: WebSocket, account_id: str):
    await websocket.accept()
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(f"updates:{account_id}")
    
    async def listen_to_redis():
        try:
            while True:
                # We use timeout to avoid blocking forever
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message["type"] == "message":
                    await websocket.send_text(message["data"])
                await asyncio.sleep(0.01) # Yield control
        except Exception:
            pass

    async def listen_to_client():
        try:
            while True:
                # Keep receiving to detect disconnect
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    try:
        # Run both tasks. If either one finishes (like client disconnect), we stop.
        # We use FIRST_COMPLETED so that if listen_to_client raises WebSocketDisconnect,
        # the entire wait finishes and we proceed to finally.
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(listen_to_redis()), 
                asyncio.create_task(listen_to_client())
            ],
            return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
    except Exception:
        pass
    finally:
        await pubsub.unsubscribe(f"updates:{account_id}")
