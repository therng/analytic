# Incident: 2026-09-06 MT5 liveupdate — terminals dead or EA-less at logon, update dance replayed every boot

## Impact

- **4 of 5 accounts degraded or dark** at the 06:42 logon: MT1/MT5/MT9 exited to self-update (LiveUpdate build 6180) and never relaunched; MT7 relaunched at 06:44 **without its EA** (`C:\MT7\MQL5\Logs\` empty); only MT3 stayed fully healthy. Live collection ran stale until manual recovery mid-morning.
- **Zero persisted-data loss** — positions live server-side, Redis is a mirror only, bridge journals intact. The damage was ingestion downtime plus operator time (8 stuck liveupdate children killed by hand, a reboot, then 2 leftover staging duplicates force-killed).
- MT7 and MT9 ended the day **authorized but EA-less** — unexplained at the time; root cause landed 2026-09-07 (desktop heap, below).

## Detection

- Operator noticed terminals "opened NOT via the Startup folder with broken EAs" and manually killed the 8 stuck liveupdate children before asking for investigation (mid-morning).
- No automated post-boot terminal guard existed — the 5-min `analytic-worker-health-probe` task watches services/Redis, not terminal or EA attachment. Follow-up recorded in `docs/plans/2026-09-06-mt5-liveupdate-reboot.md`.

## Root Cause

MetaQuotes' liveupdate swap of `terminal64.exe` never completes on its own on this 5-terminal single host — downloads and staging under `%APPDATA%\MetaQuotes\Terminal\<hash>\liveupdate\` always succeed (Defender real-time is off), but the unpack+swap step fails under **cross-terminal contention**: killing the whole fleet at once lets MT5's own dance finish in seconds. Two failure shapes:

1. On swap failure the terminal relaunches the OLD build with `/skipupdate:<md5>` — that flag lives only for the running process, so **every logon/reboot replays the dance** (2–6 min stop per terminal). MT3 had been stuck on 5833 since April, in this loop since the 6061 wave in July.
2. The `/update` copier hangs with **no fallback** — that account dies silently (MT9/7954220 on 2026-09-07, twice).

The EA-less symptom is **desktop-heap exhaustion**, not attach logic: the default `SharedSection=1024,20480,768` (20 MB interactive heap) fits only 4 × build-618x terminals — the 5th to start logs `MDI create failed` / `create new frame ... failed`, comes up authorized but chart-less, so its EA never attaches (empty `MQL5\Logs`). Rapid start/die flapping after mass restarts exhausts the heap even sooner ("not enough handles to start the platform"); a reboot resets it.

## Resolution (2026-09-06)

- Operator reboot (~07:39) completed the 6180 cascade — install-dir exes replaced, terminals relaunched with `/skipupdate` — and the leftover staging duplicates (PIDs 7532, 9504) were force-killed ~07:49; bridge reattached, 5/5 live keys fresh.
- `mt5ops.py` learned `term rogue [--kill]` (classify ok/nonportable/staging-duplicate/updater/unknown; kill only by PID).
- MT7/MT9 EA-less state deferred to the `.chr` chart-profile procedure (`vps-ops/references/ea-inputs.md`), operator-confirm first.

## 2026-09-07 update — build 6182, mt5update.ps1, and the desktop-heap root cause

- Build 6182 (released 2026-09-06 ~23:43) staged everywhere but was **never applied by MT5 itself** — the swap failure is cross-terminal contention, not the payload. After the 17:41 reboot left MT9 dead again (hung copier PID 10832), `mt5update.ps1` (`-Mode Detect|Apply|Watch`: Authenticode + exact-build gate, per-terminal `terminal64.exe.bak-<oldbuild>` backups, full rollback on any failure, FAIL marker) applied 6182 **fleet-wide 5/5** (5833/6090/6140 → 6182), and the `analytic-mt5-update-watch` scheduled task was registered (`9f70f3a`, 8.81).
- The stale-staging dance hung **MT9's copier twice**: leftover staging components made even an already-6182 terminal re-run the dance at every cold start (PID 10832 after the 17:41 reboot; PID 884 for 45+ min after the 18:57 reboot). Both times: kill the copier by PID → purge staging contents under every `...\Terminal\<hash>\liveupdate\` → restart via `.lnk` → clean 6182 cold start with EA attached. Watch now auto-heals both (kill `/update` copiers >15 min + restart the terminal via `.lnk`; purge stale staging when the fleet is up-to-date) — `3d8bf3d`, 8.82.
- **Desktop heap confirmed as the EA-killer** behind the 2026-09-06 EA-less terminals (and MT1's post-apply flap, self-recovered 19:00:40). Durable fix: raise the interactive heap (`SharedSection` second number 20480→40960 in `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Subsystems`) + reboot — operator-gated, being applied the evening of 2026-09-07.

## Prevention

- `analytic-mt5-update-watch` scheduled task (ONLOGON +PT2M delay + hourly repeat, `analyticvps\supachai` HIGHEST, hidden powershell): applies fully-staged builds signature-gated to every Startup-folder terminal and reboots; a FAILED marker in `C:\analytic\logs\mt5update\` suppresses auto-runs until the operator clears it — no hourly kill/retry loops after a failure.
- Watch self-heal: hung `/update` copiers (>15 min) killed by PID and their terminal restarted via `.lnk`; stale liveupdate staging purged once the fleet is up-to-date (never while a newer payload is still staged).
- Interactive heap raise to 40960 — durable fix for the 5th-terminal EA-less failure mode.
- Runbook signals (vps-ops `references/mt5ops.md` § mt5update): empty `MQL5\Logs` = EA not attached (think heap, not attach logic); rapid start/die flapping after mass restarts = heap exhaustion → reboot resets.

## Evidence

- 2026-09-06 records: `docs/plans/2026-09-06-mt5-liveupdate-reboot.md`, `docs/plans/2026-09-06-kill-liveupdate-staging-duplicates.md`.
- 2026-09-07 narrative + spec: `docs/plans/2026-09-07-mt5-auto-update-maintenance.md`; commits `9f70f3a` (8.81), `3d8bf3d` (8.82); CHANGELOG 8.81/8.82 operations entries.
- Mechanism + host facts: `.claude/skills/vps-ops/references/mt5ops.md` § mt5update; `C:\analytic\logs\mt5update\mt5update.log`.
- Terminal-side: `C:\MT<x>\logs\` (`MetaTrader 5 x64 build <N> started`, `MDI create failed`) and empty `MQL5\Logs` as the EA-not-attached signal.
