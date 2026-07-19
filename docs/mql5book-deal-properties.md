# Deal properties

Source: *MQL5 Programming for Traders*, section 6.4.29, pages 1335-1339.

A deal records that a trading operation was performed from an order. One order can generate multiple deals through partial execution or opposite-position closing.

Deal properties have three basic value types: integer-compatible, real, and string. Their identifiers belong to `ENUM_DEAL_PROPERTY_INTEGER`, `ENUM_DEAL_PROPERTY_DOUBLE`, and `ENUM_DEAL_PROPERTY_STRING`. Read them with the `HistoryDealGet` functions after selecting the required order and deal history.

## Integer properties

`ENUM_DEAL_PROPERTY_INTEGER`:

| Identifier | Description | Type |
| --- | --- | --- |
| `DEAL_TICKET` | Unique deal ticket | `ulong` |
| `DEAL_ORDER` | Ticket of the order from which the deal was executed | `ulong` |
| `DEAL_TIME` | Deal time | `datetime` |
| `DEAL_TIME_MSC` | Deal time in milliseconds | `ulong` |
| `DEAL_TYPE` | Deal type | `ENUM_DEAL_TYPE` |
| `DEAL_ENTRY` | Deal direction: market entry, market exit, reversal, or close by | `ENUM_DEAL_ENTRY` |
| `DEAL_MAGIC` | Deal magic number, based on `ORDER_MAGIC` | `ulong` |
| `DEAL_REASON` | Deal reason or source | `ENUM_DEAL_REASON` |
| `DEAL_POSITION_ID` | Identifier of the position opened, modified, or closed by the deal | `ulong` |

### Deal types

`ENUM_DEAL_TYPE`:

| Identifier | Description |
| --- | --- |
| `DEAL_TYPE_BUY` | Buy |
| `DEAL_TYPE_SELL` | Sell |
| `DEAL_TYPE_BALANCE` | Balance accrued |
| `DEAL_TYPE_CREDIT` | Credit accrual |
| `DEAL_TYPE_CHARGE` | Additional charges |
| `DEAL_TYPE_CORRECTION` | Correction |
| `DEAL_TYPE_BONUS` | Bonuses |
| `DEAL_TYPE_COMMISSION` | Additional commission |
| `DEAL_TYPE_COMMISSION_DAILY` | Commission charged at the end of the trading day |
| `DEAL_TYPE_COMMISSION_MONTHLY` | Commission charged at the end of the month |
| `DEAL_TYPE_COMMISSION_AGENT_DAILY` | Agent commission charged at the end of the trading day |
| `DEAL_TYPE_COMMISSION_AGENT_MONTHLY` | Agent commission charged at the end of the month |
| `DEAL_TYPE_INTEREST` | Interest accrual on free funds |
| `DEAL_TYPE_BUY_CANCELED` | Canceled buy deal |
| `DEAL_TYPE_SELL_CANCELED` | Canceled sell deal |
| `DEAL_DIVIDEND` | Dividend accrual |
| `DEAL_DIVIDEND_FRANKED` | Accrual of a franked dividend (tax exempt) |
| `DEAL_TAX` | Tax accrual |

When an earlier deal is canceled, its type changes from `DEAL_TYPE_BUY` or `DEAL_TYPE_SELL` to the corresponding canceled type and its profit or loss is reset to zero. The previously recorded profit or loss is then credited or debited as a separate balance operation.

### Deal entries

`ENUM_DEAL_ENTRY` describes how a deal changes a position:

| Identifier | Description |
| --- | --- |
| `DEAL_ENTRY_IN` | Market entry |
| `DEAL_ENTRY_OUT` | Market exit |
| `DEAL_ENTRY_INOUT` | Reversal |
| `DEAL_ENTRY_OUT_BY` | Closing by an opposite position |

Reversal by an opposite deal is supported only on netting accounts.

### Deal reasons

`ENUM_DEAL_REASON`:

| Identifier | Description |
| --- | --- |
| `DEAL_REASON_CLIENT` | Triggering of an order placed from the desktop terminal |
| `DEAL_REASON_MOBILE` | Triggering of an order placed from a mobile application |
| `DEAL_REASON_WEB` | Triggering of an order placed from the web platform |
| `DEAL_REASON_EXPERT` | Triggering of an order placed by an Expert Advisor or script |
| `DEAL_REASON_SL` | Stop Loss order triggered |
| `DEAL_REASON_TP` | Take Profit order triggered |
| `DEAL_REASON_SO` | Stop Out event |
| `DEAL_REASON_ROLLOVER` | Position transfer to a new day |
| `DEAL_REASON_VMARGIN` | Addition or deduction of variation margin |
| `DEAL_REASON_SPLIT` | Split (lower price) of the instrument on which there was a position |

## Real properties

`ENUM_DEAL_PROPERTY_DOUBLE`:

| Identifier | Description |
| --- | --- |
| `DEAL_VOLUME` | Deal volume |
| `DEAL_PRICE` | Deal price |
| `DEAL_COMMISSION` | Deal commission |
| `DEAL_SWAP` | Accumulated swap at close |
| `DEAL_PROFIT` | Financial result of the deal |
| `DEAL_FEE` | Fee charged immediately after the deal |
| `DEAL_SL` | Stop Loss level |
| `DEAL_TP` | Take Profit level |

For an entry or reversal deal, `DEAL_SL` and `DEAL_TP` come from the order that opened or expanded the position. For an exit deal, they come from the position at the time it was closed.

## String properties

`ENUM_DEAL_PROPERTY_STRING`:

| Identifier | Description |
| --- | --- |
| `DEAL_SYMBOL` | Symbol for which the deal was made |
| `DEAL_COMMENT` | Deal comment |
| `DEAL_EXTERNAL_ID` | Deal identifier in the external trading system (on the exchange) |

The book demonstrates reading these properties later with the `HistoryDealGet` functions through the `DealMonitor` and `DealFilter` classes.
