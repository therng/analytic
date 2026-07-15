# Equity Runtime State Contract

`equity-state` is Redis runtime state, not a Prisma model.

Source:

```txt
Redis hash: mt5:account:{login}:equity-state
MT5 API: account_info()
Tracking code: bridge/tracking.py
```

Purpose:

```txt
Track running peak equity across bridge polls.
Let the worker compute current drawdown for EquitySnapshot.
Reseed equity tracking after bridge restart.
```

## Current State Shape

| Field             | Description                              |
| ----------------- | ---------------------------------------- |
| `peakEquity`      | highest equity seen by bridge            |
| `peakEquityTs`    | unix timestamp when peak equity was seen |
| `trackingStartTs` | unix timestamp when tracking began       |

Current logic:

```txt
peakEquity = max(previous_peak_equity, account_info().equity)
drawdown = max(0, peakEquity - current_equity)
```

## Durable Models

Use existing models for persisted data:

| Persistent need                       | Existing model    |
| ------------------------------------- | ----------------- |
| Latest account financial snapshot     | `AccountSnapshot` |
| Intraday equity/balance/margin sample | `EquitySnapshot`  |

Do not add:

```txt
EquityState
```

## Future Fields

These are derived or not tracked in Redis today:

```txt
balance
equity
margin
free_margin
margin_level
credit
floating_profit
drawdown_percent
max_drawdown_money
max_drawdown_percent
max_drawdown_at
last_ping
status
created_at
updated_at
```

Keep them in `:live`, `AccountSnapshot`, or `EquitySnapshot` as appropriate. Do not duplicate them in a new state table.
