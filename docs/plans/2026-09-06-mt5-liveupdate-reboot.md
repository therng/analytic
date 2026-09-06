# Restart computer to complete MT5 terminal updates (operator decision)

## Context

Operator asked to "delete all the process that run the terminal directly" — terminals had been
opened NOT via the Startup folder with broken EAs. Operator killed 8 processes manually, then
asked me to find any remaining unauthorized ones. Investigation complete — findings:

- **No unauthorized launcher exists or remains.** Only MT3 (PID 8000, explorer-launched via
  Startup `.lnk`) and MT7 (PID 1100, liveupdate self-respawn) are running; both originated from
  the sanctioned logon path. No scheduled task / Run key / repo code launches terminals.
- **Root cause of the broken morning:** MT5 auto-update (LiveUpdate, build 6180) — at 06:42
  logon every terminal exited to self-update; MT1/MT5/MT9 never relaunched (dead since 06:42),
  MT7 relaunched at 06:44 **without its EA** (`C:\MT7\MQL5\Logs\` empty). The 8 processes the
  operator killed were the stuck liveupdate children — correct call.
- MT3 is the only fully healthy terminal (EA `SMA100PushAlertEA` loaded, journal writing).

Operator decision (stated twice): since all 5 Startup-folder terminals need the update anyway —
**restart the computer**. At logon all terminals relaunch via `.lnk` with the now-cached update.

## Plan (host ops only — no repo code changes)

### 1. Restart the computer

```
python C:\analytic\.claude\skills\vps-ops\scripts\mt5ops.py restart-computer
```

This runs `shutdown /r /t 30` (30 s grace; terminals get WM_CLOSE and save state — this
morning's 06:41 shutdown was clean, exit code 0). **If access is denied** (typical for agent
sessions per the runbook), hand the operator the exact command instead: `shutdown /r /t 30`.

Note: this Claude Code session runs on the host and ends at reboot — the verification below
happens after, in a fresh session or run by the operator.

### 2. Post-reboot verification (new session / operator)

At logon, auto-start order: `analytic-redis-wsl-keepalive` (ONLOGON) → NSSM services (web,
worker, caddy) + `analytic-bridge` task + 5 terminal `.lnk`s. Give the stack 5 minutes
(worker boot noise while Redis settles is normal), then:

```
python C:\analytic\.claude\skills\vps-ops\scripts\mt5ops.py reboot-check --wait 300
python C:\analytic\.claude\skills\vps-ops\scripts\mt5ops.py status
```

Pass criteria: final line `REBOOT-CHECK: PASS`, all 5 terminals running, live keys fresh.

Per-terminal EA check (the signal that was missing on MT7 today):
- `C:\MT<x>\logs\20260906.log` → `expert ... loaded successfully` line
- `C:\MT<x>\MQL5\Logs\20260906.log` exists / non-empty

### 3. Failure-mode recovery (only if liveupdate repeats this morning's failure)

- A terminal stays down after logon → `python <mt5ops> term start MT<x>` (launches ONLY the
  `.lnk` — never `terminal64.exe` directly). Retry once if it exits again for liveupdate;
  the second start runs the already-updated build. Still failing → stop and report.
- MT7 EA still not attached after reboot → escalate to `.chr` chart-profile procedure in
  `.claude/skills/vps-ops/references/ea-inputs.md` (confirm with operator before any `.chr` edit).

## Follow-up (surface to operator later, not this pass)

- Nothing runs `reboot-check` automatically after reboot; a post-boot terminal guard (hook into
  the existing 5-min `analytic-worker-health-probe` task, or an ONLOGON alert task) would have
  caught this at 06:42 instead of mid-morning. PM decision.
- Record the liveupdate mass-restart failure mode in vps-ops `references/mt5ops.md` pitfalls
  via the normal docs-sync flow.
