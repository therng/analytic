# TODO

## Bridge cutover (active)

Spec: `docs/superpowers/specs/2026-07-02-bridge-ftp-migration-design.md`
Plan: `docs/superpowers/plans/2026-07-02-bridge-ftp-migration.md`

Tasks 1-10 of the plan are implemented and merged to `main` (schema, `bridge/tracking.py`,
history sync, close-detection events, `bridge-mapper.ts`, `bridge-consumer.ts`,
AccountSnapshot/OpenPosition sync, validation scripts, and docs). The worker now runs in
Bridge/Redis-only mode.

- [ ] Monitor bridge stream ingestion and worker health across all accounts
- [x] Flip `bridge-consumer.ts` target models from `bridgeDeal`/`bridgeOrder`/`bridgePosition`
      to the real `deal`/`order`/`position` tables
- [x] Remove the remote report import path from the continuous worker and Docker config
- [ ] Monitor one full week post-cutover
- [x] Remove HTML parser/manual local backfill path permanently
- [ ] Remove the `Bridge*` shadow tables when no longer needed

## Housekeeping

- [ ] Untracked `.agents/`, `.codex/agents/`, `.codex/hooks.json`, `.codex/hooks/`, `Modelfile`
      at repo root — confirm whether these are intentional local tooling or should be
      committed/gitignored
- [ ] Local `main` is 1 commit ahead of `origin/main` (bridge cutover work) —
      push when ready (remember version bump per CLAUDE.md)
