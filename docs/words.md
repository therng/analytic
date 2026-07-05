## Header / Metadata

| HTML Placeholder | JSON Path | Type | Notes |

|---|---|---|---|

| `<!--ACCOUNT-->` | `meta.account_number` | string | Numeric digits only; also appears in `<title>` |

| `<!--NAME-->` | `meta.owner_name` | string | Account holder name |

| `<!--COMPANY-->` | `meta.company` | string | Broker company name |

| `<!--CURRENCY-->` | `meta.currency` | string | e.g. "USD" |

| `<!--SERVER-->` | `meta.server` | string | Broker server name |

| `<!--DATE-->` | `meta.report_timestamp` | ISO-8601 | Bangkok time (+07:00) |

| `<!--ACCOUNT_TYPE-->` | `meta.account_type` | string | "Real" / "Demo" |

| `<!--ACCOUNT_MARGIN_TYPE-->` | `meta.margin_type` | string | "Hedging" / "Netting" |

---

## Positions Table (closed trades)

| HTML Placeholder | JSON Key | Type | Notes |

|---|---|---|---|

| `<!--POSITION_TIME-->` | `open_time` | ISO-8601 | Position open timestamp |

| `<!--POSITION_POSITION-->` | `position_no` | string | Unique ID per account |

| `<!--POSITION_SYMBOL-->` | `symbol` | string | e.g. "EURUSD" |

| `<!--POSITION_TYPE-->` | `type` | string | "buy" / "sell" |

| `<!--POSITION_VOLUME-->` | `volume` | float | Lot size |

| `<!--POSITION_PRICE-->` | `open_price` | float | Entry price |

| `<!--POSITION_SL-->` | `sl` | float\|null | Stop loss; null if not set |

| `<!--POSITION_TP-->` | `tp` | float\|null | Take profit; null if not set |

| `<!--POSITION_TIME_CLOSE-->` | `close_time` | ISO-8601 | Position close timestamp |

| `<!--POSITION_PRICE_CLOSE-->` | `close_price` | float | Exit price |

| `<!--POSITION_COMMISSION-->` | `commission` | float | Negative value |

| `<!--POSITION_SWAP-->` | `swap` | float | Overnight interest; negative if charged |

| `<!--POSITION_PROFIT-->` | `profit` | float | Raw MT5 profit (excludes swap/commission) |

| `<!--POSITION_COMMENT-->` | `comment` | string\|null | EA comment or manual tag |

**Derived field (not in HTML):**

```

net_pnl = profit + swap + commission

```

---

## Orders Table (historical orders — informational only)

| HTML Placeholder | JSON Key | Type |

|---|---|---|

| `<!--ORDER_OPEN_TIME-->` | `open_time` | ISO-8601 |

| `<!--ORDER_ORDER-->` | `order_id` | string |

| `<!--ORDER_SYMBOL-->` | `symbol` | string |

| `<!--ORDER_TYPE-->` | `type` | string |

| `<!--ORDER_VOLUME-->` | `volume` | float |

| `<!--ORDER_PRICE-->` | `price` | float |

| `<!--ORDER_SL-->` | `sl` | float\|null |

| `<!--ORDER_TP-->` | `tp` | float\|null |

| `<!--ORDER_TIME-->` | `close_time` | ISO-8601 |

| `<!--ORDER_STATE-->` | `state` | string |

| `<!--ORDER_COMMENT-->` | `comment` | string\|null |

---

## Deals Table (full ledger including balance operations)

| HTML Placeholder | JSON Key | Type | Notes |

|---|---|---|---|

| `<!--DEAL_TIME-->` | `time` | ISO-8601 | Execution timestamp |

| `<!--DEAL_DEAL-->` | `deal_id` | string | Unique ledger entry ID |

| `<!--DEAL_SYMBOL-->` | `symbol` | string\|null | Blank for balance ops |

| `<!--DEAL_TYPE-->` | `type` | string | "buy"/"sell"/"balance"/"credit" |

| `<!--DEAL_DIRECTION-->` | `direction` | string\|null | "in"/"out"; null for balance ops |

| `<!--DEAL_VOLUME-->` | `volume` | float | 0 for balance ops |

| `<!--DEAL_PRICE-->` | `price` | float\|null | Execution price |

| `<!--DEAL_ORDER-->` | `order_id` | string\|null | Linked order |

| `<!--DEAL_COMMISSION-->` | `commission` | float | Negative value |

| `<!--DEAL_FEE-->` | `fee` | float | Additional fee (e.g. funding fee) |

| `<!--DEAL_STORAGE-->` | `swap` | float | Overnight interest (storage) |

| `<!--DEAL_PROFIT-->` | `profit` | float | P/L for this deal |

| `<!--DEAL_BALANCE-->` | `balance_after` | float\|null | Running account balance after deal |

| `<!--DEAL_COMMENT-->` | `comment` | string\|null | |

**Deal classification:**

```

trading_deal  → symbol is not null AND direction is not null

balance_deal  → type in ("balance", "credit")  — deposit, withdrawal, credit

```

---

## Open Positions Table

| HTML Placeholder | JSON Key | Type | Notes |

|---|---|---|---|

| `<!--POSITION_TIME-->` | `open_time` | ISO-8601 | When position was opened |

| `<!--POSITION_POSITION-->` | `position_id` | string | |

| `<!--POSITION_SYMBOL-->` | `symbol` | string | |

| `<!--POSITION_TYPE-->` | `type` | string | "buy" / "sell" |

| `<!--POSITION_VOLUME-->` | `volume` | float | |

| `<!--POSITION_PRICE-->` | `open_price` | float | |

| `<!--POSITION_SL-->` | `sl` | float\|null | |

| `<!--POSITION_TP-->` | `tp` | float\|null | |

| `<!--POSITION_PRICE_CURRENT-->` | `market_price` | float | Current market price |

| `<!--POSITION_SWAP-->` | `swap` | float | |

| `<!--POSITION_PROFIT-->` | `floating_profit` | float | Current unrealized P/L |

| `<!--POSITION_COMMENT-->` | `comment` | string\|null | |

---

## Working Orders Table

| HTML Placeholder | JSON Key | Type | Notes |

|---|---|---|---|

| `<!--ORDER_OPEN_TIME-->` | `open_time` | ISO-8601 | Order placement time |

| `<!--ORDER_ORDER-->` | `order_id` | string | |

| `<!--ORDER_SYMBOL-->` | `symbol` | string | |

| `<!--ORDER_TYPE-->` | `type` | string | "buy_limit", "sell_stop", etc. |

| `<!--ORDER_VOLUME-->` | `volume_requested` | float | |

| `<!--ORDER_PRICE-->` | `price` | float | Trigger price |

| `<!--ORDER_SL-->` | `sl` | float\|null | |

| `<!--ORDER_TP-->` | `tp` | float\|null | |

| `<!--ORDER_PRICE_CURRENT-->` | `market_price` | float | |

| `<!--ORDER_STATE-->` | `state` | string | "Working" / "Partial" |

| `<!--ORDER_COMMENT-->` | `comment` | string\|null | |
