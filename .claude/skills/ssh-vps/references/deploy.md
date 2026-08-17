WHEN: "git pull on VPS", "deploy on the VPS", "deploy the bridge update", "deploy web/worker update".

The VPS checkout `C:\analytic` serves BOTH runtimes: the Python bridge AND the analytic stack (web/worker). One `git pull`, then rebuild only what the diff touched.

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'`
2. Read output. Conflict / detached-HEAD / dirty-worktree → STOP, do not restart.
   Clean, or "Already up to date." → continue.
3. IF the pull touched `bridge/` — bridge runtime deps before restarting (pinned in `bridge/requirements.txt`; psutil/redis are lazy-imported, so `pytest` passing doesn't prove they're installed):
   `ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; C:\Python314\python.exe -m pip install -r bridge\requirements.txt"'`
   Add `-r bridge\requirements-dev.txt` instead if `bridge/tests/` was touched (it already includes requirements.txt).
   If `bridge/.env.example` changed, diff it against the live `bridge\.env` for any new required variable — a new var with no default crashes that account's worker at startup, not the supervisor.
4. IF the pull touched `src/`, `prisma/`, `package.json`, or `public/` — rebuild the analytic stack (build ON the box, never copy artifacts from a dev machine):
   ```bash
   ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; npm ci"'
   ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; npx prisma generate"'
   ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; npm run build"'
   ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; npm run build:worker-v2"'
   ```
5. IF `prisma/migrations/` changed — apply migrations (deploy-time, not service-start):
   ```bash
   ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; Get-ChildItem prisma\migrations -Directory | Where-Object { -not (Test-Path \"$($_.FullName)\migration.sql\") } | Remove-Item -Recurse -Force; npx prisma migrate deploy"'
   ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; npx prisma migrate status"'
   ```
   Expect "Database schema is up to date!".
6. Restart ONLY what the diff touched (each a separate SSH call):
   - bridge/ changed → `ssh forexvps 'nssm restart bridge'`
   - src/prisma/package changed → `ssh forexvps 'nssm restart analytic-worker'` then `ssh forexvps 'nssm restart analytic-web'`
   - `Caddyfile.windows` changed → `ssh forexvps 'nssm restart caddy'`
7. VERIFY (per analytic-services.md quick checks): `nssm status` of each restarted service → SERVICE_RUNNING; worker health `:9200/health` → 200; web `/api/accounts` → 200; from your machine `curl -sI https://therng.duckdns.org/` → 200; if bridge restarted, health JSONs re-advance (status-check.md step 5).

NOT INSTALLED YET: `nssm restart analytic-worker` errors "no such service" → stack not installed (migration in progress) — that part of the deploy only applies after the migration plan's Task 5.

FORBIDDEN: combining pull+build+restart+status into one script — untested against forexvps. Keep as separate steps. Never echo secrets from AppEnvironmentExtra.

Note: the Tier-1 single-quoted forms above are the tested ones for this flow — use them verbatim; fall back to Tier 2 `-EncodedCommand` (command-execution-strategy.md) only if a command hangs or output garbles.
