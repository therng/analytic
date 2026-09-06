---
name: vps-ops
description: "forexvps Windows host ops: MT5, services, deploy, SMS."
version: 1.1.0
author: Supachai Therng (therng), Hermes Agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [VPS, MT5, NSSM, Windows, TradingOps]
    related_skills: []
---

# vps-ops — forexvps single-host operations

One machine, one stack: Windows Server 2022 ("forexvps", hostname `analyticvps`)
runs PostgreSQL 18 + Redis (WSL2) + `analytic-web` + `analytic-worker` + `caddy`
+ the MT5 Python `bridge` as native/NSSM services, alongside portable MT5
terminals launched at logon. Dev = prod; there is no other environment.

This skill exists so those operations follow the *host-verified* procedures
instead of improvised ones. Most incidents on this box came from plausible but
wrong moves: wrong Postgres service started, `taskkill /IM` killing every
terminal, `.chr` files mangled by default encoding, restarts of services the
diff never touched. The rules below are scars — respect them.

## When to Use

Load this skill when running ON the forexvps Windows host and the task
matches ANY trigger below. Never apply on macOS/Linux/dev checkouts.

- **Triggers:** deploy / git pull / อัปเดตระบบ · nssm · install service ·
  restart/stop any service · health check / status summary / VPS report /
  ส่งสรุปสถานะ VPS · SMS status (`status --notify`) · MT5 terminal (status,
  term close/start, pause/resume terminal, kill rogue/non-portable terminals
  via `term rogue --kill`, "is terminal X paused?") ·
  reboot-check · EA inputs / chart config / `.chr` / lot size.
- **Don't use for:** analytics logic, Prisma schema, dashboard UI, MT5
  trading decisions, anything on a non-Windows machine. Code changes belong
  to the analytic repo's own workflow; this skill only operates the running
  host.

## Platform guard — run this FIRST, every time

This runbook applies to exactly one machine. Verify before doing anything
(the snippet is PowerShell — shell rules for running it are right below):

```powershell
if ($env:OS -eq 'Windows_NT' -and (Test-Path 'C:\analytic')) { 'VPS-HOST' } else { 'NOT-VPS-HOST' }
```

- `VPS-HOST` → proceed.
- `NOT-VPS-HOST` (or you are on macOS/Linux, or `C:\analytic` is absent) →
  STOP. Tell the user this skill only applies on the forexvps host and must
  not be simulated elsewhere. Never fabricate Windows command output.
- The guard ERRORS instead of printing a branch → treat that as NOT-VPS-HOST
  and stop; do not "fix" the command and continue.

**Shell rules (every command in this skill is PowerShell):**

- In a PowerShell session, run snippets directly.
- From cmd.exe: `powershell -NoProfile -Command "<snippet>"` — safe; cmd
  never expands `$`.
- From Git Bash/POSIX shells: wrap in SINGLE quotes with double quotes
  inside: `powershell -NoProfile -Command '<snippet>'`. NEVER wrap a
  `$`-bearing snippet in double quotes in a POSIX shell — bash eats `$var`
  and executes `$(...)` as command substitution, which can silently rewrite
  the command into something destructive (a migration-dir prune becomes
  "delete every migration directory").

## Routing — pick the reference, read it before acting

| Task | Read |
|---|---|
| "ส่งสรุปสถานะ VPS" / status summary / daily report / SMS | `references/status-summary.md` |
| "deploy" / git pull / อัปเดตระบบ / release new version | `references/deploy.md` |
| "ติดตั้ง service" / nssm install / first-time setup | `references/service-install.md` |
| "แก้ EA inputs" / chart parameters / .chr / lot size | `references/ea-inputs.md` |
| "restart the worker" / single-service restart / "is terminal X paused?" / reboot the box | `references/host-facts.md` (service table + ad-hoc restart commands); terminal paused = its `.lnk` absent from Startup but present in `C:\Pause` (see pause/resume in `references/ea-inputs.md`). Confirm-first applies. |
| MT5 terminal/bridge ops — status, term close/start, rogue-terminal kill (`term rogue --kill`), pause/resume, reboot-check, `status --notify` SMS | `references/mt5ops.md` (the `mt5ops.py` helper script) |
| Service names, paths, ports, accounts, exit codes, doc contradictions | `references/host-facts.md` |

When unsure about a name, path, or port mid-procedure, consult
`references/host-facts.md` before guessing. Two sources there matter more than
any doc: live process state and the repo at `C:\analytic` (the checked-out
code is the authority; migration-plan prose contains known-stale lines).

## Safety rules — apply to every capability

**Confirm with the operator FIRST (state what will happen, wait for the yes):**

- Any deploy (pull/build/restart) and any service restart or stop.
- Killing or closing any MT5 terminal — its open positions are unmanaged until
  relaunch and the live feed gaps.
- Pausing OR resuming any MT5 terminal (`.lnk` → `C:\Pause` and back) —
  resume re-enables live trading on an account the operator deliberately
  paused.
- Any `.chr` chart-profile edit (EA parameters).
- Rebooting Windows.
- `npm run db:clean` (TRUNCATEs ALL trading data), `remediate-corrupt-positions.ts --apply` (DELETEs rows — always dry-run first).
- `clear_quarantine` (only after the underlying cause is fixed) and
  `replay_published_outbox` (already gated by its own `--confirm` flag).
- `nssm stop/remove bridge`.

**Never, regardless of phrasing:**

- Use `sc.exe` (or PowerShell `Set-Service`) to control or configure any
  NSSM-managed service — service control on this host is **nssm-only**:
  `nssm status|start|stop|restart <svc>`, and startup/autostart config via
  `nssm set <svc> Start SERVICE_AUTO_START` (never `sc config`). `sc.exe`
  is unusable from agent sessions and `nssm dump` hangs (NSSM config via
  registry `HKLM\SYSTEM\CurrentControlSet\Services\<name>\Parameters` if
  ever needed). Sole exception: native `postgresql-x64-18` (NOT NSSM) —
  `Restart-Service postgresql-x64-18`.
- Start `postgresql-x64-16` — it is installed, stopped, and bound to the SAME
  port 5432 as live PG18. Starting it is an outage.
- `taskkill /IM terminal64.exe` when ONE terminal was named — kills them all.
  Always resolve and kill by PID.
- Launch `terminal64.exe` directly — always start the Startup `.lnk` so the
  terminal gets its portable profile.
- Write file content into the Startup folder or `C:\Pause` — only move `.lnk`s.
- Restart services the deploy diff did not touch.
- Chain pull+build+restart+status into one script — keep them separate,
  verified steps.
- `nssm install <name>` without full binary+args — it opens the NSSM GUI and
  hangs the shell.
- Build or copy `.next/`, `dist/`, `node_modules/` from another machine. Build
  happens ON this box, always.
- Echo secrets into chat/logs/files: `REDIS_URL`, `REDIS_PASSWORD`,
  `DUCKDNS_TOKEN`, `AUTH_SECRET`, `POSTGRES_PASSWORD`, any password. When
  pasting error JSON from `/api/accounts`, mask the embedded `DATABASE_URL`
  password first. Inspect service env with filters
  (`nssm get <svc> AppEnvironmentExtra | Select-String BRIDGE_STATE_DIR`),
  never wholesale dumps.

## Conventions

- Timestamps in reports: Bangkok time (`Asia/Bangkok`) unless labeled UTC.
- After any procedure, verify before reporting success — each reference ends
  with its verification block.
- Gotchas are dated and were verified on this host; if live behavior
  contradicts one, trust the live behavior, note the drift, and tell the
  operator.
