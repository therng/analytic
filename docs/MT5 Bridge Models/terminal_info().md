# terminal_info() Live/Ops Contract

`terminal_info()` is not business data and should not become a Prisma model by default.

It is written into:

```txt
mt5:account:{login}:live
```

Use it for bridge/terminal monitoring and freshness decisions.

## Current Mapping

| MT5 source                              | Redis live field               | Persist?                   |
| --------------------------------------- | ------------------------------ | -------------------------- |
| `terminal_info().community_account`     | `terminalCommunityAccount`     | No, ops status             |
| `terminal_info().community_connection`  | `terminalCommunityConnection`  | No, ops status             |
| `terminal_info().connected`             | `terminalConnected`            | No, ops status             |
| `terminal_info().trade_allowed`         | `terminalTradeAllowed`         | No, ops status             |
| `terminal_info().tradeapi_disabled`     | `terminalTradeapiDisabled`     | No, ops status             |
| `terminal_info().ftp_enabled`           | `terminalFtpEnabled`           | No, ops status             |
| `terminal_info().notifications_enabled` | `terminalNotificationsEnabled` | No, ops status             |
| `terminal_info().build`                 | `terminalBuild`                | No, ops status             |
| `terminal_info().maxbars`               | `terminalMaxbars`              | No, ops status             |
| `terminal_info().ping_last`             | `terminalPingLast`             | No, ops status             |
| `terminal_info().name`                  | `terminalName`                 | No, ops status             |
| `terminal_info().path`                  | `terminalPath`                 | No, local machine metadata |
| `terminal_info().data_path`             | `terminalDataPath`             | No, local machine metadata |
| `terminal_info().commondata_path`       | `terminalCommondataPath`       | No, local machine metadata |

## Rule

Do not persist terminal path/build/ping fields unless there is an explicit ops audit requirement. For the trading dashboard, Redis live status is enough.
