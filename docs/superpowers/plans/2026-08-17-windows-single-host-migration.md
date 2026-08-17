# Single-Host Windows Migration (forexvps Clean Install) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate Postgres, Redis, worker-v2, web, and Caddy onto forexvps (Windows Server 2022) as native Windows services via clean install, so `https://therng.duckdns.org` opens normally with live data and fresh MT5 backfill from 2025-01-01.

**Architecture:** All services follow the proven bridge NSSM pattern (`analyticvps\supachai` account, `SERVICE_AUTO_START`, 10 MB log rotation, restart-on-exit). Data plane is loopback-only; Caddy on 80/443 is the only public exposure. Redis 7.2 runs in WSL2 (gated on a Phase-0 nested-virtualization probe; Memurai-with-weekly-restart fallback requires re-asking the user first). Build on the box (`git clone` → `npm ci` → build), never cross-copy artifacts.

**Tech Stack:** Windows Server 2022, NSSM, PostgreSQL 16 (EDB), WSL2 Ubuntu + Redis 7.2, Node 20 LTS, Next.js 16 standalone, Prisma 6, Caddy 2 (duckdns module prebuilt).

**Spec:** `docs/superpowers/specs/2026-08-17-windows-single-host-migration-design.md` (approved; travels with this plan — executors read both)

## Global Constraints

- NEVER echo `REDIS_URL`, `DUCKDNS_TOKEN`, `AUTH_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, or any password into chat, logs, plan files, or commits. Where this plan writes `<SECRET:name>`, substitute the real value on the host only. Values live only in on-host files (`bridge\.env`, `C:\analytic\.env`, NSSM `AppEnvironmentExtra`) — enforced by `scripts/check-harness-review.sh` pre-push gate.
- Remote execution goes through the ssh-vps skill (`ssh forexvps`, PowerShell on host, complex payloads via `-EncodedCommand`). Run PowerShell snippets below "on host as admin" through that skill's command-execution strategy.
- Service account for every NSSM service: `analyticvps\supachai`, `SERVICE_AUTO_START`.
- Loopback-only data plane: Postgres, Redis, web, worker health bind `127.0.0.1`; only Caddy binds public 80/443.
- Redis config: `appendonly yes`, `appendfsync everysec`, `save 900 1` / `save 300 10` / `save 60 10000`, `requirepass` set, `maxmemory-policy noeviction` (deliberate change from the old `allkeys-lru` — see spec).
- Build on the box. Never copy `.next/`, `dist/`, or `node_modules/` from the Mac.
- `analytic-worker` must set `DependOnService = postgresql-x64-16, redis-wsl`.
- Windows service names: `analytic-web`, `analytic-worker`, `caddy`, `redis-wsl`, `bridge` (reinstalled last).
- Verification truth: `/api/health` is static `{ok:true}` and proves nothing — verify with `/api/accounts` and worker `:9200/health`.
- Push gate (every push): confirm `package.json` version bump with the user (current `8.31`), then `npm run hooks:install` (once) and let the pre-push hook run `scripts/check-harness-review.sh`. Pushes touching `src/worker-v2/` need ingestion-review evidence (reviewer agent run + `_workspace/02_review_ingestion.md` or `ingestion review: pass` in the commit message).
- A failed verify = stop and report. Never proceed past a red check.

---

### Task 1: Fix worker-v2 Windows path-separator bug (TDD, repo change)

**Files:**
- Modify: `src/worker-v2/index.ts:260-263`
- Modify: `src/worker-v2/index.test.ts` (append tests)
- Create: `_workspace/02_review_ingestion.md` (review evidence)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: exported pure function `isInvokedAsMainModule(invokedPath: string): boolean` in `src/worker-v2/index.ts`. Later tasks rely on: `node C:\analytic\dist\worker-v2.js` actually invoking `main()` (the NSSM `analytic-worker` service, Task 5).

- [ ] **Step 1: Write the failing tests**

Append to `src/worker-v2/index.test.ts` (match existing import style — add `isInvokedAsMainModule` to the existing `import { ... } from "./index"` line at the top of the file):

```ts
test("isInvokedAsMainModule accepts Windows backslash paths", () => {
  // On Windows, process.argv[1] is e.g. C:\analytic\dist\worker-v2.js and the
  // old forward-slash-only endsWith checks never matched, so main() silently
  // never ran.
  assert.equal(isInvokedAsMainModule("C:\\analytic\\dist\\worker-v2.js"), true);
  assert.equal(
    isInvokedAsMainModule("C:\\analytic\\src\\worker-v2\\index.ts"),
    true,
  );
});

test("isInvokedAsMainModule accepts POSIX paths unchanged", () => {
  assert.equal(isInvokedAsMainModule("/app/dist/worker-v2.js"), true);
  assert.equal(isInvokedAsMainModule("/repo/src/worker-v2/index.ts"), true);
});

test("isInvokedAsMainModule rejects unrelated or bare paths", () => {
  assert.equal(isInvokedAsMainModule("/some/other/script.js"), false);
  assert.equal(isInvokedAsMainModule("worker-v2.js"), false);
  assert.equal(isInvokedAsMainModule(""), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/worker-v2/index.test.ts`
Expected: FAIL — the import of `isInvokedAsMainModule` fails (export does not exist yet).

- [ ] **Step 3: Implement in `src/worker-v2/index.ts`**

Replace lines 260-263:

```ts
const invokedPath = process.argv[1] ?? "";
const isMainModule =
  invokedPath.endsWith("/worker-v2/index.ts") ||
  invokedPath.endsWith("/dist/worker-v2.js");
```

with:

```ts
export function isInvokedAsMainModule(invokedPath: string): boolean {
  const normalized = invokedPath.replace(/\\/g, "/");
  return (
    normalized.endsWith("/worker-v2/index.ts") ||
    normalized.endsWith("/dist/worker-v2.js")
  );
}

const invokedPath = process.argv[1] ?? "";
const isMainModule = isInvokedAsMainModule(invokedPath);
```

Keep the existing comment above (lines 254-259) explaining why `require.main === module` is not used — do not remove it.

- [ ] **Step 4: Run the tests to verify pass**

Run: `node --import tsx --test src/worker-v2/index.test.ts`
Expected: PASS (new tests + all pre-existing).

- [ ] **Step 5: Full verification baseline**

```bash
node --import tsx --test src/worker-v2/*.test.ts
npx tsc --noEmit
npm run lint
```

Expected: all green.

- [ ] **Step 6: Ingestion review (repo harness requirement — `src/worker-v2/` touched)**

Dispatch the `bridge-ingestion-reviewer` agent (read-only) on this diff. Record its verdict in `_workspace/02_review_ingestion.md` (what was reviewed, result). If it finds a real defect, fix before committing.

- [ ] **Step 7: Commit, bump, push**

```bash
git add src/worker-v2/index.ts src/worker-v2/index.test.ts _workspace/02_review_ingestion.md
git commit -m "fix(worker-v2): accept backslash invoked paths so main() runs on Windows

ingestion review: pass (bridge-ingestion-reviewer, see _workspace/02_review_ingestion.md)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

Ask the user to confirm version bump `8.31` → `8.32`, apply to `package.json`, amend or add to the same push, `npm run hooks:install` (once per clone), then `git push`. **This push must land before Task 4 clones on the VPS.**

---

### Task 2: Phase-0 probes on forexvps (read-only)

**Files:** none (no repo changes; results reported in chat).

**Interfaces:**
- Consumes: working `ssh forexvps` (see `.claude/skills/ssh-vps/references/connection.md`).
- Produces: WSL2 go/no-go; disk/RAM figures; port matrix; inbound-80/443 proof. **If the WSL2 probe fails → STOP and re-ask the user** (spec: Memurai fallback was not the approved path).

- [ ] **Step 1: Virtualization probe**

On host: `systeminfo | findstr /i "Hyper-V"` and `powershell -NoProfile -Command "(Get-ComputerInfo).HyperVisorPresent"`.
Expected: "A hypervisor has been detected" / `True` → WSL2 viable. `False`/absent → STOP; ask the user about the Memurai fallback.

- [ ] **Step 2: Disk / RAM / ports**

On host:

```powershell
Get-PSDrive C | Select-Object Used,Free
Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory
netstat -ano | findstr ":3000 :9200 :5432 :6379 :80 :443"
```

Expected: ≥20 GB free on C:; ≥2 GB free RAM (with MT5 running); netstat shows no listener on 3000/9200/5432/6379 (80/443 hits are acceptable only if PIDs map to a component this plan replaces or to a stopped IIS — investigate and resolve any hit before Task 3).

- [ ] **Step 3: Inbound 80/443 from outside**

From the Mac: `curl -sI --max-time 10 http://therng.duckdns.org/`.
Expected: any HTTP response (even 502/timeout-after-connect) proves port 80 reachable. Connection timeout → provider filtering; investigate (VPS firewall panel) before Task 5.

- [ ] **Step 4: Gate**

Report all four results. All green → Task 3. Any red → stop and report.

---

### Task 3: Data tier — PostgreSQL 16 + Redis 7.2 in WSL2

**Files:** on-host only (no repo changes).

**Interfaces:**
- Consumes: Task 2 all green.
- Produces: `127.0.0.1:5432` Postgres with role `supachai`, db `trading_db`, `timezone=Asia/Bangkok`; `127.0.0.1:6379` Redis (AOF everysec + RDB + `noeviction` + `requirepass`); Windows services `postgresql-x64-16` (installer) and `redis-wsl` (NSSM) both auto-start; Defender exclusions in place.

- [ ] **Step 1: Install PostgreSQL 16 (interactive, admin, on host)**

Download the latest EDB `postgresql-16.x-windows-x64.exe` and install: dir `C:\Program Files\PostgreSQL\16`, default data dir, port 5432, superuser password = `<SECRET:POSTGRES_PASSWORD>`, locale default, service `postgresql-x64-16` auto-start. Skip Stack Builder.

- [ ] **Step 2: Configure Postgres**

Edit `C:\Program Files\PostgreSQL\16\data\postgresql.conf`:

```
listen_addresses = '127.0.0.1'
timezone = 'Asia/Bangkok'
log_timezone = 'Asia/Bangkok'
max_wal_size = 2GB
```

Then (on host, psql prompts for the superuser password):

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -c "CREATE ROLE supachai LOGIN PASSWORD '<SECRET:POSTGRES_PASSWORD>';"
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -c "CREATE DATABASE trading_db OWNER supachai;"
Restart-Service postgresql-x64-16
```

- [ ] **Step 3: Verify Postgres**

On host: `& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U supachai -d trading_db -c "SHOW timezone; SELECT 1;"`
Expected: `Asia/Bangkok` and `1`. Also from the Mac: confirm 5432 is NOT reachable off-host (`nc -z -w3 <vps-ip> 5432` fails).

- [ ] **Step 4: WSL2 + Ubuntu + Redis**

On host (admin): `wsl --install -d Ubuntu --no-launch` (reboot host if prompted, then re-verify Task 2 Step 1 shows the hypervisor). Inside Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y redis-server
```

Edit `/etc/redis/redis.conf`:

```
bind 127.0.0.1
requirepass <SECRET:REDIS_PASSWORD>
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000
maxmemory-policy noeviction
```

- [ ] **Step 5: `redis-wsl` NSSM service (survives reboot)**

On host (admin):

```powershell
nssm install redis-wsl "C:\Windows\System32\wsl.exe" "-d Ubuntu --exec redis-server /etc/redis/redis.conf"
nssm set redis-wsl AppDirectory C:\analytic
nssm set redis-wsl ObjectName analyticvps\supachai <SECRET:SUPACHAI_PASSWORD>
nssm set redis-wsl Start SERVICE_AUTO_START
nssm set redis-wsl AppStdout C:\analytic\logs\redis-wsl-stdout.log
nssm set redis-wsl AppStderr C:\analytic\logs\redis-wsl-stderr.log
nssm set redis-wsl AppRotateFiles 1
nssm set redis-wsl AppRotateOnline 1
nssm set redis-wsl AppRotateBytes 10485760
nssm set redis-wsl AppExit Default Restart
nssm set redis-wsl AppRestartDelay 5000
nssm start redis-wsl
```

(The `C:\analytic\logs` dir is created in Task 4 Step 1; if running Task 3 before that dir exists, create it now: `New-Item -ItemType Directory -Force C:\analytic\logs`.)

- [ ] **Step 6: Verify Redis (in-WSL and from-Windows)**

In WSL: `redis-cli -a '<SECRET:REDIS_PASSWORD>' ping` → `PONG`.
From Windows host process: `powershell -NoProfile -Command "(Test-NetConnection 127.0.0.1 -Port 6379).TcpTestSucceeded"` → `True`.
If the Windows-side test fails (WSL localhostForwarding quirk): stop and report — do NOT swap to a portproxy workaround without recording it; the fix candidates are `wsl --shutdown` + restart of `redis-wsl`, or binding the WSL vEthernet IP. Whatever is chosen must be added to the ops notes in Task 7.

- [ ] **Step 7: Defender exclusions**

On host (admin):

```powershell
Add-MpPreference -ExclusionPath 'C:\Program Files\PostgreSQL\16\data'
Add-MpPreference -ExclusionPath 'C:\analytic\bridge\state'
Add-MpPreference -ExclusionPath 'C:\analytic\logs'
Add-MpPreference -ExclusionPath 'C:\caddy'
Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss |
  ForEach-Object { Add-MpPreference -ExclusionPath ((Get-ItemProperty $_.PSPath).BasePath + '\ext4.vhdx') }
```

Verify: `Get-MpPreference | Select-Object -ExpandProperty ExclusionPath` lists all five.

---

### Task 4: Clean slate + fresh clone + build + migrate (on host)

**Files:**
- On-host: delete + re-clone `C:\analytic`; create on-host `.env` (gitignored).
- No repo commits in this task.

**Interfaces:**
- Consumes: Task 3 data tier up; Task 1 fix pushed to `origin/main`.
- Produces: `C:\analytic` fresh at latest main with `node_modules/`, `.next/standalone/`, `dist/worker-v2.js`, Prisma client generated for win32, migrations applied to `trading_db`, `C:\analytic\.env` present.

- [ ] **Step 1: Stop and remove old bridge + delete old tree**

On host (admin):

```powershell
nssm stop bridge
nssm remove bridge confirm
Remove-Item -Recurse -Force C:\analytic
New-Item -ItemType Directory -Force C:\analytic\logs | Out-Null
```

(Irreversible by design — clean install approved in spec. MT5 terminals and `C:\Python314` are outside `C:\analytic` and untouched.)

- [ ] **Step 2: Clone + Node 20 + bridge Python deps**

Install Node 20 LTS MSI (default path) if absent (`node -v` shows <20). Then on host:

```powershell
cd C:\
git clone https://github.com/therng/analytic.git C:\analytic
```

If the clone fails on auth (private repo), stop and ask the user how the VPS should authenticate (credential manager/token) — never put a token in the clone URL.
Then: `C:\Python314\python.exe -m pip install -r C:\analytic\bridge\requirements.txt`.

- [ ] **Step 3: On-host `.env`**

Write `C:\analytic\.env` (file is gitignored; never print its contents back):

```
DATABASE_URL=postgresql://supachai:<SECRET:POSTGRES_PASSWORD>@127.0.0.1:5432/trading_db
REDIS_URL=redis://:<SECRET:REDIS_PASSWORD>@127.0.0.1:6379
TZ=Asia/Bangkok
```

- [ ] **Step 4: Install, generate, build**

On host, from `C:\analytic`:

```powershell
npm ci
npx prisma generate
npm run build
npm run build:worker-v2
```

Expected: all four succeed (build produces `.next\standalone\server.js`; esbuild produces `dist\worker-v2.js`).

- [ ] **Step 5: Migrate (entrypoint.sh equivalent, including the prune)**

On host, from `C:\analytic` (PowerShell translation of `entrypoint.sh`):

```powershell
Get-ChildItem prisma\migrations -Directory |
  Where-Object { -not (Test-Path "$($_.FullName)\migration.sql" ) } |
  Remove-Item -Recurse -Force
npx prisma migrate deploy
```

Verify: `npx prisma migrate status` reports "Database schema is up to date", and:

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U supachai -d trading_db -c "SELECT count(*) FROM _prisma_migrations;"
```

matches the count of directories under `prisma\migrations` (currently 36; re-count at execution time — migrations may have been added since this plan was written).

---

### Task 5: App services — NSSM web/worker + Caddy (repo change: Caddyfile.windows)

**Files:**
- Create: `Caddyfile.windows` (repo, committed)
- On-host: NSSM services `analytic-web`, `analytic-worker`, `caddy`; `C:\caddy\` layout; firewall rules.

**Interfaces:**
- Consumes: Task 4 build artifacts; Task 3 data tier; env values (`DATABASE_URL`, `REDIS_URL` as in Task 4 Step 3; `AUTH_SECRET`, `AUTH_URL=https://therng.duckdns.org`, `DUCKDNS_TOKEN`).
- Produces: `analytic-web` on `127.0.0.1:3000`; `analytic-worker` on `127.0.0.1:9200` with `DependOnService = postgresql-x64-16, redis-wsl`; `caddy` on 80/443 serving `https://therng.duckdns.org` → `127.0.0.1:3000`.

- [ ] **Step 1: Create `Caddyfile.windows` in the repo**

Exact content (differs from `Caddyfile`: proxy target and log path):

```
{
	# Email enables ZeroSSL as primary issuer (below), avoiding Lets Encrypt rate limits
	email therngsupachai@gmail.com
}

(common) {
	encode zstd gzip

	reverse_proxy 127.0.0.1:3000 {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
	}

	header {
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}

	log {
		output file C:/caddy/logs/access.log {
			roll_size 10MB
			roll_keep 5
			roll_keep_for 720h
		}
		format json
	}
}

:80 {
	import common
}

therng.duckdns.org {
	tls {
		issuer acme {
			dir https://acme.zerossl.com/v2/DV90
			dns duckdns {env.DUCKDNS_TOKEN}
		}
		issuer acme {
			dns duckdns {env.DUCKDNS_TOKEN}
		}
	}
	import common
}
```

- [ ] **Step 2: Commit, bump, push, pull on VPS**

Ask user to confirm version bump `8.32` → `8.33`, commit `Caddyfile.windows` (`feat(infra): Caddyfile.windows for native single-host deploy`), push (pre-push gate), then on host: `cd C:\analytic; git pull`.

- [ ] **Step 3: Install Caddy binary**

On host: download from https://caddyserver.com/download (platform Windows amd64, module `github.com/caddy-dns/duckdns`) → save `caddy.exe` to `C:\caddy\caddy.exe`. Verify: `C:\caddy\caddy.exe version`.

- [ ] **Step 4: NSSM `analytic-web`**

On host (admin):

```powershell
nssm install analytic-web "C:\Program Files\nodejs\node.exe" "C:\analytic\.next\standalone\server.js"
nssm set analytic-web AppDirectory C:\analytic\.next\standalone
nssm set analytic-web ObjectName analyticvps\supachai <SECRET:SUPACHAI_PASSWORD>
nssm set analytic-web Start SERVICE_AUTO_START
nssm set analytic-web AppStdout C:\analytic\logs\web-stdout.log
nssm set analytic-web AppStderr C:\analytic\logs\web-stderr.log
nssm set analytic-web AppRotateFiles 1
nssm set analytic-web AppRotateOnline 1
nssm set analytic-web AppRotateBytes 10485760
nssm set analytic-web AppExit Default Restart
nssm set analytic-web AppRestartDelay 5000
nssm set analytic-web AppEnvironmentExtra PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production TZ=Asia/Bangkok "DATABASE_URL=postgresql://supachai:<SECRET:POSTGRES_PASSWORD>@127.0.0.1:5432/trading_db" "REDIS_URL=redis://:<SECRET:REDIS_PASSWORD>@127.0.0.1:6379" AUTH_TRUST_HOST=true "AUTH_URL=https://therng.duckdns.org" "AUTH_SECRET=<SECRET:AUTH_SECRET>"
nssm set analytic-web DependOnService postgresql-x64-16 redis-wsl
nssm start analytic-web
```

(If Google/Apple OAuth are in use, ask the user for those vars before this step and append `GOOGLE_CLIENT_ID=...` etc. to `AppEnvironmentExtra`.)

- [ ] **Step 5: NSSM `analytic-worker`**

Same pattern as Step 4 with:

```powershell
nssm install analytic-worker "C:\Program Files\nodejs\node.exe" "C:\analytic\dist\worker-v2.js"
nssm set analytic-worker AppDirectory C:\analytic
nssm set analytic-worker AppStdout C:\analytic\logs\worker-stdout.log
nssm set analytic-worker AppStderr C:\analytic\logs\worker-stderr.log
nssm set analytic-worker AppEnvironmentExtra TZ=Asia/Bangkok WORKER_V2_ENABLE_LIVE_SYNC=true WORKER_V2_HEALTH_PORT=9200 "DATABASE_URL=postgresql://supachai:<SECRET:POSTGRES_PASSWORD>@127.0.0.1:5432/trading_db" "REDIS_URL=redis://:<SECRET:REDIS_PASSWORD>@127.0.0.1:6379"
nssm set analytic-worker DependOnService postgresql-x64-16 redis-wsl
nssm start analytic-worker
```

(Rotation/exit/restart settings identical to Step 4 — repeat them explicitly.)

- [ ] **Step 6: Verify web + worker before Caddy**

On host:

```powershell
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/accounts).StatusCode
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9200/health).StatusCode
```

Expected: `200` for both. `/api/accounts` returning `200` with JSON (an empty account list is fine at this point — the bridge isn't installed yet) proves Prisma→Postgres works. Worker health `200` proves Redis connect + registry loops are up (empty registry is non-fatal by design). If worker crash-loops, read `C:\analytic\logs\worker-stderr.log` — first suspect is Redis connectivity (Task 3 Step 6).

- [ ] **Step 7: Firewall + NSSM `caddy`**

On host (admin):

```powershell
New-NetFirewallRule -DisplayName 'caddy-http'  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
New-NetFirewallRule -DisplayName 'caddy-https' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
nssm install caddy "C:\caddy\caddy.exe" "run --config C:\analytic\Caddyfile.windows"
nssm set caddy AppDirectory C:\caddy
nssm set caddy ObjectName analyticvps\supachai <SECRET:SUPACHAI_PASSWORD>
nssm set caddy Start SERVICE_AUTO_START
nssm set caddy AppStdout C:\caddy\logs\caddy-stdout.log
nssm set caddy AppStderr C:\caddy\logs\caddy-stderr.log
nssm set caddy AppRotateFiles 1
nssm set caddy AppRotateOnline 1
nssm set caddy AppRotateBytes 10485760
nssm set caddy AppExit Default Restart
nssm set caddy AppRestartDelay 5000
nssm set caddy AppEnvironmentExtra "DUCKDNS_TOKEN=<SECRET:DUCKDNS_TOKEN>"
nssm set caddy DependOnService analytic-web
nssm start caddy
```

- [ ] **Step 8: Verify HTTPS end-to-end**

From the Mac: `curl -sI https://therng.duckdns.org/` → `200` (or a redirect) with a valid ZeroSSL/LE cert; `curl -s https://therng.duckdns.org/api/accounts` → JSON.
Site content being empty is expected — the bridge isn't installed yet. If TLS fails, read `C:\caddy\logs\caddy-stderr.log` (DNS-01 needs the token and outbound 443).

---

### Task 6: Bridge reinstall (last) + end-to-end verify + broker offsets

**Files:** on-host `C:\analytic\bridge\.env`; no repo changes.

**Interfaces:**
- Consumes: Tasks 3-5 all green; `install-service.ps1` (in repo) reads `REDIS_URL` from `bridge\.env`.
- Produces: `bridge` NSSM service running against `127.0.0.1:6379`; fresh journals; automatic backfill from 2025-01-01; broker UTC offsets set per account.

- [ ] **Step 1: Write `bridge\.env` on host**

Copy `bridge\.env.example` → `bridge\.env` and fill (never echo values):

```
REDIS_URL=redis://:<SECRET:REDIS_PASSWORD>@127.0.0.1:6379
BRIDGE_STATE_DIR=C:\analytic\bridge\state
BRIDGE_STATE_DIR_WINDOWS=C:\analytic\bridge\state
```

(Check `bridge\.env.example` at execution time for any newly required vars added since this plan was written — diff it against the live file and fill everything required.)

- [ ] **Step 2: Install + start bridge**

On host (admin): `powershell -NoProfile -File C:\analytic\bridge\scripts\install-service.ps1` (prompts for `.\supachai` password), then `nssm start bridge`.

- [ ] **Step 3: Verify ingestion pipeline (minutes after start)**

On host:

1. Bridge logs (`C:\analytic\bridge\logs\bridge-stdout.log`) show lease `ACQUIRED` per login and per-account health JSONs appear under `C:\analytic\bridge\state\health\`.
2. In WSL: `redis-cli -a '<SECRET:REDIS_PASSWORD>' XLEN mt5:account:<login>:stream:history` — grows over time for each account (substitute each real login).
3. `redis-cli ... EXISTS mt5:account:<login>:live` → `1`.
4. Worker health `http://127.0.0.1:9200/health` shows per-account consumers with `deals`/`orders` counters incrementing.
5. From the Mac: `https://therng.duckdns.org` — accounts render, live tiles move. **This is the spec's success criterion.**

- [ ] **Step 4: Broker UTC offsets (required before history counts as correct)**

On host, from `C:\analytic`: `node --import tsx scripts\set-broker-utc-offset.ts --list` → shows discovered accounts. For each accountNo, ask the user the offset (minutes) — these are per-broker facts only the user knows — then:

```powershell
node --import tsx scripts\set-broker-utc-offset.ts <accountNo> <offsetMinutes>
```

- [ ] **Step 5: Confirm backfill progressing**

Over the following hour(s), `SELECT count(*) FROM "Deal";` in `trading_db` grows (worker persists after ack). No action needed — the bridge auto-backfills from 2025-01-01 with no checkpoint present. If counts stay 0 while `XLEN` grows, diagnose worker-v2 (`pipeline-health-engineer` agent, read-only) before proceeding.

---

### Task 7: Reboot test + scheduled backups/monitoring + docs

**Files:**
- On-host: scheduled tasks.
- Repo: `CLAUDE.md` stack section update; plan checkboxes final state.

**Interfaces:**
- Consumes: Task 6 end-to-end green.
- Produces: proof the box survives reboot; daily `pg_dump`; worker-health probe; updated docs.

- [ ] **Step 1: Deliberate reboot**

On host (admin): `Restart-Computer -Force`. Wait for SSH to return.

- [ ] **Step 2: Post-reboot verification**

On host: `Get-Service postgresql-x64-16, redis-wsl, analytic-worker, analytic-web, caddy, bridge` → all `Running` (worker may take a few restart cycles while data tier warms — `AppExit Restart` handles it; confirm it settles to Running within ~2 min). Terminals: `Get-Process terminal64` matches the pre-reboot count (paused accounts in `C:\Pause` excluded — see ssh-vps skill `full-restart.md`). Then re-run Task 6 Step 3 checks 2-5 (live keys exist, XLEN grows, dashboard tiles move).

- [ ] **Step 3: Daily pg_dump scheduled task**

On host (admin), create `C:\backups` and a scheduled task running daily 04:05 Asia/Bangkok:

```powershell
New-Item -ItemType Directory -Force C:\backups | Out-Null
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe' -Argument '-U supachai -Fc -f C:\backups\trading_db.dump trading_db'
$trigger = New-ScheduledTaskTrigger -Daily -At 04:05
Register-ScheduledTask -TaskName 'analytic-pg-dump' -Action $action -Trigger $trigger -User (whoami) -RunLevel Highest
```

(-Fc to a fixed filename keeps one refreshed full dump; retention-free by design since MT5 re-backfill is the recovery source. Add `DATABASE_URL`/pgpass per host prompts if auth fails.) Ask the user once whether an off-box copy target exists (e.g. their Mac via scp); if yes, add a second action; if no, note it as an open item.

- [ ] **Step 4: Worker-health probe task**

```powershell
$probe = @'
$r = try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9200/health -TimeoutSec 10 } catch { $null }
if ($null -eq $r -or $r.StatusCode -ne 200) {
  Add-Content C:\analytic\logs\health-probe.log ("{0} worker health FAIL" -f (Get-Date -Format o))
}
'@
Set-Content -Path C:\analytic\scripts\worker-health-probe.ps1 -Value $probe
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -File C:\analytic\scripts\worker-health-probe.ps1'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'analytic-worker-health-probe' -Action $action -Trigger $trigger
```

Run once manually; expect no FAIL line appended (200 path writes nothing).

- [ ] **Step 5: Update `CLAUDE.md` stack description**

Replace the Docker Compose stack description with the forexvps native-services topology (services, ports, log paths, backup task names, deploy flow = `git pull` + rebuild + migrate + `nssm restart`). Commit with user-confirmed version bump (`8.33` → `8.34`), push (gate applies).

- [ ] **Step 6: Final report**

Report against the spec's success criterion checklist: site opens / accounts render / live tiles move / backfill progressing / reboot survived. Any unchecked item = not done.

---

## Self-Review (completed during planning)

1. **Spec coverage:** probes (T2) · data tier incl. noeviction + exclusions (T3) · clean slate + on-box build + migrate + prune (T4) · web/worker/caddy + Caddyfile.windows + DependOnService (T5) · bridge last + e2e + broker offsets (T6) · reboot + backups + probe + CLAUDE.md (T7) · worker argv fix (T1). Accepted-losses and fallback gates carried in Global Constraints. Gap found and covered: CLAUDE.md stack-section update (spec's "Out of scope" missed it; added T7 Step 5).
2. **Placeholders:** none — every step carries exact commands/content; `<SECRET:*>` marks on-host secret substitution points only.
3. **Consistency:** `isInvokedAsMainModule` used identically in T1 tests and implementation; service names consistent across T3/T5/T7; `AppEnvironmentExtra` URLs identical in T4 Step 3, T5 Steps 4-5, T6 Step 1.
