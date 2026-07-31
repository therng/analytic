WHEN: "restart bridge", start/stop bridge service.

STATUS: service `bridge` is installed on forexvps, entrypoint = `python -m bridge`. Check status first — `ssh forexvps 'nssm status bridge'` — before acting:
- `SERVICE_RUNNING` → normal restart/stop as below.
- `SERVICE_PAUSED` or crash-looping → check `ssh forexvps 'nssm get bridge AppParameters'` matches `-m bridge` before starting; a stale placeholder value from before the entrypoint existed will crash-loop again. Fix via service-install.md's verify/repair steps, not a plain `nssm start`.
- errors "no such service" → not installed here after all; use service-install.md instead.

DO:
```
ssh forexvps 'nssm start bridge'
ssh forexvps 'nssm stop bridge'
ssh forexvps 'nssm restart bridge'
```

RESTART = graceful shutdown (CTRL_BREAK_EVENT, Redis locks release) → fresh discovery + respawn. 1 child per account, not per terminal.

USE AFTER: `bridge\.env` change, terminal closed that needs to come back, stuck heartbeat.

SAFETY: confirm before restart unless user explicitly asked.
