# Position properties

Source: *MQL5 Programming for Traders*, section 6.4.27, pages 1323-1325.

Position properties have three value types: integer-compatible, real, string. IDs belong to `ENUM_POSITION_PROPERTY_INTEGER`, `ENUM_POSITION_PROPERTY_DOUBLE`, `ENUM_POSITION_PROPERTY_STRING`. Read with `PositionGet` functions.

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
| `POSITION_IDENTIFIER` | Unique ID assigned when position opens; unchanged whole lifetime | `ulong` |
| `POSITION_REASON` | Reason position opened | `ENUM_POSITION_REASON` |

`POSITION_IDENTIFIER` usually matches ticket of order that opened position. Related orders/deals expose it as `ORDER_POSITION_ID` and `DEAL_POSITION_ID` — useful for finding full history of position.

Partially filled order can leave both position and active pending order with matching tickets. Position closes before remaining order volume fills → another position, same ticket, can appear later.

Netting accounts: reversing position changes existing position, no new one created. `POSITION_IDENTIFIER` stays unchanged. New position for symbol created only after previous hits zero volume.

`POSITION_TIME_UPDATE` changes only on volume change — partial close or position increase. SL/TP/swap changes don't update it.

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
| `POSITION_REASON_CLIENT` | Order triggered, placed from desktop terminal |
| `POSITION_REASON_MOBILE` | Order triggered, placed from mobile app |
| `POSITION_REASON_WEB` | Order triggered, placed from web platform |
| `POSITION_REASON_EXPERT` | Order triggered, placed by Expert Advisor or script |

## Real properties

`ENUM_POSITION_PROPERTY_DOUBLE`:

| Identifier | Description |
| --- | --- |
| `POSITION_VOLUME` | Position volume |
| `POSITION_PRICE_OPEN` | Position open price |
| `POSITION_SL` | Stop Loss price |
| `POSITION_TP` | Take Profit price |
| `POSITION_PRICE_CURRENT` | Current symbol price, used to close position |
| `POSITION_SWAP` | Accumulated swap |
| `POSITION_PROFIT` | Current profit |

`POSITION_PRICE_CURRENT` follows price needed to close position. Long position closes by selling → current price is Bid price.

## String properties

`ENUM_POSITION_PROPERTY_STRING`:

| Identifier | Description |
| --- | --- |
| `POSITION_SYMBOL` | Symbol position open on |
| `POSITION_COMMENT` | Position comment |
| `POSITION_EXTERNAL_ID` | Position ID in external trading system or exchange |