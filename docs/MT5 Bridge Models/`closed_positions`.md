# Closed Positions Contract

Closed positions should map into the existing Prisma `Position` model. Do not create a new `ClosedPosition` model.

Source:

```txt
Redis stream: mt5:account:{login}:position-closed-stream
MT5 APIs: history_deals_get(position=...)
Runtime state: mt5:account:{login}:position-state before ticket is removed
```

Current close events do not use `history_orders_get()` as an enrichment source.
The position-closed stream is built from `history_deals_get(position=...)` plus
the Redis position-state tracker. The tracker owns entry fields and final
MAE/MFE when a live position disappears; deal history supplies the exit-side
fields when MT5 history is visible.

## Current Payload

| Bridge field   | Durable target         | Notes                                           |
| -------------- | ---------------------- | ----------------------------------------------- |
| `ticket`       | `Position.positionNo`  | position/ticket id                              |
| `symbol`       | `Position.symbol`      | symbol                                          |
| `positionType` | `Position.type`        | `0 = buy`, `1 = sell`                           |
| `volume`       | `Position.volume`      | lot size                                        |
| `entryTime`    | `Position.openTime`    | unix seconds                                    |
| `entryPrice`   | `Position.openPrice`   | tracker-owned entry price                       |
| `exitTime`     | `Position.closeTime`   | unix seconds                                    |
| `exitPrice`    | `Position.closePrice`  | may be null while MT5 history lags              |
| `commission`   | `Position.commission`  | defaults to `0` if missing                      |
| `swap`         | `Position.swap`        | defaults to `0` if missing                      |
| `profit`       | `Position.profit`      | raw MT5 profit, excludes swap/commission        |
| `dealTicket`   | worker mapper metadata | exit deal ticket when deal history is available |
| `orderTicket`  | worker mapper metadata | copied from the exit deal `order` field         |
| `mae`          | `Position.mae`         | copied from runtime position-state              |
| `mfe`          | `Position.mfe`         | copied from runtime position-state              |
| `comment`      | `Position.comment`     | last meaningful MT5 comment                     |

Derived value:

```txt
net_pnl = profit + swap + commission
```

Keep `net_pnl` derived. Do not store it as a separate column unless a measured query/report need appears.

## Current Enrichment Boundary

Close events do not currently enrich from order history. `orders-stream` still
publishes raw order history from `history_orders_get(...)`, but
`position-closed-stream` does not join against those orders today. Treat
`orderTicket` as the exit deal's order reference, not as data sourced from a
separate order-history lookup.

## Existing Durable Model

Use:

```txt
Position
```

Do not add:

```txt
ClosedPosition
```

## Future Fields

These were in the old note but are not current contract fields because the bridge does not reliably emit/source them in close events yet:

```txt
sl
tp
magic
reason
mae_price
mfe_price
max_drawdown_from_peak
max_drawdown_from_peak_max
created_at
updated_at
```

Add them only after `mt5_bridge.py` emits them and the worker/API has a concrete use for historical querying.
