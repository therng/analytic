# Getting testing financial statistics: `TesterStatistics`

Source: *MQL5 Programming for Traders*, section 6.5.6, pages 1466-1478.

`TesterStatistics` exposes the financial and trading metrics calculated for one Expert Advisor run in the strategy tester. An Expert Advisor can inspect individual metrics or combine them into a custom optimization criterion.

```mql5
double TesterStatistics(ENUM_STATISTICS statistic)
```

The function returns the requested `ENUM_STATISTICS` value as a `double`, including statistics that conceptually represent integer counts. Call it from `OnTester` or `OnDeinit` after a tester run. Monetary values are expressed in the deposit currency.

## Financial and ratio statistics

| Identifier | Description |
| --- | --- |
| `STAT_INITIAL_DEPOSIT` | Initial deposit |
| `STAT_WITHDRAWAL` | Funds withdrawn from the account |
| `STAT_PROFIT` | Final net profit or loss: `STAT_GROSS_PROFIT + STAT_GROSS_LOSS` |
| `STAT_GROSS_PROFIT` | Sum of profitable trades; greater than or equal to zero |
| `STAT_GROSS_LOSS` | Sum of losing trades; less than or equal to zero |
| `STAT_MAX_PROFITTRADE` | Largest profitable trade; greater than or equal to zero |
| `STAT_MAX_LOSSTRADE` | Largest losing trade; less than or equal to zero |
| `STAT_CONPROFITMAX` | Maximum total profit in a consecutive winning series |
| `STAT_MAX_CONWINS` | Total profit in the longest winning series |
| `STAT_CONLOSSMAX` | Maximum total loss in a consecutive losing series |
| `STAT_MAX_CONLOSSES` | Total loss in the longest losing series |
| `STAT_BALANCEMIN` | Minimum balance |
| `STAT_BALANCE_DD` | Maximum balance drawdown in deposit currency |
| `STAT_BALANCEDD_PERCENT` | Balance drawdown percentage recorded at `STAT_BALANCE_DD` |
| `STAT_BALANCE_DDREL_PERCENT` | Maximum relative balance drawdown percentage |
| `STAT_BALANCE_DD_RELATIVE` | Balance drawdown in deposit currency recorded at `STAT_BALANCE_DDREL_PERCENT` |
| `STAT_EQUITYMIN` | Minimum equity |
| `STAT_EQUITY_DD` | Maximum equity drawdown in deposit currency |
| `STAT_EQUITYDD_PERCENT` | Equity drawdown percentage recorded at `STAT_EQUITY_DD` |
| `STAT_EQUITY_DDREL_PERCENT` | Maximum relative equity drawdown percentage |
| `STAT_EQUITY_DD_RELATIVE` | Equity drawdown in deposit currency recorded at `STAT_EQUITY_DDREL_PERCENT` |
| `STAT_EXPECTED_PAYOFF` | Expected payoff: net profit divided by the number of trades |
| `STAT_PROFIT_FACTOR` | Profit factor based on gross profit and gross loss; `DBL_MAX` when gross loss is zero |
| `STAT_RECOVERY_FACTOR` | Recovery factor: `STAT_PROFIT / STAT_BALANCE_DD` |
| `STAT_SHARPE_RATIO` | Sharpe ratio |
| `STAT_MIN_MARGINLEVEL` | Minimum margin level reached |
| `STAT_CUSTOM_ONTESTER` | Custom optimization criterion returned by `OnTester` |

The paired drawdown fields describe two different extrema:

- `*_DD` is the largest monetary drawdown, while `*DD_PERCENT` is the percentage at that same point.
- `*_DDREL_PERCENT` is the largest percentage drawdown, while `*_DD_RELATIVE` is the monetary drawdown at that same point.

## Count statistics

Although these are counts, `TesterStatistics` still returns them as `double` values.

| Identifier | Description |
| --- | --- |
| `STAT_DEALS` | Total completed deals |
| `STAT_TRADES` | Trades, defined here as deals that exit the market |
| `STAT_PROFIT_TRADES` | Profitable trades |
| `STAT_LOSS_TRADES` | Losing trades |
| `STAT_SHORT_TRADES` | Short trades |
| `STAT_LONG_TRADES` | Long trades |
| `STAT_PROFIT_SHORTTRADES` | Profitable short trades |
| `STAT_PROFIT_LONGTRADES` | Profitable long trades |
| `STAT_PROFITTRADES_AVGCON` | Average length of a consecutive winning series |
| `STAT_LOSSTRADES_AVGCON` | Average length of a consecutive losing series |
| `STAT_CONPROFITMAX_TRADES` | Trades forming the maximum-profit winning series, `STAT_CONPROFITMAX` |
| `STAT_MAX_CONPROFIT_TRADES` | Trades in the longest winning series, `STAT_MAX_CONWINS` |
| `STAT_CONLOSSMAX_TRADES` | Trades forming the maximum-loss losing series, `STAT_CONLOSSMAX` |
| `STAT_MAX_CONLOSS_TRADES` | Trades in the longest losing series, `STAT_MAX_CONLOSSES` |

## Reading every statistic

The book demonstrates iterating through `ENUM_STATISTICS` until an invalid enum value sets `_LastError`:

```mql5
struct TesterRecord
{
   string feature;
   double value;

   static void fill(TesterRecord &stats[])
   {
      ResetLastError();
      for(int i = 0; ; ++i)
      {
         const double value = TesterStatistics((ENUM_STATISTICS)i);
         if(_LastError) return;

         TesterRecord record =
         {
            EnumToString((ENUM_STATISTICS)i),
            value
         };
         PUSH(stats, record);
      }
   }
};
```

It then calls the helper after testing from `OnDeinit`:

```mql5
void OnDeinit(const int)
{
   TesterRecord stats[];
   TesterRecord::fill(stats);
   ArrayPrint(stats, 2);
}
```

The section uses these results to motivate a combined Expert Advisor quality metric returned later from `OnTester`. Most of pages 1469-1476 implement the example `BandOsMA.mq5` strategy used to generate the demonstration statistics; that strategy is not part of the `TesterStatistics` API.
