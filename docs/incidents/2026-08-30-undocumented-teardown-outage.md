# Incident: 2026-08-30 undocumented teardown — 13-hour full-stack outage during an active incident

## Impact

- **~13 hours total outage** (site + ingestion dark, 2026-08-30 01:55 → ~17:00 Asia/Bangkok): public dashboard unreachable, all 5 MT5 terminals trading with zero collection.
- **Zero persisted-data loss**: PostgreSQL 18 was never touched — all 37 migrations and the full dataset (57,491 Deals across 5 accounts) survived intact. Redis loss was bounded by design (mirror only).
- All five NSSM service registrations were deleted, forcing a from-scratch service-tier rebuild under degraded conditions (operator password unavailable → LocalSystem identity).

## Detection

- 01:55 — web tier began throwing `InvariantError: client reference manifest` 500s (same class as the 8.71 react-pinning incident).
- The teardown itself was **undocumented** — discovered only by reconstructing the host System event log against the migration progress log: ordered service stops + NSSM deregistrations, then reboot (event 1074 at 02:31:16). No commit, log, or CHANGELOG entry recorded who/why.
- No external monitor existed at the time; the outage was bounded by operator presence, not detection.

## Root Cause

**Process failure, not a technical defect.** The `InvariantError` was trigger context, not the outage cause. The 13-hour extent came from a destructive, unlogged teardown executed *during* an active incident:

1. All five services stopped and NSSM registrations removed (02:24–02:31), eliminating the recovery path (restart) in favor of full reinstall.
2. The documented service identity `analyticvps\supachai` could not be used for the rebuild (password unavailable in-session) → NSSM services reinstalled as LocalSystem — a deviation that then cascaded:
3. LocalSystem bridge attempt failed on session-0 journal ACLs (SYSTEM-owned WAL/SHM sidecars → permanent LOCKED, the 2026-08 journal-ACL failure mode), and all 5 accounts were left quarantined (`journal_failure` survives restarts by design).
4. Redis-in-WSL2 terminated when its last session ended (~60 s), repeatedly killing the loopback relay until the `analytic-redis-wsl-keepalive` ONLOGON task held a session open.

## Resolution

- **15:10–16:15** — service-tier rebuild: NSSM reinstalled (LocalSystem), surviving 8.71 standalone build smoke-tested on :3100 before install (clean — no InvariantError), Caddy re-served `https://therng.duckdns.org` using pre-teardown cert storage copied into the LocalSystem profile.
- **17:00** — bridge restored on the task-based topology that is now canonical: `analytic-bridge` ONLOGON scheduled task (supachai, console session) replacing NSSM. Journal ACLs re-owned to `analyticvps\supachai`; 5-account quarantine cleared via `bridge.scripts.clear_quarantine`; all 5 logins re-leased.
- Shipped in 8.72 with the full postmortem narrative in `docs/superpowers/plans/2026-08-17-windows-single-host-migration.md` (progress-log 2026-08-30 entries).

## Prevention

- `analytic-worker-health-probe` scheduled task (5-min; watches `:9200/health` **and** Redis 6379) — the missing external detection layer.
- `analytic-redis-wsl-keepalive` ONLOGON task — structural fix for the WSL2 session-termination relay kill.
- Standing rails: service control is **nssm-only / scheduled-task** (never `sc.exe`), destructive host operations require operator confirmation, and **teardowns must get a same-session CHANGELOG entry** — an unlogged teardown during an incident is the failure mode this postmortem exists to prevent.
- Bridge restart procedure documented as `schtasks /End` + `/Run /TN analytic-bridge` (vps-ops `deploy.md` / `host-facts.md`, corrected 2026-09-06).

## Evidence

- System event log: restart 2026-08-29 21:28 (the legitimate Task 7 reboot test), teardown reboot event 1074 2026-08-30 02:31:16 (re-verified 2026-09-06 closeout probes).
- Migration plan progress log `:648-655` (2026-08-30 entries + 17:00 bridge-restored entry); CHANGELOG 8.72.
- PG data continuity: `Deal` count 57,491 (2026-08-30) → 60,537 (2026-09-06) — no gap, no loss.
