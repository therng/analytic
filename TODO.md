# TODO

## Bridge cutover (active)

Spec: `docs/superpowers/specs/2026-07-02-bridge-ftp-migration-design.md`
Plan: `docs/superpowers/plans/2026-07-02-bridge-ftp-migration.md`

Tasks 1-10 of the plan are implemented and merged to `main` (schema, `bridge/tracking.py`,
history sync, close-detection events, `bridge-mapper.ts`, `bridge-consumer.ts`,
AccountSnapshot/OpenPosition sync, validation scripts, and docs). The worker now runs in
Bridge/Redis-only mode.

- [x] Monitor bridge stream ingestion and worker health across all accounts —
      verified 2026-07-12: `GET /api/accounts` on prod shows all 4 accounts with
      `last_updated` within seconds of request time, `/api/health` returns `ok`
- [x] Flip `bridge-consumer.ts` target models from `bridgeDeal`/`bridgeOrder`/`bridgePosition`
      to the real `deal`/`order`/`position` tables
- [x] Remove the remote report import path from the continuous worker and Docker config
- [x] Monitor one full week post-cutover — bridge-only mode shipped 2026-07-02/04
      (`bridge-only-runtime.test.ts`, no FTP refs left in `src/worker/` or
      `docker-compose.yml`); 8-10 days elapsed as of 2026-07-12 with healthy live
      ingestion confirmed above
- [x] Remove HTML parser/manual local backfill path permanently
- [x] Remove the `Bridge*` shadow tables when no longer needed — confirmed absent from
      `prisma/schema.prisma` and no remaining code references

## Housekeeping

- [x] Untracked `.agents/`, `.codex/agents/`, `.codex/hooks.json`, `.codex/hooks/`, `Modelfile`
      at repo root — local AI-agent tooling, not project source; gitignored alongside `.gemini/`
- [x] Local `main` is 1 commit ahead of `origin/main` (bridge cutover work) — pushed
