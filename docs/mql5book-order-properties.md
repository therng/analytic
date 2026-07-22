# Order properties

Source: *MQL5 Programming for Traders*, section 6.4.23, pages 1292-1296.

Active and historical orders share same property list, values differ between them. Order properties three value types: integer-compatible, real, string. Identifiers belong to `ENUM_ORDER_PROPERTY_INTEGER`, `ENUM_ORDER_PROPERTY_DOUBLE`, `ENUM_ORDER_PROPERTY_STRING`.

## Integer properties

`ENUM_ORDER_PROPERTY_INTEGER`:

| Identifier | Description | Type |
| --- | --- | --- |
| `ORDER_TYPE` | Order type | `ENUM_ORDER_TYPE` |
| `ORDER_TYPE_FILLING` | Volume execution policy | `ENUM_ORDER_TYPE_FILLING` |
| `ORDER_TYPE_TIME` | Pending-order lifetime policy | `ENUM_ORDER_TYPE_TIME` |
| `ORDER_TIME_EXPIRATION` | Pending-order expiration time | `datetime` |
| `ORDER_MAGIC` | Identifier set by Expert Advisor that placed order | `ulong` |
| `ORDER_TICKET` | Unique order ticket assigned by server | `ulong` |
| `ORDER_STATE` | Order status | `ENUM_ORDER_STATE` |
| `ORDER_REASON` | Order reason/source | `ENUM_ORDER_REASON` |
| `ORDER_TIME_SETUP` | Order placement time | `datetime` |
| `ORDER_TIME_DONE` | Order execution/withdrawal time | `datetime` |
| `ORDER_TIME_SETUP_MSC` | Order placement time, milliseconds | `ulong` |
| `ORDER_TIME_DONE_MSC` | Order execution/withdrawal time, milliseconds | `ulong` |
| `ORDER_POSITION_ID` | Position identifier generated/modified when order executes | `ulong` |
| `ORDER_POSITION_BY_ID` | Opposite-position identifier for `ORDER_TYPE_CLOSE_BY` orders | `ulong` |

Each executed order generates deal opening/changing position. Resulting position identifier stored in `ORDER_POSITION_ID`.

### Order states

`ENUM_ORDER_STATE`:

| Identifier | Description |
| --- | --- |
| `ORDER_STATE_STARTED` | Checked for correctness, not yet accepted by server |
| `ORDER_STATE_PLACED` | Accepted by server |
| `ORDER_STATE_CANCELED` | Canceled by client or MQL program |
| `ORDER_STATE_PARTIAL` | Partially executed |
| `ORDER_STATE_FILLED` | Filled in full |
| `ORDER_STATE_REJECTED` | Rejected by server |
| `ORDER_STATE_EXPIRED` | Canceled upon expiration |
| `ORDER_STATE_REQUEST_ADD` | Being registered in trading system |
| `ORDER_STATE_REQUEST_MODIFY` | Being modified |
| `ORDER_STATE_REQUEST_CANCEL` | Being removed from trading system |

Only active orders change state. Filled/canceled historical orders fixed state. Partially filled order can be canceled, appears in history as `ORDER_STATE_CANCELED`. `ORDER_STATE_PARTIAL` applies only to active orders; executed historical orders use `ORDER_STATE_FILLED`.

### Order reasons

`ENUM_ORDER_REASON`:

| Identifier | Description |
| --- | --- |
| `ORDER_REASON_CLIENT` | Placed manually from desktop terminal |
| `ORDER_REASON_EXPERT` | Placed by Expert Advisor or script |
| `ORDER_REASON_MOBILE` | Placed from mobile application |
| `ORDER_REASON_WEB` | Placed from web terminal |
| `ORDER_REASON_SL` | Placed by server when Stop Loss triggered |
| `ORDER_REASON_TP` | Placed by server when Take Profit triggered |
| `ORDER_REASON_SO` | Placed by server, Stop Out event |

## Real properties

`ENUM_ORDER_PROPERTY_DOUBLE`:

| Identifier | Description |
| --- | --- |
| `ORDER_VOLUME_INITIAL` | Initial order volume |
| `ORDER_VOLUME_CURRENT` | Current volume, initial or remaining after partial execution |
| `ORDER_PRICE_OPEN` | Price specified in order |
| `ORDER_PRICE_CURRENT` | Current symbol price for active order, or execution price for historical order |
| `ORDER_SL` | Stop Loss level |
| `ORDER_TP` | Take Profit level |
| `ORDER_PRICE_STOPLIMIT` | Limit-order placement price triggered by Stop Limit order |

For active pending buy order, `ORDER_PRICE_CURRENT` holds current Ask price; active pending sell order, Bid price. Value current as of selection via `OrderSelect` or `OrderGetTicket`. For historical executed order, holds execution price — can differ from requested price due slippage.

`ORDER_VOLUME_INITIAL` and `ORDER_VOLUME_CURRENT` differ only while order `ORDER_STATE_PARTIAL`. If order filled in parts, historical `ORDER_VOLUME_INITIAL` equals last filled part; other fills of original volume represented by separate orders/deals.

## String properties

`ENUM_ORDER_PROPERTY_STRING`:

| Identifier | Description |
| --- | --- |
| `ORDER_SYMBOL` | Symbol order placed on |
| `ORDER_COMMENT` | Order comment |
| `ORDER_EXTERNAL_ID` | Order identifier in external trading system/exchange |

Active and historical order properties use separate sets of reading functions.