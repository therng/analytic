WHEN: "restart bridge", "restart bridge", start/stop bridge service.

STATUS: bridge is currently uninstalled (removed, not just stopped) — `nssm status bridge` will error. `bridge` has no CLI entrypoint to point a service at yet. Check status first; if missing, there's nothing to start/stop/restart until it's reinstalled against a real entrypoint.

DO:
```
ssh forexvps 'nssm start bridge'
ssh forexvps 'nssm stop bridge'
ssh forexvps 'nssm restart bridge'
```

RESTART = graceful shutdown (CTRL_BREAK_EVENT, Redis locks release) → fresh discovery + respawn. 1 child per account, not per terminal.

USE AFTER: `bridge\.env` change, terminal closed that needs to come back, stuck heartbeat.

SAFETY: confirm before restart unless user explicitly asked.
