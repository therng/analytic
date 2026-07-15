# Open Positions Contract

Open positions should align with the existing Prisma `OpenPosition` model. Do not create another `OpenPosition`/`open_positions` table.

Source:

```txt
Redis key: mt5:account:{login}:positions
MT5 API: positions_get()
Durable sampler: src/worker/equity-sampler.ts
```

## Current Redis Payload

| Bridge field   | MT5 source               | Durable target                              |
| -------------- | ------------------------ | ------------------------------------------- |
| `ticket`       | `position.ticket`        | `OpenPosition.positionNo`                   |
| `symbol`       | `position.symbol`        | `OpenPosition.symbol`                       |
| `type`         | `position.type`          | `OpenPosition.type` (`0 = buy`, `1 = sell`) |
| `volume`       | `position.volume`        | `OpenPosition.volume`                       |
| `openPrice`    | `position.price_open`    | `OpenPosition.price`                        |
| `currentPrice` | `position.price_current` | `OpenPosition.marketPrice`                  |
| `sl`           | `position.sl`            | `OpenPosition.sl`                           |
| `tp`           | `position.tp`            | `OpenPosition.tp`                           |
| `profit`       | `position.profit`        | `OpenPosition.profit`                       |
| `swap`         | `position.swap`          | `OpenPosition.swap`                         |
| `comment`      | `position.comment`       | `OpenPosition.comment`                      |
| `openTime`     | `position.time`          | `OpenPosition.openTime`                     |

The worker writes `reportDate` from sampler time.

## Existing Durable Model

Use:

```txt
OpenPosition
```

## Runtime Behavior

`:positions` has a short TTL. If it is stale/missing, the sampler should not overwrite durable current-state rows with stale live data.

## Future Fields

These fields are useful but are not emitted by `mt5_bridge.py` today:

```txt
magic
reason
identifier
```

Choose one path before documenting them as current contract:

```txt
A. Add them to mt5_bridge.py pos_data, Redis types, worker mapping, and tests
B. Keep them out of the current contract
```
