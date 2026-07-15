# Position Runtime State Contract

`position-state` is Redis runtime state, not a Prisma model.

Source:

```txt
Redis hash: mt5:account:{login}:position-state
Hash key: position ticket
Hash value: JSON PositionTrack state
```

Purpose:

```txt
Track running MAE/MFE while a position is still open.
Copy final MAE/MFE into position-closed-stream when the position closes.
Reseed tracker after bridge restart.
```

## Current State Shape

| Field          | Description                                        |
| -------------- | -------------------------------------------------- |
| `ticket`       | MT5 position ticket                                |
| `symbol`       | symbol                                             |
| `positionType` | MT5 position type (`0 = buy`, `1 = sell`)          |
| `volume`       | lot size at first seen                             |
| `entryPrice`   | open price at first seen                           |
| `firstSeenTs`  | first timestamp seen by bridge                     |
| `mae`          | worst running floating profit, money value, `<= 0` |
| `mfe`          | best running floating profit, money value, `>= 0`  |

Current logic:

```txt
mae = min(previous_mae, current_position.profit)
mfe = max(previous_mfe, current_position.profit)
```

## Not Prisma

Do not add:

```txt
PositionState
```

Reason: this state changes every poll and is only needed to enrich close events and survive bridge restarts.

## Future Fields

These were in the old note but are not tracked today:

```txt
current_price
swap
floating_pnl_net
mae_price
mfe_price
peak_profit
max_drawdown_from_peak
max_drawdown_from_peak_max
status
closed_at
last_seen_at
created_at
updated_at
```

If needed later, add them first to `tracking.py` and `mt5_bridge.py`, then update tests and downstream consumers.
