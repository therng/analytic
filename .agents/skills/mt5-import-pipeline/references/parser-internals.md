# MT5 Parser Internals — `src/lib/parser/index.ts`

## Full Template Placeholder → Field Mapping

### Positions table

| Placeholder | Field | Type | Notes |
|---|---|---|---|
| `<!--POSITION_TIME-->` | `openTime` | Date | Bangkok timezone |
| `<!--POSITION_POSITION-->` | `positionNo` | string | Unique per account |
| `<!--POSITION_SYMBOL-->` | `symbol` | string | |
| `<!--POSITION_TYPE-->` | `type` | string | "buy" / "sell" |
| `<!--POSITION_VOLUME-->` | `volume` | number | Lots |
| `<!--POSITION_PRICE-->` | `openPrice` | number | |
| `<!--POSITION_SL-->` | `sl` | number | |
| `<!--POSITION_TP-->` | `tp` | number | |
| `<!--POSITION_TIME_CLOSE-->` | `closeTime` | Date | Bangkok timezone |
| `<!--POSITION_PRICE_CLOSE-->` | `closePrice` | number | |
| `<!--POSITION_COMMISSION-->` | `commission` | number | Negative value |
| `<!--POSITION_SWAP-->` | `swap` | number | Negative value |
| `<!--POSITION_PROFIT-->` | `profit` | number | Raw MT5 profit, excludes swap+commission |

**positionNetPnl** = `profit + swap + commission` — always use all three.

### Deals table

| Placeholder | Field | Type | Notes |
|---|---|---|---|
| `<!--DEAL_TIME-->` | `time` | Date | Bangkok timezone |
| `<!--DEAL_DEAL-->` | `dealId` | string | Unique per account |
| `<!--DEAL_SYMBOL-->` | `symbol` | string | Blank for balance ops |
| `<!--DEAL_TYPE-->` | `type` | string | "buy" / "sell" / "balance" / "credit" |
| `<!--DEAL_DIRECTION-->` | `direction` | string | "in" / "out" |
| `<!--DEAL_VOLUME-->` | `volume` | number | |
| `<!--DEAL_PRICE-->` | `price` | number | |
| `<!--DEAL_ORDER-->` | `orderId` | string | |
| `<!--DEAL_COMMISSION-->` | `commission` | number | |
| `<!--DEAL_STORAGE-->` | `swap` | number | Storage fee = swap |
| `<!--DEAL_PROFIT-->` | `profit` | number | |
| `<!--DEAL_BALANCE-->` | `balanceAfter` | number | Balance after deal closes |

### Summary block (label:value pairs)

Matched by `summaryFieldFromLabel()`:

| Label | Field |
|---|---|
| Balance | `balance` |
| Credit Facility | `credit_facility` |
| Equity | `equity` |
| Margin | `margin` |
| Free Margin | `free_margin` |
| Floating P/L | `floating_pl` |
| Margin Level | `margin_level` |

### Details block (label:value pairs)

Matched by `reportResultFieldFromLabel()`:

| Label | Field | Format |
|---|---|---|
| Total Net Profit | `total_net_profit` | plain number |
| Gross Profit | `gross_profit` | plain number |
| Gross Loss | `gross_loss` | plain number (negative stored) |
| Profit Factor | `profit_factor` | plain number |
| Expected Payoff | `expected_payoff` | plain number |
| Recovery Factor | `recovery_factor` | plain number |
| Sharpe Ratio | `sharpe_ratio` | plain number |
| Balance Drawdown Absolute | `balance_drawdown_absolute` | plain number |
| Balance Drawdown Maximal | `balance_drawdown_maximal` / `balance_drawdown_maximal_pct` | `amount (percent%)` |
| Balance Drawdown Relative | `balance_drawdown_relative_pct` / `balance_drawdown_relative` | `percent% (amount)` — reversed |
| Total Trades | `total_trades` | plain number |
| Short Trades Won | `short_trades` / `short_trades_won_pct` | `count (percent%)` |
| Long Trades Won | `long_trades` / `long_trades_won_pct` | `count (percent%)` |
| Profit Trades | `profit_trades` / `profit_trades_pct` | `count (percent%)` |
| Loss Trades | `loss_trades` / `loss_trades_pct` | `count (percent%)` |
| Maximum Consecutive Wins | `max_consecutive_wins` / `max_consecutive_wins_amount` | `count ($amount)` |
| Maximal Consecutive Profit | `maximal_consecutive_profit` / `maximal_consecutive_profit_count` | `$amount (count)` — reversed |
| Maximum Consecutive Losses | `max_consecutive_losses` / `max_consecutive_losses_amount` | `count ($amount)` |
| Maximal Consecutive Loss | `maximal_consecutive_loss` / `maximal_consecutive_loss_count` | `$amount (count)` — reversed |

**Drawdown format trap:**
- Maximal DD: `"800.00 (8.50%)"` → `amount=800.00`, `pct=8.50`
- Relative DD: `"12.30% (650.00)"` → `pct=12.30`, `amount=650.00`

**Consecutive format trap:**
- `Maximum Consecutive Wins ($)` → `count ($amount)` — count first
- `Maximal Consecutive Profit (count)` → `$amount (count)` — amount first

---

## Section Detection Algorithm

`inferTableSection()` identifies which section a `<table>` belongs to:

1. Checks first 3 rows of the current table for a section header text
2. If not found, checks up to 6 preceding sibling elements for a header element

`detectSection()` normalizes text (lowercase, trim, collapse whitespace) and matches against regexes. **Order matters**: "Open Positions" must be checked before "Positions" to avoid false-matching the shorter string.

Section detection returns one of: `positions`, `orders`, `deals`, `open_positions`, `working_orders`, `summary`, `details`, or `unknown`.

---

## Header Map Pattern

Once the section is identified, `isLikelyHeaderRow()` scans table rows for a header row by checking for known tokens (`"time"`, `"symbol"`, `"profit"`, `"price"`, etc.).

`buildHeaderMap()` creates `Map<normalizedLabel → columnIndex[]>`. Multiple aliases per column are supported (e.g. "deal" and "ticket" both map to deal ID column).

Row extraction uses `findColumnIndex(headerMap, [aliases...])` with fallback positional indexes for resilience against MT5 locale variants.

---

## Adding a New Field

1. Add to the relevant TypeScript interface (e.g. `PositionRow`, `DealLedgerRow`)
2. Add a `getMappedCell()` or `getMappedNumber()` call in the `parse*Row()` function with column name aliases
3. If it's a new top-level field, add to `ParsedReport`
4. For summary/details label-based fields: add a new entry to `summaryFieldFromLabel()` or `reportResultFieldFromLabel()` maps with all known label variants (MT5 labels can differ by language)
5. Update the relevant Prisma model and run `npx prisma migrate dev`

---

## Common Parse Failure Patterns

| Symptom | Root Cause | Fix |
|---|---|---|
| Position row returns null | `openPrice` or `closePrice` ≤ 0, or commission/swap/profit columns missing | Check for "comment rows" bleeding into data rows |
| Wrong sign on number | `(1,234.56)` parentheses mean negative | `parseNumber()` handles this; verify input doesn't have double-wrapping |
| NBSP parse error | Non-breaking space (`\xa0`) in number string | `parseNumber()` strips NBSP before `parseFloat()` |
| Date parse failure | Locale mismatch or UTC-stored legacy report | `parseBangkokDate()` in `src/lib/time.ts`; worker applies `LEGACY_REPORT_TIME_SHIFT_MS` (7-hour) for old format |
| Missing account number | Parser couldn't find account metadata rows | Check HTML for account number row near top of document |
| Deals missing `balanceAfter` | Balance column not found or zero | Verify `<!--DEAL_BALANCE-->` template is present; may need positional fallback |
| Section misidentified | "Positions" matched before "Open Positions" | Check `detectSection()` regex order — longer names must come first |

---

## ParsedReport Full Interface

```ts
interface ParsedReport {
  fileHash: string;
  metadata: {
    account_number: string;   // numeric string, ≥5 digits
    owner_name: string;
    company: string;
    currency: string;         // "USD", "THB", etc.
    server: string;
    report_timestamp: string; // ISO-8601 with +07:00
  };
  dealLedger: DealLedgerRow[];
  positions: PositionRow[];
  openPositions: OpenPositionRow[];
  workingOrders: WorkingOrderRow[];
  accountSummary: {
    balance: number;
    credit_facility: number;
    equity: number;
    margin: number;
    free_margin: number;
    floating_pl: number;
    margin_level: number;
  };
  reportResults?: {
    total_net_profit: number;
    gross_profit: number;
    gross_loss: number;
    profit_factor: number;
    expected_payoff: number;
    recovery_factor: number;
    sharpe_ratio: number;
    balance_drawdown_absolute: number;
    balance_drawdown_maximal: number;
    balance_drawdown_maximal_pct: number;
    balance_drawdown_relative: number;
    balance_drawdown_relative_pct: number;
    total_trades: number;
    short_trades: number;
    short_trades_won_pct: number;
    long_trades: number;
    long_trades_won_pct: number;
    profit_trades: number;
    profit_trades_pct: number;
    loss_trades: number;
    loss_trades_pct: number;
    max_consecutive_wins: number;
    max_consecutive_wins_amount: number;
    maximal_consecutive_profit: number;
    maximal_consecutive_profit_count: number;
    max_consecutive_losses: number;
    max_consecutive_losses_amount: number;
    maximal_consecutive_loss: number;
    maximal_consecutive_loss_count: number;
  };
}
```
