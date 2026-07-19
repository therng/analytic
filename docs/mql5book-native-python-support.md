# Native Python support

Source: *MQL5 Programming for Traders*, section 7.9, pages 1998-2038.

MetaTrader 5 integrates with Python through the `MetaTrader5` package, which communicates with a terminal process. The package exposes terminal, account, symbol, quote, tick, market-depth, order, position, deal, margin, profit, and trading operations.

Python integration does not provide MQL5 event handlers such as `OnTick`, `OnBookEvent`, or `OnTradeTransaction`. A Python program must poll for changes or communicate with an MQL5 program through a separate bridge. The package also does not expose indicator readings directly, so the book presents Python as most natural for quote, tick, account-history, statistical, visualization, and machine-learning work.

## Installation and execution

```shell
pip install MetaTrader5
pip install --upgrade MetaTrader5
```

The chapter additionally uses `matplotlib` and `pandas` in its examples:

```shell
pip install matplotlib
pip install pandas
```

Python scripts can be created in MetaEditor, placed under `MQL5/Scripts`, and launched from the terminal Navigator. A script launched on a chart receives the script path, symbol, and timeframe through `sys.argv`. Scripts can also run from MetaEditor, a command line, an IDE, or Jupyter Notebook.

External Python trading follows the terminal's algorithmic-trading controls. When **Disable automatic trading via external Python API** is enabled, Python trading calls return error `10027` (`TRADE_RETCODE_CLIENT_DISABLES_AT`).

## Package overview

| Python API | MQL5 counterpart or purpose |
| --- | --- |
| `initialize` | Connect to, and optionally launch, a terminal |
| `login` | Select a trading account on an established terminal connection |
| `shutdown` | Close the terminal connection |
| `version` | Get terminal version, build, and build date |
| `last_error` | `GetLastError`; uses a separate Python error-code set |
| `account_info` | `AccountInfoInteger`, `AccountInfoDouble`, `AccountInfoString` |
| `terminal_info` | Combined terminal information functions |
| `symbols_total` | `SymbolsTotal`, including custom and disabled symbols |
| `symbols_get` | `SymbolsTotal` plus symbol-information functions |
| `symbol_info` | `SymbolInfoInteger`, `SymbolInfoDouble`, `SymbolInfoString` |
| `symbol_info_tick` | `SymbolInfoTick` |
| `symbol_select` | `SymbolSelect` |
| `market_book_add` | `MarketBookAdd` |
| `market_book_get` | `MarketBookGet` |
| `market_book_release` | `MarketBookRelease` |
| `copy_rates_from` | `CopyRates`, starting from a date and limited by count |
| `copy_rates_from_pos` | `CopyRates`, starting from a bar index |
| `copy_rates_range` | `CopyRates` over a date range |
| `copy_ticks_from` | `CopyTicks`, starting from a time and limited by count |
| `copy_ticks_range` | `CopyTicksRange` over a time range |
| `order_calc_margin` | `OrderCalcMargin` |
| `order_calc_profit` | `OrderCalcProfit` |
| `order_check` | `OrderCheck` |
| `order_send` | `OrderSend` |
| `orders_total` | `OrdersTotal` |
| `orders_get` | `OrdersTotal` plus order-property functions |
| `positions_total` | `PositionsTotal` |
| `positions_get` | `PositionsTotal` plus position-property functions |
| `history_orders_total` | `HistoryOrdersTotal` |
| `history_orders_get` | History order selection and property functions |
| `history_deals_total` | `HistoryDealsTotal` |
| `history_deals_get` | History deal selection and property functions |

Package functions use native Python values. Many return immutable tuples or named tuples; named-tuple fields can be accessed with dot notation or converted with `_asdict()`. Tabular quote and tick functions return NumPy arrays. A failure commonly returns `None` or `False`, after which `last_error()` provides details.

## Connecting to a terminal and account

```python
import MetaTrader5 as mt5

if not mt5.initialize():
    print("initialize failed:", mt5.last_error())
    raise SystemExit

print(mt5.version())

# Work with the connected terminal here.

mt5.shutdown()
```

Signatures presented by the book:

```text
initialize()
initialize(path, account=<ACCOUNT>, password=<PASSWORD>,
           server=<SERVER>, timeout=60000, portable=False)
login(account, password=<PASSWORD>, server=<SERVER>, timeout=60000)
shutdown()
version()
```

`path` is the positional path to `metatrader64.exe`; the remaining `initialize` options are named. Without a path, the package attempts to locate a terminal. Without account credentials, it can reuse the terminal's last account and stored account configuration. `login` switches accounts after terminal initialization. `version()` returns a tuple containing terminal version, build, and build date.

Do not hard-code account credentials in source files.

## Python API errors

`last_error()` returns Python integration errors, not MQL5 runtime errors.

| Constant | Value | Meaning |
| --- | ---: | --- |
| `RES_S_OK` | `1` | Success |
| `RES_E_FAIL` | `-1` | General failure |
| `RES_E_INVALID_PARAMS` | `-2` | Invalid arguments or parameters |
| `RES_E_NO_MEMORY` | `-3` | Memory allocation failure |
| `RES_E_NOT_FOUND` | `-4` | Requested history not found |
| `RES_E_INVALID_VERSION` | `-5` | Unsupported version |
| `RES_E_AUTH_FAILED` | `-6` | Authorization failure |
| `RES_E_UNSUPPORTED` | `-7` | Unsupported method |
| `RES_E_AUTO_TRADING_DISABLED` | `-8` | Algorithmic trading disabled |
| `RES_E_INTERNAL_FAIL` | `-10000` | General internal IPC failure |
| `RES_E_INTERNAL_FAIL_SEND` | `-10001` | IPC send failure |
| `RES_E_INTERNAL_FAIL_RECEIVE` | `-10002` | IPC receive failure |
| `RES_E_INTERNAL_FAIL_INIT` | `-10003` | IPC initialization failure |
| `RES_E_INTERNAL_FAIL_CONNECT` | `-10003` | IPC connection unavailable |
| `RES_E_INTERNAL_FAIL_TIMEOUT` | `-10005` | IPC timeout |

## Account and terminal information

```text
account_info()  -> AccountInfo named tuple or None
terminal_info() -> TerminalInfo named tuple or None
```

These calls return all corresponding account or terminal properties in one named tuple. Use dot notation for one field or `_asdict()` for iteration and conversion to tabular formats.

## Symbols and current ticks

```text
symbol_info(symbol)
symbol_select(symbol, enable=None)
symbols_total()
symbols_get(group="PATTERN")
symbol_info_tick(symbol)
```

- `symbol_info` returns all properties for one symbol.
- `symbol_select` shows or hides a symbol in Market Watch.
- `symbols_total` includes custom and disabled instruments.
- `symbols_get` returns all symbols or filters them with a group pattern.
- `symbol_info_tick` returns the latest tick for a symbol.

Group patterns support `*` as a wildcard and `!` as exclusion. Multiple comma-separated conditions are applied from left to right; for example, include everything first and then exclude selected symbol groups.

## Market depth

```text
market_book_add(symbol)
market_book_get(symbol)
market_book_release(symbol)
```

Subscribe before reading the order book and release the subscription afterward. `market_book_get` returns named `BookInfo` tuples or `None` on error. Because Python has no `OnBookEvent`, the script must poll for updates.

## Bars and ticks

```text
copy_rates_from(symbol, timeframe, date_from, count)
copy_rates_from_pos(symbol, timeframe, start, count)
copy_rates_range(symbol, timeframe, date_from, date_to)

copy_ticks_from(symbol, date_from, count, flags)
copy_ticks_range(symbol, date_from, date_to, flags)
```

Rate functions return NumPy arrays with bar fields such as `time`, `open`, `high`, `low`, `close`, `tick_volume`, `spread`, and `real_volume`. Bar index zero is the current bar.

Tick functions return NumPy arrays containing time, bid, ask, last, volume, millisecond time, flags, and real volume. Tick flags select all ticks, bid/ask changes, or last/volume changes.

MetaTrader stores bar and tick times in UTC. Python `datetime` values should therefore be created in UTC; otherwise the local timezone can shift the requested range. Available history is also limited by the terminal's **Max. bars in chart** setting and downloaded history.

## Margin, profit, and trade requests

```text
order_calc_margin(action, symbol, volume, price)
order_calc_profit(action, symbol, volume, price_open, price_close)
order_check(request)
order_send(request)
```

`order_calc_margin` and `order_calc_profit` return account-currency amounts or `None`. The book recommends calculating margin and expected profit or loss before sending an order.

Both trading functions accept a request dictionary whose fields match `MqlTradeRequest`:

```python
request = {
    "action": mt5.TRADE_ACTION_DEAL,
    "symbol": "USDJPY",
    "volume": 0.1,
    "type": mt5.ORDER_TYPE_BUY,
    "price": mt5.symbol_info_tick("USDJPY").ask,
    "deviation": 20,
    "magic": 234000,
    "comment": "python script",
    "type_time": mt5.ORDER_TIME_GTC,
    "type_filling": mt5.ORDER_FILLING_RETURN,
}

check = mt5.order_check(request)
if check is None:
    print(mt5.last_error())
else:
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        print(result, mt5.last_error())
```

`order_check` returns an `OrderCheckResult` corresponding to `MqlTradeCheckResult`, plus a copy of the request. `order_send` returns an `OrderSendResult` corresponding to `MqlTradeResult`, also with the original request. A successful pre-check does not guarantee server execution; always inspect the send result and `retcode`.

## Active orders and open positions

```text
orders_total()
orders_get()
orders_get(symbol=<SYMBOL>)
orders_get(group=<PATTERN>)
orders_get(ticket=<TICKET>)

positions_total()
positions_get()
positions_get(symbol=<SYMBOL>)
positions_get(group=<PATTERN>)
positions_get(ticket=<TICKET>)
```

`orders_get` returns `TradeOrder` named tuples whose lowercase fields correspond to order properties without the `ORDER_` prefix. `positions_get` returns `TradePosition` named tuples whose fields correspond to position properties without `POSITION_`. The no-argument forms return all active rows; the other forms filter by symbol, group pattern, or ticket. Errors return `None`.

## Order and deal history

```text
history_orders_total(date_from, date_to)
history_orders_get(date_from, date_to, group=<PATTERN>)
history_orders_get(ticket=<ORDER_TICKET>)
history_orders_get(position=<POSITION_ID>)

history_deals_total(date_from, date_to)
history_deals_get(date_from, date_to, group=<PATTERN>)
history_deals_get(ticket=<DEAL_TICKET>)
history_deals_get(position=<POSITION_ID>)
```

Time-range parameters accept Python `datetime` values or Unix timestamps. History getters return `TradeOrder` or `TradeDeal` named tuples, respectively. They can select by time range and symbol group, by ticket, or by position identifier. No matches produce an empty tuple; an error produces `None`.

As with symbol, order, and position groups, history group filters support wildcard inclusion and `!` exclusion and are evaluated left to right.
