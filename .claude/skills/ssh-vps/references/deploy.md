WHEN: "git pull on VPS", "deploy the bridge update".

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'`
2. Read output. Conflict / detached-HEAD / dirty-worktree → STOP, do not restart.
   Clean, or "Already up to date." → continue.
3. If the pull touched `bridge/` (check `git pull` output for `bridge/` paths), install its deps per `bridge/README.md` before anything tries to import it:
   `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; C:\Python314\python.exe -m pip install pydantic"'`
   Add `pytest hypothesis` too if the change touched `bridge/tests/`.
4. `ssh forexvps 'nssm restart bridge'` — only if that service exists (`nssm status bridge`). It currently does not: `bridge` has no CLI entrypoint yet, so there is nothing to point a service at. Skip this step until one is installed (see service-install.md).

FORBIDDEN: combining pull+restart+status into one script — untested against forexvps. Keep as separate steps.
