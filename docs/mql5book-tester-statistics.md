# Getting testing financial statistics: `TesterStatistics`

Source: *MQL5 Programming for Traders*, section 6.5.6, pages 1466-1478.

`TesterStatistics` expose financial + trading metrics calculated for one Expert Advisor run in strategy tester. Expert Advisor can inspect individual metrics or combine into custom optimization criterion.

```mql5
double TesterStatistics(ENUM_STATISTICS statistic)
```

Function returns requested `ENUM_STATISTICS` value as `double`, including statistics conceptually integer counts. Call from `OnTester` or `OnDeinit` after tester run. Monetary values expressed in deposit currency.

## Financial and ratio statistics

| Identifier | Description |
| --- | --- |
| `STAT_INITIAL_DEPOSIT` | Initial deposit |
| `STAT_WITHDRAWAL` | Funds withdrawn from account |
| `STAT_PROFIT` | Final net profit or loss: `STAT_GROSS_PROFIT + STAT_GROSS_LOSS` |
| `STAT_GROSS_PROFIT` | Sum of profitable trades; greater than or equal to zero |
| `STAT_GROSS_LOSS` | Sum of losing trades; less than or equal to zero |
| `STAT_MAX_PROFITTRADE` | Largest profitable trade; greater than or equal to zero |
| `STAT_MAX_LOSSTRADE` | Largest losing trade; less than or equal to zero |
| `STAT_CONPROFITMAX` | Max total profit in consecutive winning series |
| `STAT_MAX_CONWINS` | Total profit in longest winning series |
| `STAT_CONLOSSMAX` | Max total loss in consecutive losing series |
| `STAT_MAX_CONLOSSES` | Total loss in longest losing series |
| `STAT_BALANCEMIN` | Minimum balance |
| `STAT_BALANCE_DD` | Max balance drawdown in deposit currency |
| `STAT_BALANCEDD_PERCENT` | Balance drawdown percentage recorded at `STAT_BALANCE_DD` |
| `STAT_BALANCE_DDREL_PERCENT` | Max relative balance drawdown percentage |
| `STAT_BALANCE_DD_RELATIVE` | Balance drawdown in deposit currency recorded at `STAT_BALANCE_DDREL_PERCENT` |
| `STAT_EQUITYMIN` | Minimum equity |
| `STAT_EQUITY_DD` | Max equity drawdown in deposit currency |
| `STAT_EQUITYDD_PERCENT` | Equity drawdown percentage recorded at `STAT_EQUITY_DD` |
| `STAT_EQUITY_DDREL_PERCENT` | Max relative equity drawdown percentage |
| `STAT_EQUITY_DD_RELATIVE` | Equity drawdown in deposit currency recorded at `STAT_EQUITY_DDREL_PERCENT` |
| `STAT_EXPECTED_PAYOFF` | Expected payoff: net profit divided by number of trades |
| `STAT_PROFIT_FACTOR` | Profit factor based on gross profit + gross loss; `DBL_MAX` when gross loss zero |
| `STAT_RECOVERY_FACTOR` | Recovery factor: `STAT_PROFIT / STAT_BALANCE_DD` |
| `STAT_SHARPE_RATIO` | Sharpe ratio |
| `STAT_MIN_MARGINLEVEL` | Minimum margin level reached |
| `STAT_CUSTOM_ONTESTER` | Custom optimization criterion returned by `OnTester` |

Paired drawdown fields describe two different extrema:

- `*_DD` largest monetary drawdown; `*DD_PERCENT` percentage at same point.
- `*_DDREL_PERCENT` largest percentage drawdown; `*_DD_RELATIVE` monetary drawdown at same point.

## Count statistics

Though counts, `TesterStatistics` still returns as `double`.

| Identifier | Description |
| --- | --- |
| `STAT_DEALS` | Total completed deals |
| `STAT_TRADES` | Trades, defined here as deals that exit market |
| `STAT_PROFIT_TRADES` | Profitable trades |
| `STAT_LOSS_TRADES` | Losing trades |
| `STAT_SHORT_TRADES` | Short trades |
| `STAT_LONG_TRADES` | Long trades |
| `STAT_PROFIT_SHORTTRADES` | Profitable short trades |
| `STAT_PROFIT_LONGTRADES` | Profitable long trades |
| `STAT_PROFITTRADES_AVGCON` | Average length of consecutive winning series |
| `STAT_LOSSTRADES_AVGCON` | Average length of consecutive losing series |
| `STAT_CONPROFITMAX_TRADES` | Trades forming max-profit winning series, `STAT_CONPROFITMAX` |
| `STAT_MAX_CONPROFIT_TRADES` | Trades in longest winning series, `STAT_MAX_CONWINS` |
| `STAT_CONLOSSMAX_TRADES` | Trades forming max-loss losing series, `STAT_CONLOSSMAX` |
| `STAT_MAX_CONLOSS_TRADES` | Trades in longest losing series, `STAT_MAX_CONLOSSES` |

## Reading every statistic

Book demonstrates iterating through `ENUM_STATISTICS` until invalid enum value sets `_LastError`:

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

Then calls helper after testing from `OnDeinit`:

```mql5
void OnDeinit(const int)
{
   TesterRecord stats[];
   TesterRecord::fill(stats);
   ArrayPrint(stats, 2);
}
```

Section uses these results to motivate combined Expert Advisor quality metric returned later from `OnTester`. Most of pages 1469-1476 implement example `BandOsMA.mq5` strategy used to generate demonstration statistics; strategy not part of `TesterStatistics` API.