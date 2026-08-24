# status-summary — health check + iMessage VPS report

Two phases: **gather** a fixed set of facts, then **compose and send** one
compact plain-text summary via the hermes gateway (proton → iMessage).
Read-only unless you explicitly escalate — if something is broken, report it,
don't fix it unprompted.

Prerequisite: platform guard passed (see SKILL.md) — if not yet run this
session, run it now, before any command.

## Phase 1 — gather (in this order)

**1. Host vitals**

```powershell
Get-PSDrive C | Select-Object @{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
Get-CimInstance Win32_OperatingSystem | Select-Object @{n='FreeRAMGB';e={[math]::Round($_.FreePhysicalMemory/1MB,1)}}
```

Baselines: C: free ≥ 20 GB; free RAM ≥ 2 GB with MT5 running.

**2. Services**

```powershell
Get-Service postgresql-x64-18,redis-wsl,analytic-worker,analytic-web,caddy | Format-Table Name,Status
nssm status bridge
```

All six must be Running (`SERVICE_RUNNING` for bridge).

**3. Worker health — the richest single endpoint**

```powershell
curl.exe -s http://127.0.0.1:9200/health
```

Reading it: HTTP 200 = healthy overall, 503 = body names the stale component.
Fields that matter: top-level `status` (`starting|ok|stale`), per-component
`deals/orders/live/equity/calendar` states (`disabled|starting|ok|stale`,
with staleAfterMs 60 s / 60 s / 16 s / 180 s / ~2 h respectively),
`queue.pendingTotal` + `sampledAt` age, `streams.deals.failed` /
`streams.orders.failed`, freshest `accounts.*.lastLiveSync`. Ignore
`dbLatencyMsLast` (always null — no writer). A `starting` component does NOT
fail health.

**4. Bridge per-account health (filesystem, NOT Redis)**

```powershell
Get-ChildItem C:\analytic\bridge\state\health\*.json | ForEach-Object { "{0}: {1}" -f $_.BaseName, (Get-Content $_.FullName -Raw | ConvertFrom-Json).state }
```

Watch `state` (`running|starting|stopped|quarantined|standby_duplicate`),
`restart_count`, and any `quarantine` block (reason + time). Exit-code →
meaning map lives in host-facts.md. Do NOT use
`last_successful_live_poll_utc` / `last_successful_history_window_utc` —
no live writer, always null.

**5. Redis liveness (password-free)**

```powershell
wsl -d Ubuntu --exec redis-cli ping
```

PONG or NOAUTH both mean Redis is alive; connection refused = down. For
per-account live keys — braces around the login are PART of the key (Redis
hash tags; for login 7953093 the key is `mt5:account:{7953093}:live`):

```powershell
$pw = [regex]::Match((Get-Content C:\analytic\.env -Raw), 'REDIS_URL=redis://:([^@]+)@').Groups[1].Value
wsl -d Ubuntu --exec env REDISCLI_AUTH=$pw redis-cli EXISTS 'mt5:account:{<login>}:live'
```

Never type the Redis password literal into a command, and never paste it into
chat — always this `$pw` form (read in memory, passed via REDISCLI_AUTH).
TTL 60 s — a missing key means that account's feed is stale RIGHT NOW.

**6. Backfill/coverage (read-only, best per-account picture)**

```powershell
cd C:\analytic; node --import tsx scripts\verify-history-backfill.ts
```

Per-account Deal/Order/Position coverage, checkpoint phase, completed chunks,
stream length/pending. All accounts should show completed coverage from
2025-01-01 with no unexplained gaps (the 2026-07 incident had NO error
surfaced — silence is why this check exists).

**7. Terminals**

```powershell
Get-Process terminal64 | Measure-Object | Select-Object Count
```

Compare against the expected count from `bridge\state\discovered-accounts\`
(terminals paused into `C:\Pause` don't count). No terminals + no console
session → check `qwinsta` (Startup `.lnk`s only fire at interactive logon).

**8. Public path**

```powershell
$r = curl.exe -s -w '%{http_code}' https://therng.duckdns.org/api/accounts; $r
```

Last 3 characters of `$r` are the HTTP status (expect 200) followed by the
bare JSON array. A 500 with a Prisma error body still "parses" as JSON —
judge by the status code, not by whether it looks like JSON, and mask the
embedded `DATABASE_URL` password before any of the body enters the summary.

`/api/health` is static `{ok:true}` — proves nothing, never cite it.
Hairpin caveat: on-host access to the public IP may be blocked at the
provider NAT. If this check fails while `http://127.0.0.1:3000/api/accounts`
is 200, have the operator confirm from an off-box device (their phone)
before declaring a public-path outage.

**9. Scheduled tasks (existence unverified — probe)**

```powershell
Get-ScheduledTask -TaskName analytic-pg-dump, analytic-worker-health-probe -ErrorAction SilentlyContinue
```

If present: last result + `C:\backups\trading_db.dump` mtime /
`C:\analytic\logs\health-probe.log` recent FAIL lines. If absent, note
"backup task NOT installed" — that's a finding, not a pass.

**10. Version + error tails**

```powershell
git -C C:\analytic log -1 --oneline
Get-Content C:\analytic\logs\worker-stderr.log -Tail 20
Get-Content C:\analytic\logs\web-stderr.log -Tail 20
Get-Content C:\analytic\bridge\logs\bridge-stdout.log -Tail 30
Get-Content C:\caddy\logs\caddy-stderr.log -Tail 20   # TLS/DNS-01 failures surface here
```

## Phase 2 — compose

Plain text, iMessage-friendly, ✅/⚠️/❌ markers, Bangkok time. Template:

```
📊 forexvps status — 2026-08-24 14:05 +07
Host: C: 143GB free | RAM 6.2GB free
Services: 6/6 ✅
Worker: ok | queue 0 pending | streams 0 failed
Bridge: 5/5 running
  ⚠️ 7953093 restart_count=2
  ❌ 7954220 quarantined journal_failure 12:41
Redis: live keys 5/5 | PG: ok
Terminals: 5/5 | Public: 200
Backfill: complete 5/5
Version: 6904a1c (8.56)
```

Rules: only include a line when checked; mark unknowns as `?` with the reason.
If everything is green, the ⚠️/❌ lines simply disappear. Before ANY error or
log line enters the summary, mask anything credential-shaped —
`DATABASE_URL`/`REDIS_URL` fragments, passwords, tokens — regardless of which
probe or log it came from (Prisma/Redis client errors embed connection
strings).

## Phase 3 — send via hermes gateway (proton → iMessage)

### Recorded invocation — check this FIRST

> **Gateway command:** _(not recorded yet — run First-run discovery below)_
> **Destination:** _(contact/phone the summary is sent to)_
> **Recorded:** _(date)_

Once recorded, this slot is the single source of truth; use it verbatim and
skip discovery.

### First-run discovery (only if the slot above is empty)

1. Probe for a CLI: `Get-Command hermes -ErrorAction SilentlyContinue`, then
   `hermes --help` — look for a send/notify/gateway subcommand.
2. Probe for a local gateway endpoint: common ports/config under
   `%USERPROFILE%\.hermes` or a running listener
   (`netstat -ano | findstr LISTENING` + task mapping). Config files there
   may contain auth tokens — treat them like passwords; never echo them into
   chat or the recorded slot.
3. If neither resolves in a couple of minutes, ASK the operator for the exact
   command/endpoint + auth AND the destination (contact/phone) the summary
   goes to. Do not invent one.
4. Test-send a trivial message ("vps-ops gateway check <timestamp>") to the
   operator and confirm it arrived.
5. **Record the working invocation and destination into the slot above**
   (edit this file) — with secrets BY REFERENCE only (e.g.
   `--token %HERMES_TOKEN%`, or "read from `C:\analytic-secrets.env`"),
   never an inline literal token/password. Then every future run skips
   discovery.

### Sending

Send the composed summary exactly as-is (plain text). If the send fails,
report the failure + the summary content back to the operator — never swallow
it.

## Triage shortcuts (when the summary has a ❌)

| Symptom | First suspect |
|---|---|
| Stale dashboard | Stack checks FIRST — worker 503 body names the broken stage; only then bridge/terminals |
| Worker crash-loop | Redis connectivity (worker exits 1 without Redis) |
| Bridge account quarantined, `journal_failure` | Read the account health JSON + journal sidecar DACLs (`Get-Acl <journal> | fl` — known mode: sidecars with `AreAccessRulesProtected=True`). BEFORE any repair, back the journal up: `python -m bridge.scripts.backup_journal C:\analytic\bridge\state\journal\<login>.sqlite3 C:\backups\journal-<login>-<yyyyMMdd-HHmm>.sqlite3` (read-only on source; destination must not exist). Repair = re-run `bridge\scripts\install-service.ps1`; clearing quarantine = ONLY `python -m bridge.scripts.clear_quarantine --state-dir <dir> --profile-id <id> --operator <you>` (prefer the specific profile; `--all` only when every active quarantine's cause is fixed) — a bridge restart does NOT clear it |
| Poll timestamps stale >2-3 min but bridge process alive | Stuck producer — check market hours before calling a quiet feed stale |
| Post-reboot everything "down" | Normal for up to 5 min (worker cycles while Redis settles); then run Phase 1 again |
