# MT5 Bridge Data Contracts

แนวคิดหลัก:

```txt
MT5 Bridge / Redis
= ข้อมูลสด ใช้โชว์ dashboard และคำนวณ runtime

Prisma / Database
= ข้อมูลถาวร เก็บประวัติ snapshot และ closed trade
```

เอกสารชุดนี้ไม่ใช่ proposal สำหรับสร้าง Prisma model ใหม่ แต่เป็น Redis contract และ mapping ไป existing durable models ของ repo

## Current Runtime Contracts

| Runtime data | Actual Redis key / stream | Purpose |
|---|---|---|
| Account live state | `mt5:account:{login}:live` | ข้อมูลสดจาก `account_info()` + `terminal_info()` |
| Open positions snapshot | `mt5:account:{login}:positions` | JSON array ของ positions ที่ยังเปิดอยู่ TTL สั้น |
| Position runtime state | `mt5:account:{login}:position-state` | Hash ticket -> running MAE/MFE state |
| Equity runtime state | `mt5:account:{login}:equity-state` | Hash running peak equity state |
| Deal history stream | `mt5:account:{login}:deals-stream` | MT5 deal ledger จาก `history_deals_get()` |
| Order history stream | `mt5:account:{login}:orders-stream` | MT5 order history จาก `history_orders_get()` |
| Closed position stream | `mt5:account:{login}:position-closed-stream` | Enriched close event ต่อ position |

## Durable Model Mapping

| Redis / bridge source | Existing Prisma model | Notes |
|---|---|---|
| `:live` | `AccountSnapshot` | Current account financial snapshot |
| `:live` minute sample | `EquitySnapshot` | Intraday equity/balance/margin sample |
| `:positions` | `OpenPosition` | Current open-position mirror |
| `:positions` minute sample | `PositionExcursion` | Intraday open-position profit sample |
| `deals-stream` | `Deal` | Durable deal ledger |
| `orders-stream` | `Order` | Durable order history |
| `position-closed-stream` | `Position` | Durable closed position/trade history |

`PositionExcursion` currently persists only `positionTicket`, minute `ts`, and
`profit` from the open-position sample, plus the account relation. The schema
also has `runningMae` and `runningMfe`, but the current worker does not populate
them; they are future fields until the sampler/bridge writes them intentionally.

## Update Cycle

```txt
Every bridge poll:
1. Read account_info()
2. Read terminal_info()
3. Write Redis :live
4. Read positions_get()
5. Write Redis :positions
6. Update Redis :position-state for open tickets
7. Update Redis :equity-state
8. If a ticket disappears, publish one position-closed event when close data is available

Background history sync:
1. Read history_deals_get()
2. Publish deals-stream
3. Read history_orders_get()
4. Publish orders-stream
5. Advance independent deal/order cursors
```

`position-closed-stream` is not enriched from order history today. Close events
come from `history_deals_get(position=...)` plus the Redis position-state
tracker; the `orderTicket` value, when present, is copied from the exit deal's
`order` field.

## Legacy-Active Staging Remnants

`BridgeDeal`, `BridgeOrder`, and `BridgePosition` are legacy-active staging
remnants. They are not current runtime durable destinations for the bridge
consumer, but they are not safe to delete independently. Remove them only when
mapper helper types, tests, Prisma schema relations, and cleanup logic are
migrated together.

## What Not To Add Now

Do not create these as new Prisma models:

```txt
ClosedPosition
PositionState
EquityState
OpenPosition duplicate
```

Reason: the repo already has durable tables for closed positions, open positions, snapshots, and excursions. Runtime state that changes every poll should stay in Redis unless a dashboard/API requirement needs durable historical querying.

## Future Fields Policy

If a field is not emitted by `mt5_bridge.py` today, do not list it as current schema/contract. Put it under `Future fields` until the bridge emits it and the worker/API actually consumes it.
