WHEN: service exists but crash-looping / paused / stale config. Most "install bridge service" requests land here first — service already exists on forexvps.

**SSH command patterns:** See command-execution-strategy.md (Tier 1 for all nssm/status commands below).

CHECK: `ssh forexvps 'nssm get bridge AppParameters'` — expect `-m bridge`. Anything else (old placeholder) → crash-loops.
If `ssh forexvps 'nssm status bridge'` errors "no such service" → not installed at all, use service-install.md FRESH INSTALL instead.

FIX:
1. `ssh forexvps 'nssm set bridge AppParameters -m bridge'`
2. `ssh forexvps 'nssm set bridge AppDirectory C:\analytic'` — confirm, don't assume.
3. `ssh forexvps 'nssm get bridge AppEnvironmentExtra'` — confirm `BRIDGE_STATE_DIR` and `BRIDGE_STATE_DIR_WINDOWS` are set to the **same** absolute path (`C:\analytic\bridge\state`). Mismatch silently splits health/quarantine state from where the child looks — fix via `nssm set bridge AppEnvironmentExtra "..."` (full var list in service-install.md if starting from nothing).
4. Confirm log paths / rotation / stop-method (`AppStdout`, `AppStderr`, `AppRotateFiles=1`, `AppStopMethodConsole=25000`) are set — `nssm set bridge <Key> <Value>` per key, no bulk-set. Full expected values: service-install.md "Expected config".
5. `ssh forexvps 'nssm start bridge'`, then verify per status-check.md (health JSON under state dir, not the old Redis heartbeat key).

Pending-deletion quirk: after `nssm remove`, the registry key can stay in limbo — `Get-Service`/`nssm status` report missing even though `nssm set` still works. Retry `nssm status bridge` a few times, clears on its own.

Config values, preflight requirements (portable mode, ObjectName, permissions), and the install script path — service-install.md.

SAFETY: confirm with user before config changes and before `nssm start` — not reversible via simple undo, bad value crash-loops silently. Never print the Redis URL/password to chat.
