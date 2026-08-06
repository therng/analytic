# ADR-0004: Retire FTP report polling in favor of the bridge/Redis path

## Status

Accepted

## Date

2026-07-12

## Context

Before the bridge/Redis ingestion path existed, account data arrived via FTP
polling of MT5-generated HTML reports. This tied ingestion correctness to
report-file format, FTP availability, and file-hash dedup logic, and gave no
path to durable, replay-safe history the way a bridge/Redis/PostgreSQL
pipeline could. Once the bridge-based design (design spec + implementation
plan, 2026-07-02) was ready, the two ingestion paths needed to run in
parallel briefly to validate correctness before FTP could be safely turned
off.

## Decision

Add a kill switch (`FTP_IMPORT_ENABLED`, defaulting to enabled — no behavior
change on introduction) so disabling the FTP poll loop became a one-line env
change instead of a code edit. Validate the bridge path in production for a
monitoring window, then flip the switch and remove the FTP path entirely.

## Alternatives Considered

### Cut over in one step, no parallel-run window

- Pros: simpler, no dual-ingestion period.
- Cons: no way to compare bridge-derived Position/Deal records against the
  known-good FTP path before trusting the new pipeline with production
  account data.
- Rejected: a dedicated bridge-vs-FTP comparison script was built
  specifically to validate the new path before cutover, which requires both
  paths to coexist.

### Keep FTP as a permanent fallback

- Pros: a safety net if the bridge path ever regresses.
- Cons: doubles the ingestion surface permanently, keeps file-hash dedup and
  HTML-report-format coupling alive indefinitely, and duplicates the
  "authoritative source" contract that bridge/Redis/PostgreSQL now owns.
- Rejected: current guardrails (`AGENTS.md`) explicitly forbid reintroducing
  it, treating this as a one-way migration, not a fallback design.

## Consequences

- `AGENTS.md`:10 — "Worker Bridge/Redis-only. Don't reintroduce FTP, HTML
  report parsing, manual local import, file-hash dedup, or UI mappings to
  fields not in Bridge/Redis/PostgreSQL path."
- `bridge-ingestion-review` skill's validation checklist explicitly checks:
  "No FTP, HTML report, manual import, or file-hash path is reintroduced."
- `prisma/migrations/20260704000000_drop_report_import_artifacts/` removed
  the database tables that only supported legacy FTP/manual HTML report
  imports.
- Any future ingestion-path regression must be diagnosed and fixed within the
  bridge/Redis/PostgreSQL pipeline — there is no FTP path to fall back to.

## Evidence

- `af440ba` (2026-07-02) — "docs: document bridge history sync, tracking, and
  FTP cutover procedure."
- `bea2673` (2026-07-02) — "feat(scripts): add bridge-vs-FTP Position/Deal
  comparison script for validation" — the parallel-run validation mechanism.
- `7bb14c1` (2026-07-02) — "feat(worker): add FTP_IMPORT_ENABLED kill switch
  for bridge cutover" — "Prepares the documented cutover procedure... so
  disabling the FTP poll loop is a one-line env change instead of a code
  edit. Defaults to enabled, no behavior change."
- `2456e7f` (2026-07-12) — "docs: close remaining bridge-cutover TODO items"
  — "Verified live: prod `/api/accounts` shows all 4 accounts updating within
  seconds, `/api/health` ok. Bridge-only mode has been live since
  2026-07-02/04 (8-10 days, no FTP path in worker or Docker config) — one-week
  monitoring window satisfied." This is the commit confirming FTP was fully
  retired.
- `prisma/migrations/20260704000000_drop_report_import_artifacts/migration.sql:2`
  — "Removes tables that only supported legacy FTP/manual HTML report
  imports."
- `AGENTS.md`:10 and `.agents/skills/bridge-ingestion-review/SKILL.md`:45 —
  current standing guardrails against reintroduction.
