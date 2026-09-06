---
title: vps-ops skill review + refactor — retire pre-migration staleness everywhere
created: 2026-09-06
author: therng
status: approved
---

# vps-ops skill review + refactor — retire pre-migration staleness everywhere

## Context

This morning's liveupdate incident was the skill's failing test (writing-skills Iron Law): `mt5ops.py status` reported DEGRADED with `bridge NOT_FOUND`/`redis-wsl NOT_FOUND` and empty terminal/live blocks mid-incident (retired NSSM names + retired `bridge\accounts\` path), and the operator had to kill rogue processes by hand from pasted PID lists. The script half shipped today (`ee8dcbc`: `term rogue`, truthful status rows, schtasks-dispatching `svc`). **This pass is the REFACTOR leg: sweep every skill file for the same retired-topology staleness, contradictions, and dangerous guidance**, verified against live host truth (checked read-only this session — not from memory).

Verified truth baseline: bridge = schtasks `analytic-bridge` (log `bridge-task.log` live; `bridge-stdout.log`/`-stderr.log` are 0-byte NSSM leftovers), redis = WSL systemd + `analytic-redis-wsl-keepalive` ONLOGON task, web/worker/caddy = NSSM, postgres = native, accounts = `bridge\state\discovered-accounts\` (5 logins verified), bridge restart warmup = ~5-6 min, `install-service.ps1` = pure NSSM installer whose only reusable part is the `icacls` journal-DACL block, `set-broker-utc-offset.ts 0 --list` = correct form (exit 0).

## Changes (by file)

1. **SKILL.md** — intro: bridge = `analytic-bridge` scheduled task, not NSSM; Never-list: `nssm stop/remove bridge` → `schtasks /End analytic-bridge`.
2. **mt5ops.md** — schtasks mechanism in the svc-stop pitfall + 5-6 min warmup (kill the "2-3 min" contradiction); stack/redis-wsl refusal reality; drop false hermes-gateway status line; svc dispatch note; Verification path → `discovered-accounts`.
3. **status-summary.md** — §2 services block → `mt5ops.py status` + manual fallback naming only live control surfaces; §10 `bridge-stdout.log` → `bridge-task.log`; journal-failure triage repair → direct `icacls` DACL commands (install-service.ps1 re-run would reinstall the retired NSSM service).
4. **deploy.md** — full-restart: `nssm restart redis-wsl` → `wsl … systemctl restart redis-server`.
5. **service-install.md** — §2 redis → WSL systemd + keepalive task registration (from live XML); §4/§5 DependOnService → postgres only; §7 bridge → schtasks /Create of run-bridge-task.ps1; final verification via Get-ScheduledTask.
6. **ea-inputs.md** — pause/resume wording aligned with mt5ops semantics (pause moves .lnk only; term close stops).
7. **host-facts.md** — mt5ops svc restart bridge pointer; logins hedge → verified 2026-09-06.
8. **INSTALL.md** — second mirror destination (hermes).
9. **mt5ops.py** — `stack --all` postgres via Stop/Start-Service (native exception), not nssm.
10. **CLAUDE.md** — `set-broker-utc-offset.ts 0 --list` (separate commit).

## Explicitly NOT changing

- `install-service.ps1` itself (bridge repo code; retiring it is a repo decision).
- ea-inputs Step 3 `/F` kill (deliberate `.chr`-protection scar-rule).
- deploy.md Step 5 restart table + rollback (already corrected in 8.76).

## Verification

Grep sweeps for retired tokens → zero un-annotated hits; live checks (`status` exit 0, `svc status bridge`, `term rogue`, `wsl redis-cli ping`); `py_compile`; docs-impact + CHANGELOG; scoped commits; mirror sync to both destinations; no push without version-bump confirm.
