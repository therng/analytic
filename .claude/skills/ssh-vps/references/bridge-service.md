WHEN: "restart bridge", "restart MT5BridgeV2", start/stop bridge service.

DO:
```
ssh forexvps 'nssm start MT5BridgeV2'
ssh forexvps 'nssm stop MT5BridgeV2'
ssh forexvps 'nssm restart MT5BridgeV2'
```

RESTART = graceful shutdown (CTRL_BREAK_EVENT, Redis locks release) → fresh discovery + respawn. 1 child per account, not per terminal.

USE AFTER: `bridge\.env` change, terminal closed that needs to come back, stuck heartbeat.

SAFETY: confirm before restart unless user explicitly asked.
