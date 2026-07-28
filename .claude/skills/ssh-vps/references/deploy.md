WHEN: "git pull on VPS", "deploy the bridge update".

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'`
2. Read output. Conflict / detached-HEAD / dirty-worktree → STOP, do not restart.
   Clean, or "Already up to date." → continue.
3. `ssh forexvps 'nssm restart MT5BridgeV2'`

FORBIDDEN: combining pull+restart+status into one script — untested against forexvps. Keep as 2 separate steps.
