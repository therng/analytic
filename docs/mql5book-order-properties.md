# Order properties

Source: *MQL5 Programming for Traders*, section 6.4.23, pages 1292-1296.

Active and historical orders share the same property list, although many values differ between them. Order properties have three value types: integer-compatible, real, and string. Their identifiers belong to `ENUM_ORDER_PROPERTY_INTEGER`, `ENUM_ORDER_PROPERTY_DOUBLE`, and `ENUM_ORDER_PROPERTY_STRING`.

## Integer properties

`ENUM_ORDER_PROPERTY_INTEGER`:

| Identifier | Description | Type |
| --- | --- | --- |
| `ORDER_TYPE` | Order type | `ENUM_ORDER_TYPE` |
| `ORDER_TYPE_FILLING` | Volume execution policy | `ENUM_ORDER_TYPE_FILLING` |
| `ORDER_TYPE_TIME` | Pending-order lifetime policy | `ENUM_ORDER_TYPE_TIME` |
| `ORDER_TIME_EXPIRATION` | Pending-order expiration time | `datetime` |
| `ORDER_MAGIC` | Identifier set by the Expert Advisor that placed the order | `ulong` |
| `ORDER_TICKET` | Unique order ticket assigned by the server | `ulong` |
| `ORDER_STATE` | Order status | `ENUM_ORDER_STATE` |
| `ORDER_REASON` | Order reason or source | `ENUM_ORDER_REASON` |
| `ORDER_TIME_SETUP` | Order placement time | `datetime` |
| `ORDER_TIME_DONE` | Order execution or withdrawal time | `datetime` |
| `ORDER_TIME_SETUP_MSC` | Order placement time in milliseconds | `ulong` |
| `ORDER_TIME_DONE_MSC` | Order execution or withdrawal time in milliseconds | `ulong` |
| `ORDER_POSITION_ID` | Identifier of the position generated or modified when the order executes | `ulong` |
| `ORDER_POSITION_BY_ID` | Opposite-position identifier for `ORDER_TYPE_CLOSE_BY` orders | `ulong` |

Each executed order generates a deal that opens or changes a position. The resulting position identifier is stored in `ORDER_POSITION_ID`.

### Order states

`ENUM_ORDER_STATE`:

| Identifier | Description |
| --- | --- |
| `ORDER_STATE_STARTED` | Checked for correctness but not yet accepted by the server |
| `ORDER_STATE_PLACED` | Accepted by the server |
| `ORDER_STATE_CANCELED` | Canceled by the client or MQL program |
| `ORDER_STATE_PARTIAL` | Partially executed |
| `ORDER_STATE_FILLED` | Filled in full |
| `ORDER_STATE_REJECTED` | Rejected by the server |
| `ORDER_STATE_EXPIRED` | Canceled upon expiration |
| `ORDER_STATE_REQUEST_ADD` | Being registered in the trading system |
| `ORDER_STATE_REQUEST_MODIFY` | Being modified |
| `ORDER_STATE_REQUEST_CANCEL` | Being removed from the trading system |

Only active orders can change state. Filled or canceled historical orders have a fixed state. A partially filled order can be canceled and then appear in history as `ORDER_STATE_CANCELED`. `ORDER_STATE_PARTIAL` applies only to active orders; executed historical orders use `ORDER_STATE_FILLED`.

### Order reasons

`ENUM_ORDER_REASON`:

| Identifier | Description |
| --- | --- |
| `ORDER_REASON_CLIENT` | Placed manually from the desktop terminal |
| `ORDER_REASON_EXPERT` | Placed by an Expert Advisor or script |
| `ORDER_REASON_MOBILE` | Placed from a mobile application |
| `ORDER_REASON_WEB` | Placed from the web terminal |
| `ORDER_REASON_SL` | Placed by the server when Stop Loss triggered |
| `ORDER_REASON_TP` | Placed by the server when Take Profit triggered |
| `ORDER_REASON_SO` | Placed by the server because of a Stop Out event |

## Real properties

`ENUM_ORDER_PROPERTY_DOUBLE`:

| Identifier | Description |
| --- | --- |
| `ORDER_VOLUME_INITIAL` | Initial order volume |
| `ORDER_VOLUME_CURRENT` | Current volume, either initial or remaining after partial execution |
| `ORDER_PRICE_OPEN` | Price specified in the order |
| `ORDER_PRICE_CURRENT` | Current symbol price for an active order, or execution price for a historical order |
| `ORDER_SL` | Stop Loss level |
| `ORDER_TP` | Take Profit level |
| `ORDER_PRICE_STOPLIMIT` | Limit-order placement price triggered by a Stop Limit order |

For an active pending buy order, `ORDER_PRICE_CURRENT` contains the current Ask price; for an active pending sell order, it contains the Bid price. The value is current as of selection with `OrderSelect` or `OrderGetTicket`. For a historical executed order, it contains the execution price, which can differ from the requested price because of slippage.

`ORDER_VOLUME_INITIAL` and `ORDER_VOLUME_CURRENT` differ only while an order is `ORDER_STATE_PARTIAL`. If an order is filled in parts, its historical `ORDER_VOLUME_INITIAL` equals the last filled part; the other fills of the original volume are represented by separate orders and deals.

## String properties

`ENUM_ORDER_PROPERTY_STRING`:

| Identifier | Description |
| --- | --- |
| `ORDER_SYMBOL` | Symbol on which the order is placed |
| `ORDER_COMMENT` | Order comment |
| `ORDER_EXTERNAL_ID` | Order identifier in the external trading system or exchange |

Active and historical order properties use separate sets of reading functions.
