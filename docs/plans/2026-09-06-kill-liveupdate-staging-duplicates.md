---
title: Kill staging liveupdate duplicates 7532 / 9504 (operator-ordered)
created: 2026-09-06
author: therng
status: implemented
---

# Kill staging liveupdate duplicates 7532 / 9504 (operator-ordered)

Status: **executed 2026-09-06 ~07:49 — success**. Companion to
`2026-09-06-mt5-liveupdate-reboot.md` (the reboot this followed up on).

## Context

Operator asked why `C:\MT3\terminal64.exe` (PID 6548) was "running direct again". Read-only investigation (07:39–07:48):

- **PID 6548 was NOT a direct run.** CommandLine = `"C:\MT3\terminal64.exe" /portable`, parent = explorer.exe, created 07:39:57 (42 s after boot 07:39:15) — the sanctioned Startup `.lnk` logon launch.
- The long AppData paths in the operator's process list were **liveupdate staging binaries** (`...\Terminal\<hash>\liveupdate\terminal64.exe`), truncated so the `liveupdate\` tail was invisible. Build 6180 update cascade ran at logon; updater children replaced install-dir exes and relaunched real terminals with `/skipupdate:<hash> /portable`.
- **Leftover problem:** MT1 and MT9 each had TWO terminal instances — the real install-dir terminal (9320, 3968) plus a staging-dir duplicate that never exited (7532, 9504). Operator ordered both killed by PID.

## Execution

1. Graceful `taskkill /PID` failed — staging processes have no reachable window ("can only be terminated forcefully"), as expected for liveupdate staging.
2. `taskkill /F /PID 7532` + `/PID 9504` — both terminated.
3. Exactly 5 install-dir `/portable` terminals remained (MT3 6548, MT7 9056, MT9 3968, MT5 3216, MT1 9320).

## Verified end state

- Worker-v2 `:9200/health`: `healthy: true`, all components ok, live sync fresh for all 5 accounts.
- Bridge supervisor + 5 worker children alive (attached to the install-dir terminals — none died at the kill).
- `mt5ops.py status` (post-fix): `STATUS: OK` — bridge task Running, redis TCP up, 5 terminals mapped folder↔login↔pid, live TTLs 55–59 s.
- EA attached: MT1 ✓, MT3 ✓ (07:40), MT5 ✓ (Quantum Queen EA 07:44:23). **MT7 and MT9 have no EA attached** (no expert-loaded journal line today, no `MQL5\Logs\20260906.log`) — remediation is the `.chr` chart-profile procedure in `vps-ops/references/ea-inputs.md`, operator-confirm first. Not done in this pass.

## Follow-ups shipped alongside

- `mt5ops.py` learned `term rogue [--kill]` (classify ok/nonportable/staging-duplicate/updater/unknown; default list-only; `--kill` = `taskkill /F` by PID) — covers both this incident's staging duplicates and direct (non-portable) runs.
- `status` staleness fixed: accounts now read `bridge\state\discovered-accounts\`, `bridge` row = `analytic-bridge` task state, `redis-wsl` row = TCP 6379 probe, hermes-gateway dropped from the gate; `svc restart bridge` now drives schtasks End/Run.
