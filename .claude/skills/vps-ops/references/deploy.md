# deploy — git pull + rebuild + targeted restart

Update the analytic stack on the host. Rule of thumb: **restart only what the
diff touched.** Untouched services keep running; unnecessary restarts create
feed gaps and consumer-group churn for nothing.

## Prerequisites

- Platform guard passed (see SKILL.md).
- Operator confirmed the deploy (this is on the confirm-first list).
- Expect a `package.json` `version` bump when the pull comes from the operator's
  own push — if the operator asks to push FROM this host, confirm the version
  bump is in the same commit before pushing. No automated guard is installed —
  never push or commit hardcoded secrets (`REDIS_PASSWORD`, `DATABASE_URL`,
  `DUCKDNS_TOKEN`) or `.env*` files.

## Step 0 — capture the pre-state

```powershell
cd C:\analytic
git status --short        # must be clean
git rev-parse HEAD        # note this SHA — the diff baseline
```

Dirty worktree, detached HEAD, or conflicts during pull → STOP and report. Do
not restart anything. ("Check worktree before editing — repo may have unrelated
local experiments.")

## Step 1 — pull

```powershell
git pull
```

"Already up to date." → nothing to deploy; stop here unless the operator asked
for a rebuild anyway.

## Step 2 — classify the diff

```powershell
git diff --name-only <preSha> HEAD
```

Route by path:

| Diff touched | Also do |
|---|---|
| `bridge/` | Step 2a |
| `src/`, `prisma/`, `package.json`, `public/` | Step 3 |
| `prisma/migrations/` | Step 4 |
| `Caddyfile.windows` | restart `caddy` in Step 5 |
| none of these (docs only) | no restart needed; report and stop |

**Step 2a — bridge deps:**

```powershell
C:\Python314\python.exe -m pip install -r bridge\requirements.txt
```

(`-r bridge\requirements-dev.txt` if `bridge/tests/` touched.) If
`bridge/.env.example` changed, diff it against live `bridge\.env` — a new
required var with no default crashes that account's worker at startup.

## Step 3 — rebuild (Node side)

```powershell
cd C:\analytic
npm ci
npx prisma generate
npm run build:worker-v2
npm run build:view-worker   # see note
npm run build
```

- `npm run build` = `next build` + `node scripts/sync-standalone.mjs`, which
  copies `.next/static`, `public/`, and `dist/view-build-worker.js` into
  `.next/standalone`. Without the sync the standalone server 404s assets.
- `build:view-worker` (added 8.56) produces `dist/view-build-worker.js`;
  `sync-standalone.mjs` only WARNS when it's missing (view builds silently
  fall back to slower inline mode), so run it before `npm run build` — cheap
  insurance even when unchanged.

**Gotcha — EBUSY during rebuild** (verified host class of failure): a running
web/worker node tree locks `.next\standalone`; `npm run build` dies with
`EBUSY ... rmdir 'C:\analytic\.next\standalone'`. Fix: stop the owning NSSM
service (`nssm stop analytic-web`) rather than killing PIDs; build; start it
in Step 5. For orphan processes resolve the real PID from the port:
`netstat -ano | findstr :3000` → `taskkill /F /T /PID <pid>`.

**Gotcha — `npm ci` / `prisma generate` EPERM on the Prisma engine DLL**
(verified 2026-08-29): `analytic-worker` runs `dist/worker-v2.js` with
`--external:@prisma/client`, so it holds
`node_modules\.prisma\client\query_engine-windows.dll.node`; `npm ci` dies
with `EPERM ... unlink` and `prisma generate` with `EPERM ... rename` while
it runs. If the lockfile and `node_modules` already agree (manifest deltas
are dependency-spec edits `npm install` can reconcile without touching the
DLL), incremental `npm install` + `npx npm ls <pkgs>` is a verified-equivalent
substitute — skip `prisma generate` too when `prisma/schema.prisma` is
unchanged in the diff. Otherwise stop the worker for the install window.

**Gotcha — `nssm restart` can leave the service stopped** (verified
2026-08-29): `nssm restart analytic-worker` errored with
`Unexpected status SERVICE_STOP_PENDING in response to STOP control`, never
issued the start leg, and left the worker `SERVICE_STOPPED` while web/caddy
came up producer-less. After any `nssm restart`, check `nssm status <svc>`
and `nssm start <svc>` if it did not come back — or use explicit
`nssm stop` → `nssm start` pairs for the worker.

## Step 4 — migrations (only if `prisma/migrations/` changed)

```powershell
Get-ChildItem prisma\migrations -Directory | Where-Object { -not (Test-Path "$($_.FullName)\migration.sql") } | Remove-Item -Recurse -Force
npx prisma migrate deploy
npx prisma migrate status   # expect: "Database schema is up to date!"
```

(Cleans empty migration dirs left by editor noise.) A red status here = STOP
and report; never restart services on top of a half-applied schema.

## Step 5 — restart ONLY what the diff touched

| Diff touched | Restart |
|---|---|
| `bridge/` | `nssm restart bridge` |
| `src/`, `prisma/`, `package.json` | `nssm restart analytic-worker` THEN `nssm restart analytic-web` |
| `public/` only (no `src/`/`prisma/`/`package.json` changes) | `nssm restart analytic-web` only — static assets don't run in the worker |
| `Caddyfile.windows` | `nssm restart caddy` |

Worker before web, when both restart: the worker owns the Redis live state
and the DB writes the web layer reads — restarting web first means it comes
up serving against a producer that is about to bounce, which surfaces as
stale-tile noise on the dashboard.

## Step 6 — verify before reporting success

```powershell
nssm status <each restarted service>     # SERVICE_RUNNING
curl.exe -s http://127.0.0.1:9200/health # 200; 503 body names the stale component
$r = curl.exe -s -w '%{http_code}' http://127.0.0.1:3000/api/accounts; $r
curl.exe -sI https://therng.duckdns.org/ # 200 — hairpin caveat below
git -C C:\analytic log -1 --oneline      # include in the report
```

For `/api/accounts`: the last 3 characters of `$r` are the HTTP status —
expect 200 plus a bare JSON array with a nonzero account count. A 500 with a
Prisma error body still "parses" as JSON, so judge by the status code, not by
whether it looks like JSON.

Hairpin caveat: on-host access to the public IP may be blocked at the
provider NAT. If `https://therng.duckdns.org` fails while
`http://127.0.0.1:3000/api/accounts` is 200, have the operator confirm from
an off-box device (their phone) before declaring a public-path outage.

If the bridge restarted, also confirm per-account health JSONs re-advance
(`bridge\state\health\*.json` — `last_transition_at_utc` fresh, `state:
running`). A red check = stop and report; do not "try again" blindly.

## Full manual stack restart (only when asked explicitly)

Order matters — data tier first, producer last: `nssm stop bridge` →
`nssm restart redis-wsl` → `Restart-Service postgresql-x64-18` → wait ~30 s →
`nssm restart analytic-worker` → `nssm restart analytic-web` →
`nssm restart caddy` → launch Startup `.lnk`s ~3 s apart →
`nssm restart bridge`. A Windows reboot is usually preferable (SCM restores
dependency order) — follow with the post-reboot checks in
`status-summary.md`.

## Rollback

There is no second host to fall back to. The operational rollback is:
`nssm stop bridge` and fix in place. For the worker's live-writer only,
`WORKER_V2_ENABLE_LIVE_SYNC=false` stops `AccountSnapshot`/`OpenPosition`
writes (rollback knob — restore to true afterwards). Durable history
reconstruction after Redis loss:
`python -m bridge.scripts.replay_published_outbox --journal <journal.sqlite3> --login <login> --target-id <recovery-target> --confirm REPLAY_PUBLISHED_OUTBOX`
— ONLY into a separately verified CLEAN Redis target, never the live Redis
while the bridge holds leases (the 30-min fencing lease will fence out the
live producer and gap that account's feed). Point the command's REDIS_URL at
the recovery target explicitly, and confirm with the operator first. Source
journal stays read-only; the run is idempotent.
