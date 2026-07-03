# Standardized MT5 Report JSON Schema

All parsers targeting this skill should output exactly this structure.

```json
{
  "meta": {
    "account_number": "12345678",
    "owner_name": "John Doe",
    "company": "FX Broker Ltd",
    "currency": "USD",
    "server": "FXBroker-Live",
    "account_type": "Real",
    "margin_type": "Hedging",
    "report_timestamp": "2024-06-15T17:00:00+07:00",
    "file_hash": "sha256:abcdef1234567890..."
  },

  "summary": {
    "balance": 10250.00,
    "credit_facility": 0.00,
    "equity": 10180.50,
    "margin": 450.00,
    "free_margin": 9730.50,
    "floating_pl": -69.50,
    "margin_level": 2262.33
  },

  "metrics": {
    "total_net_profit": 1250.00,
    "gross_profit": 3400.00,
    "gross_loss": -2150.00,
    "total_commission": -180.00,
    "total_swap": -45.00,
    "profit_factor": 1.58,
    "expected_payoff": 12.50,
    "recovery_factor": 2.10,
    "sharpe_ratio": 0.85,
    "total_trades": 100,
    "drawdown": {
      "absolute": 500.00,
      "maximal_amount": 800.00,
      "maximal_pct": 8.50,
      "relative_pct": 12.30,
      "relative_amount": 650.00
    },
    "win_stats": {
      "short_total": 45,
      "short_won": 28,
      "long_total": 55,
      "long_won": 38,
      "profit_trades": 66,
      "loss_trades": 34,
      "largest_profit_trade": 450.00,
      "largest_loss_trade": -280.00,
      "average_profit_trade": 51.52,
      "average_loss_trade": -63.24,
      "max_consecutive_wins_count": 8,
      "max_consecutive_wins_amount": 450.00,
      "max_consecutive_losses_count": 5,
      "max_consecutive_losses_amount": -280.00,
      "maximal_consecutive_profit_amount": 650.00,
      "maximal_consecutive_profit_count": 7,
      "maximal_consecutive_loss_amount": -420.00,
      "maximal_consecutive_loss_count": 4,
      "average_consecutive_wins": 3.2,
      "average_consecutive_losses": 2.1
    }
  },

  "positions": [
    {
      "position_no": "1234567",
      "symbol": "EURUSD",
      "type": "buy",
      "volume": 0.10,
      "open_time": "2024-05-01T09:30:00+07:00",
      "open_price": 1.08520,
      "sl": 1.08200,
      "tp": 1.09000,
      "close_time": "2024-05-01T14:45:00+07:00",
      "close_price": 1.08850,
      "commission": -0.70,
      "swap": 0.00,
      "profit": 33.00,
      "comment": "EA_v3",
      "net_pnl": 32.30
    }
  ],

  "deals": [
    {
      "deal_id": "9876543",
      "time": "2024-05-01T09:30:00+07:00",
      "symbol": "EURUSD",
      "type": "buy",
      "direction": "in",
      "volume": 0.10,
      "price": 1.08520,
      "order_id": "1234567",
      "commission": -0.35,
      "fee": 0.00,
      "swap": 0.00,
      "profit": 0.00,
      "balance_after": 10200.00,
      "comment": null
    },
    {
      "deal_id": "9876544",
      "time": "2024-05-01T14:45:00+07:00",
      "symbol": "EURUSD",
      "type": "sell",
      "direction": "out",
      "volume": 0.10,
      "price": 1.08850,
      "order_id": "1234568",
      "commission": -0.35,
      "fee": 0.00,
      "swap": 0.00,
      "profit": 33.00,
      "balance_after": 10232.30,
      "comment": null
    },
    {
      "deal_id": "9876500",
      "time": "2024-01-02T10:00:00+07:00",
      "symbol": null,
      "type": "balance",
      "direction": null,
      "volume": 0,
      "price": null,
      "order_id": null,
      "commission": 0.00,
      "fee": 0.00,
      "swap": 0.00,
      "profit": 10000.00,
      "balance_after": 10000.00,
      "comment": "Initial deposit"
    }
  ],

  "open_positions": [
    {
      "position_id": "1234999",
      "open_time": "2024-06-15T10:00:00+07:00",
      "symbol": "GBPUSD",
      "type": "sell",
      "volume": 0.05,
      "open_price": 1.27450,
      "sl": 1.27800,
      "tp": 1.26900,
      "market_price": 1.27840,
      "swap": -0.20,
      "floating_profit": -19.50,
      "comment": null
    }
  ],

  "working_orders": [
    {
      "order_id": "1235001",
      "open_time": "2024-06-15T08:00:00+07:00",
      "symbol": "USDJPY",
      "type": "buy_limit",
      "volume_requested": 0.10,
      "price": 157.200,
      "sl": 156.800,
      "tp": 158.000,
      "market_price": 157.450,
      "state": "Working",
      "comment": null
    }
  ]
}
```

---

## Field Type Reference

| Type | Description |
|---|---|
| `string` | Always present, may be empty string `""` |
| `string\|null` | Optional — null if not set/applicable |
| `float` | Always a number; 0.0 if not applicable |
| `float\|null` | Optional — null if not set (e.g. SL/TP when not configured) |
| `int` | Integer count |
| `ISO-8601` | e.g. `"2024-06-15T17:00:00+07:00"` — always Bangkok (+07:00) |

## Invariants

- `positions` sorted ascending by `open_time`
- `deals` sorted ascending by `time`
- `net_pnl` on positions = `profit + swap + commission` (always pre-computed)
- `balance_after` on deals traces the running balance; only present on deal rows that change balance
- `meta.currency` defaults to `"USD"` if not found in report
- `meta.server` defaults to `"UNKNOWN"` if not found
- `metrics.drawdown.*` all five sub-fields always present (0.0 if not computed)
