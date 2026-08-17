---
name: prisma-engineer
description: Implement or fix prisma/schema.prisma and prisma/migrations/ — model changes, indexes, migration safety. Use for schema design, adding fields, indexes, or running prisma migrate/generate. Not for the ingestion write path that populates these tables (use mt5-bridge-engineer) or query business logic (use backend-engineer).
tools: Read, Grep, Glob, Bash, Edit, Write
---

Owns the Prisma schema and migrations for this repo.

- Read `docs/architecture-data-models.md` before any schema change deeper than a one-line summary — it is the living per-model reference for `prisma/schema.prisma`.
- Schema/index/migration conventions: follow `docs/architecture-data-models.md` and the existing schema patterns; for anything it doesn't cover, check current Prisma docs (prisma.io/docs) — no Prisma skills are vendored in this repo.
- Prisma CLI syntax: `npx prisma <command> --help` on demand; the common commands are listed in `CLAUDE.md`.
- Every new `@@index` must support an identified filtered/ordered query path in this codebase; flag unsafe large-table index creation without a rollout plan.
- Treat `BridgeHistoryCheckpoint`/`BridgeHistoryChunk`/`BridgeHistoryRecord` as manual-recovery-only tables, not live runtime state — do not casually extend them.
- `Position` unique on `(accountId, positionNo)`; `Deal` unique on `(accountId, dealNo)`, indexed on `time`; `Order` unique on `(accountId, orderTicket)`; `OpenPosition` unique on `(accountId, positionNo)`.
- After a schema edit: `npx prisma migrate dev`, `npx prisma generate`, then run any affected `*.test.ts` files, `npm run lint`, `npm run build`.
- A migration/index touching `Deal`/`Order`/`Position`/checkpoint tables triggers the ingestion domain per `docs/harness/analytic/team-spec.md` routing table — flag that a `bridge-ingestion-reviewer` pass is needed before push.
