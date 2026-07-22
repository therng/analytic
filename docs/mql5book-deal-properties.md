# Deal properties

Source: *MQL5 Programming for Traders*, section 6.4.29, pages 1335-1339.

Deal records: trading operation performed from order. One order → multiple deals via partial execution or opposite-position closing.

Deal properties: three basic value types — integer-compatible, real, string. Identifiers belong to `ENUM_DEAL_PROPERTY_INTEGER`, `ENUM_DEAL_PROPERTY_DOUBLE`, `ENUM_DEAL_PROPERTY_STRING`. Read via `HistoryDealGet` functions after selecting required order and deal history.

## Integer properties

`ENUM_DEAL_PROPERTY_INTEGER`:

| Identifier | Description | Type |
| --- | --- | --- |
| `DEAL_TICKET` | Unique deal ticket | `ulong` |
| `DEAL_ORDER` | Ticket of order deal executed from | `ulong` |
| `DEAL_TIME` | Deal time | `datetime` |
| `DEAL_TIME_MSC` | Deal time in milliseconds | `ulong` |
| `DEAL_TYPE` | Deal type | `ENUM_DEAL_TYPE` |
| `DEAL_ENTRY` | Deal direction: market entry, market exit, reversal, or close by | `ENUM_DEAL_ENTRY` |
| `DEAL_MAGIC` | Deal magic number, based on `ORDER_MAGIC` | `ulong` |
| `DEAL_REASON` | Deal reason or source | `ENUM_DEAL_REASON` |
| `DEAL_POSITION_ID` | ID of position opened, modified, or closed by deal | `ulong` |

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
| `DEAL_TYPE_COMMISSION_DAILY` | Commission charged end of trading day |
| `DEAL_TYPE_COMMISSION_MONTHLY` | Commission charged end of month |
| `DEAL_TYPE_COMMISSION_AGENT_DAILY` | Agent commission charged end of trading day |
| `DEAL_TYPE_COMMISSION_AGENT_MONTHLY` | Agent commission charged end of month |
| `DEAL_TYPE_INTEREST` | Interest accrual on free funds |
| `DEAL_TYPE_BUY_CANCELED` | Canceled buy deal |
| `DEAL_TYPE_SELL_CANCELED` | Canceled sell deal |
| `DEAL_DIVIDEND` | Dividend accrual |
| `DEAL_DIVIDEND_FRANKED` | Accrual of franked dividend (tax exempt) |
| `DEAL_TAX` | Tax accrual |

Earlier deal canceled: type changes `DEAL_TYPE_BUY`/`DEAL_TYPE_SELL` → corresponding canceled type, profit/loss reset zero. Previously recorded profit/loss credited or debited as separate balance operation.

### Deal entries

`ENUM_DEAL_ENTRY` — how deal changes position:

| Identifier | Description |
| --- | --- |
| `DEAL_ENTRY_IN` | Market entry |
| `DEAL_ENTRY_OUT` | Market exit |
| `DEAL_ENTRY_INOUT` | Reversal |
| `DEAL_ENTRY_OUT_BY` | Closing by opposite position |

Reversal by opposite deal: netting accounts only.

### Deal reasons

`ENUM_DEAL_REASON`:

| Identifier | Description |
| --- | --- |
| `DEAL_REASON_CLIENT` | Order triggered from desktop terminal |
| `DEAL_REASON_MOBILE` | Order triggered from mobile app |
| `DEAL_REASON_WEB` | Order triggered from web platform |
| `DEAL_REASON_EXPERT` | Order triggered by Expert Advisor or script |
| `DEAL_REASON_SL` | Stop Loss triggered |
| `DEAL_REASON_TP` | Take Profit triggered |
| `DEAL_REASON_SO` | Stop Out event |
| `DEAL_REASON_ROLLOVER` | Position transfer to new day |
| `DEAL_REASON_VMARGIN` | Addition/deduction of variation margin |
| `DEAL_REASON_SPLIT` | Split (lower price) of instrument holding position |

## Real properties

`ENUM_DEAL_PROPERTY_DOUBLE`:

| Identifier | Description |
| --- | --- |
| `DEAL_VOLUME` | Deal volume |
| `DEAL_PRICE` | Deal price |
| `DEAL_COMMISSION` | Deal commission |
| `DEAL_SWAP` | Accumulated swap at close |
| `DEAL_PROFIT` | Financial result of deal |
| `DEAL_FEE` | Fee charged immediately after deal |
| `DEAL_SL` | Stop Loss level |
| `DEAL_TP` | Take Profit level |

Entry/reversal deal: `DEAL_SL`/`DEAL_TP` from order that opened/expanded position. Exit deal: from position at close time.

## String properties

`ENUM_DEAL_PROPERTY_STRING`:

| Identifier | Description |
| --- | --- |
| `DEAL_SYMBOL` | Symbol deal made for |
| `DEAL_COMMENT` | Deal comment |
| `DEAL_EXTERNAL_ID` | Deal ID in external trading system (exchange) |

Book demonstrates reading these properties later with `HistoryDealGet` functions through `DealMonitor` and `DealFilter` classes.