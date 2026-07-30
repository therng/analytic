WHEN: "restart bridge", "restart MT5BridgeV2", start/stop bridge service.

STATUS: MT5BridgeV2 is currently uninstalled (removed, not just stopped) — `nssm status MT5BridgeV2` will error. `bridge` has no CLI entrypoint to point a service at yet. Check status first; if missing, there's nothing to start/stop/restart until it's reinstalled against a real entrypoint.

DO:
```
ssh forexvps 'nssm start MT5BridgeV2'
ssh forexvps 'nssm stop MT5BridgeV2'
ssh forexvps 'nssm restart MT5BridgeV2'
```

RESTART = graceful shutdown (CTRL_BREAK_EVENT, Redis locks release) → fresh discovery + respawn. 1 child per account, not per terminal.

USE AFTER: `bridge\.env` change, terminal closed that needs to come back, stuck heartbeat.

SAFETY: confirm before restart unless user explicitly asked.
