# vps-ops — install onto the forexvps host

This folder is the skill. Source of truth is the analytic repo:
`.claude/skills/vps-ops/` (on the VPS checkout that is
`C:\analytic\.claude\skills\vps-ops\`; `.agents/skills/vps-ops` in the repo
is a symlink to it — dead text on Windows checkouts, by repo convention).
Hermes loads its skills from a user-level directory, not from the repo, so
the runtime copy lives separately.

## Install (on the VPS, after the repo is up to date)

```powershell
cd C:\analytic
git pull
robocopy C:\analytic\.claude\skills\vps-ops C:\Users\supachai\.agents\skills\vps-ops /E
```

(after the copy, `C:\Users\supachai\.agents\skills\vps-ops\SKILL.md` must
exist).

From macOS, tar-over-ssh also works (the VPS default SSH shell is
PowerShell):

```bash
cd <repo>/.claude/skills && tar --exclude='.DS_Store' -cf - vps-ops \
  | ssh forexvps 'tar -xf - -C "C:/Users/supachai/.agents/skills"'
# macOS tar pipes AppleDouble junk — clean it after:
ssh forexvps 'Get-ChildItem "C:\Users\supachai\.agents\skills\vps-ops" -Recurse -Force -Filter "._*" | Remove-Item -Force'
```

## First run (do once, with hermes)

1. Ask for a status summary: "ส่งสรุปสถานะ VPS ให้หน่อย" — this exercises
   `references/status-summary.md` end to end (gather → compose → Photon SMS
   send via `mt5ops.py notify`).
2. Spot-check a few facts against the live host the skill flags as
   unverified (`references/host-facts.md` → "Unverified on host"):
   terminal count/paths, `analytic-pg-dump` + health-probe scheduled tasks,
   `nssm get bridge ObjectName`, `netstat -ano | findstr :9200`.
3. `python <skilldir>/scripts/mt5ops.py status` — exits 0, three real blocks
   (services / terminals / live keys), no "unknown" values.

## Feedback loop

Anything wrong on the real host (service name drift, a step that fails, a
script flag that no longer exists) — report it back so the skill gets
corrected. The skill itself says: live behavior beats the doc; drift should
be reported.

## Contents

- `SKILL.md` — platform guard, routing, safety rules (start here)
- `references/host-facts.md` — service inventory, paths, exit codes, stale-doc map
- `references/status-summary.md` — health gather + SMS compose/send (Photon sidecar)
- `references/mt5ops.md` — MT5 terminal + service stack control (`scripts/mt5ops.py`)
- `references/deploy.md` — git pull → rebuild → targeted restart → verify
- `references/service-install.md` — first-time NSSM install (ordered)
- `references/ea-inputs.md` — `.chr` chart input edit runbook
- `scripts/mt5ops.py` — MT5/service ops helper (status/svc/term/pause/notify)
