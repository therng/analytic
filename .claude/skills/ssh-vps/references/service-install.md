WHEN: "install bridge service", "install nssm service", first-time service setup on forexvps.

STATUS: Not runnable yet. `bridge` has no CLI entrypoint (no `main.py`, no `__main__.py`, no `if __name__ == "__main__"` anywhere). Do not run this until one exists — `nssm install` would register a service that immediately crash-loops. Confirm the entrypoint module (e.g. `bridge.main` or a real `__main__.py`) before using AppParameters below; the value here is a placeholder.

SERVICE NAME: `bridge` (matches the package — the old `MT5BridgeV2` name is retired along with `bridge_v2`).

PRIOR SERVICE (removed this session, for reference — same shape to recreate under the new name):
```
Application          : C:\Python314\python.exe
AppDirectory          : C:\analytic
AppParameters         : -m <bridge-entrypoint-module> [args]   # TODO: fill in once bridge ships one
AppEnvironmentExtra   : REDIS_URL=<redis connection string — get from bridge/.env or the prior deploy, never hardcode in this doc or echo it in chat>
DisplayName           : bridge
Start                 : SERVICE_AUTO_START
ObjectName            : LocalSystem
```

DO (once entrypoint confirmed):
1. Confirm nothing already registered: `ssh forexvps 'nssm status bridge'` — must error "no such service" first.
2. Install, one shot, no confirmation prompt:
   ```
   ssh forexvps 'nssm install bridge C:\Python314\python.exe "-m <bridge-entrypoint-module> [args]"'
   ```
3. Set working directory and auto-start:
   ```
   ssh forexvps 'nssm set bridge AppDirectory C:\analytic'
   ssh forexvps 'nssm set bridge Start SERVICE_AUTO_START'
   ```
4. Set the Redis env var without echoing the secret to chat — use `-EncodedCommand` per connection.md, value read from `bridge\.env` on the host, not typed inline in the ssh command:
   ```
   ssh forexvps 'nssm set bridge AppEnvironmentExtra REDIS_URL=%REDIS_URL_FROM_ENV_FILE%'
   ```
5. `ssh forexvps 'nssm start bridge'`, then verify per status-check.md.

SAFETY: confirm with user before step 2 — installing a service is not reversible via a simple undo, and a bad AppParameters value crash-loops silently until someone checks. Never print the Redis URL/password to chat (global safety rule).
