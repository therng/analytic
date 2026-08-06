WHEN: "git pull on VPS", "deploy the bridge update".

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'`
2. Read output. Conflict / detached-HEAD / dirty-worktree → STOP, do not restart.
   Clean, or "Already up to date." → continue.
3. If the pull touched `bridge/` (check `git pull` output for `bridge/` paths), install its runtime deps before restarting — pinned in `bridge/requirements.txt` (psutil/redis are lazy-imported, so `pytest` passing doesn't prove they're installed):
   `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; C:\Python314\python.exe -m pip install -r bridge\requirements.txt"'`
   Add `-r bridge\requirements-dev.txt` instead if the change touched `bridge/tests/` (it already includes `requirements.txt`).
   If the pull touched `bridge/.env.example`, diff it against the live `bridge\.env` for any new required variable — a new var with no default in the running service's env will crash that account's worker at startup, not the supervisor.
4. `ssh forexvps 'nssm restart bridge'` — service `bridge` is installed on forexvps (entrypoint `python -m bridge`); confirm with `nssm status bridge` first. If it errors "no such service", see service-install.md instead of restarting.

FORBIDDEN: combining pull+restart+status into one script — untested against forexvps. Keep as separate steps.
