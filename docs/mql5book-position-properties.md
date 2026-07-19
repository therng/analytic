# Position properties

Source: *MQL5 Programming for Traders*, section 6.4.27, pages 1323-1325.

Position properties have three value types: integer-compatible, real, and string. Their identifiers belong to `ENUM_POSITION_PROPERTY_INTEGER`, `ENUM_POSITION_PROPERTY_DOUBLE`, and `ENUM_POSITION_PROPERTY_STRING`. Read them with the `PositionGet` functions.

## Integer properties

`ENUM_POSITION_PROPERTY_INTEGER`:

| Identifier | Description | Type |
| --- | --- | --- |
| `POSITION_TICKET` | Position ticket | `ulong` |
| `POSITION_TIME` | Position opening time | `datetime` |
| `POSITION_TIME_MSC` | Position opening time in milliseconds | `ulong` |
| `POSITION_TIME_UPDATE` | Position volume change time | `datetime` |
| `POSITION_TIME_UPDATE_MSC` | Position volume change time in milliseconds | `ulong` |
| `POSITION_TYPE` | Position type | `ENUM_POSITION_TYPE` |
| `POSITION_MAGIC` | Position magic number, based on `ORDER_MAGIC` | `ulong` |
| `POSITION_IDENTIFIER` | Unique identifier assigned when the position opens; unchanged throughout its lifetime | `ulong` |
| `POSITION_REASON` | Reason for opening the position | `ENUM_POSITION_REASON` |

`POSITION_IDENTIFIER` usually matches the ticket of the order that opened the position. Related orders and deals expose it as `ORDER_POSITION_ID` and `DEAL_POSITION_ID`, making it useful for finding the complete history of a position.

A partially filled order can leave both a position and an active pending order with matching tickets. If that position closes before the remaining order volume fills, another position with the same ticket can appear later.

On netting accounts, reversing a position changes the existing position rather than creating a new one, so `POSITION_IDENTIFIER` remains unchanged. A new position for the symbol is created only after the previous position reaches zero volume.

`POSITION_TIME_UPDATE` changes only when volume changes, such as after a partial close or position increase. Changes to Stop Loss, Take Profit, or swap do not update it.

### Position types

`ENUM_POSITION_TYPE`:

| Identifier | Description |
| --- | --- |
| `POSITION_TYPE_BUY` | Buy |
| `POSITION_TYPE_SELL` | Sell |

### Position reasons

`ENUM_POSITION_REASON`:

| Identifier | Description |
| --- | --- |
| `POSITION_REASON_CLIENT` | Triggering of an order placed from the desktop terminal |
| `POSITION_REASON_MOBILE` | Triggering of an order placed from a mobile application |
| `POSITION_REASON_WEB` | Triggering of an order placed from the web platform |
| `POSITION_REASON_EXPERT` | Triggering of an order placed by an Expert Advisor or script |

## Real properties

`ENUM_POSITION_PROPERTY_DOUBLE`:

| Identifier | Description |
| --- | --- |
| `POSITION_VOLUME` | Position volume |
| `POSITION_PRICE_OPEN` | Position open price |
| `POSITION_SL` | Stop Loss price |
| `POSITION_TP` | Take Profit price |
| `POSITION_PRICE_CURRENT` | Current symbol price used to close the position |
| `POSITION_SWAP` | Accumulated swap |
| `POSITION_PROFIT` | Current profit |

`POSITION_PRICE_CURRENT` follows the price needed to close the position. For example, a long position closes by selling, so its current price is the Bid price.

## String properties

`ENUM_POSITION_PROPERTY_STRING`:

| Identifier | Description |
| --- | --- |
| `POSITION_SYMBOL` | Symbol on which the position is open |
| `POSITION_COMMENT` | Position comment |
| `POSITION_EXTERNAL_ID` | Position identifier in the external trading system or exchange |
