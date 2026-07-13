# account_info() Live Contract

`account_info()` is not a Prisma model. It is one source for the Redis live hash:

```txt
mt5:account:{login}:live
```

## Current Mapping

| MT5 source | Redis live field | Durable target when sampled |
|---|---|---|
| `account_info().login` | `login` | `TradingAccount.accountNo` |
| `account_info().name` | `name` | `TradingAccount.accountName` |
| `account_info().server` | `server` | `TradingAccount.serverName` |
| `account_info().company` | `company` | `TradingAccount.company` |
| `account_info().currency` | `currency` | `TradingAccount.currency` |
| `account_info().trade_mode` | `tradeMode` | Redis live/ops metadata |
| `account_info().limit_orders` | `limitOrders` | Redis live/ops metadata |
| `account_info().margin_so_mode` | `marginSoMode` | Redis live/ops metadata |
| `account_info().balance` | `balance` | `AccountSnapshot.balance`, `EquitySnapshot.balance` |
| `account_info().equity` | `equity` | `AccountSnapshot.equity`, `EquitySnapshot.equity` |
| `account_info().margin` | `margin` | `AccountSnapshot.margin`, `EquitySnapshot.margin` |
| `account_info().margin_free` | `freeMargin` | `AccountSnapshot.freeMargin` |
| `account_info().margin_level` | `marginLevel` | `AccountSnapshot.marginLevel` |
| `account_info().profit` | `profit` | `AccountSnapshot.floatingPl`, `EquitySnapshot.floatingPl` |
| `account_info().credit` | `credit` | `AccountSnapshot.creditFacility` |
| `account_info().leverage` | `leverage` | Redis live/ops metadata |
| `account_info().trade_allowed` | `tradeAllowed` | Redis live/ops metadata |
| `account_info().trade_expert` | `tradeExpert` | Redis live/ops metadata |
| `account_info().margin_mode` | `marginMode` | Redis live/ops metadata |
| `account_info().currency_digits` | `currencyDigits` | Redis live/ops metadata |
| `account_info().fifo_close` | `fifoClose` | Redis live/ops metadata |
| `account_info().margin_so_call` | `marginSoCall` | Redis live/ops metadata |
| `account_info().margin_so_so` | `marginSoSo` | Redis live/ops metadata |
| `account_info().margin_initial` | `marginInitial` | Redis live/ops metadata |
| `account_info().margin_maintenance` | `marginMaintenance` | Redis live/ops metadata |
| `account_info().commission_blocked` | `commissionBlocked` | Redis live/ops metadata |
| `orders_total()` | `ordersTotal` | Redis live/ops metadata |
| `positions_total()` | `positionsTotal` | Redis live/ops metadata |
| `history_orders_total(...)` | `historyOrdersTotal` | Redis live/ops metadata |
| `history_deals_total(...)` | `historyDealsTotal` | Redis live/ops metadata |
| Bridge poll timestamp after history total probe | `historyTotalsUpdatedAt` | Redis live/ops metadata |
| Bridge poll timestamp | `timestamp` | Redis live freshness marker |

## Rule

Persist only stable account identity and financial snapshots that the dashboard/API needs historically. Keep operational/account-permission details in Redis live unless a concrete audit feature needs them.
