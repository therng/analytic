# Bridge-Only Metric Remap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Active merged plan. This plan supersedes the FTP/shadow-table migration direction in `docs/superpowers/plans/2026-07-02-bridge-ftp-migration.md` and absorbs the still-compatible equity snapshot direction from `docs/superpowers/plans/2026-07-01-equity-line-and-intraday-snapshots.md`.

**Goal:** Rebuild dashboard metric mapping around Bridge/Redis sources only and permanently remove HTML/manual/FTP-era import paths.

**Architecture:** Remove legacy report-file ingestion first, then migrate schema away from report import artifacts, then add a metric registry that documents source/formula/API/display mapping for active dashboard values. Keep the existing API route topology during the first pass to reduce dashboard layout risk.

**Tech Stack:** Next.js App Router, React 19, Node.js worker, Redis, Prisma/PostgreSQL, TypeScript node tests.

## Global Constraints

- Source of truth is Bridge/Redis only.
- Do not map UI values to fields that no longer have an active source.
- `AccountReportResult` remains a derived cache only, recomputed from Bridge/Redis-backed tables.
- Preserve mobile portrait and landscape dashboard layout.
- No Python services are added.
- Use TDD for behavior changes.
- Review Prisma migration SQL before final verification.

## Merged Plan Lineage

- `2026-07-01-equity-line-and-intraday-snapshots.md` remains useful for the `EquitySnapshot` / `PositionExcursion` sampling and 1D equity-line details, but any references to FTP import loops, `WORKER_RUN_ONCE`, `EquityHistory`, or report-derived cache behavior are superseded by this bridge-only plan.
- `2026-07-02-bridge-ftp-migration.md` is historical context only. Do not implement FTP side-by-side validation, Python service expansion, parser comparison scripts, or Bridge* shadow-table validation from that plan unless a new active plan explicitly restores them.
- This plan is the source of truth for current implementation sequencing: Bridge/Redis inputs populate PostgreSQL production tables, and the dashboard consumes only source-backed registry metrics.

---

### Task 1: Remove Manual HTML Import Runtime

**Files:**
- Modify: `package.json`
- Modify: `src/worker/index.ts`
- Test: `src/worker/health.test.ts`

**Interfaces:**
- Produces: worker startup with bridge consumer, equity sampler, and health server only.
- Removes: `WORKER_RUN_ONCE`, `WORKER_FORCE_REIMPORT`, `LOCAL_REPORT_DIR`, file scanning, HTML parsing, and `worker:local`.

- [ ] **Step 1: Write failing worker-runtime test**

Add an assertion that the worker module does not expose manual import helpers and that package scripts do not include `worker:local`.

- [ ] **Step 2: Run test to verify failure**

Run: `node --import tsx --test src/worker/health.test.ts`

- [ ] **Step 3: Remove manual import runtime**

Delete parser/file-import code from `src/worker/index.ts`; keep `runWorker()` bridge-only.

- [ ] **Step 4: Remove package script**

Delete `worker:local` from `package.json`.

- [ ] **Step 5: Verify**

Run: `node --import tsx --test src/worker/health.test.ts`

### Task 2: Remove Parser and Report Scripts

**Files:**
- Delete: `src/lib/parser/index.ts`
- Delete: `src/lib/parser/index.test.ts`
- Delete: report-file scripts that depend on parser/manual import
- Modify: imports/docs referencing parser/manual import

**Interfaces:**
- Removes parser module from product build.
- Keeps bridge mapper and bridge consumer intact.

- [ ] **Step 1: Search parser dependencies**

Run: `rg "lib/parser|parseReport|worker:local|LOCAL_REPORT_DIR|ReportImport|EquityHistory|equityHistory"`

- [ ] **Step 2: Delete parser files and stale scripts**

Use `apply_patch` deletes for files that are no longer referenced after Task 1.

- [ ] **Step 3: Verify no stale references**

Run: `rg "lib/parser|parseReport|worker:local|LOCAL_REPORT_DIR"`

### Task 3: Schema Migration for Report Artifacts

**Files:**
- Modify: `prisma/schema.prisma`
- Add: `prisma/migrations/<timestamp>_drop_report_import_artifacts/migration.sql`
- Modify: code that selected `reportImports` or `equityHistory`

**Interfaces:**
- Removes `ReportImport` and `EquityHistory` models and relations.
- Replaces any `equityHistory` API usage with `EquitySnapshot` or removes unavailable metric.

- [ ] **Step 1: Write failing compile-oriented checks**

Run existing tests after removing type references in a branch of work; TypeScript/build should expose stale references.

- [ ] **Step 2: Edit schema**

Delete `ReportImport`, `EquityHistory`, and relations from `TradingAccount`.

- [ ] **Step 3: Generate migration**

Run: `npx prisma migrate dev --name drop-report-import-artifacts`

- [ ] **Step 4: Review migration SQL**

Confirm it only drops intended report artifact tables and related indexes/constraints.

- [ ] **Step 5: Generate client**

Run: `npx prisma generate`

### Task 4: Add Bridge-Only Metric Registry

**Files:**
- Create: `src/lib/trading/metric-registry.ts`
- Test: `src/lib/trading/metric-registry.test.ts`
- Modify: `src/lib/trading/preaggregated-cache.ts`
- Modify: `src/components/trading-monitor/card/DashboardCard.tsx`

**Interfaces:**
- Produces: metric descriptors with `id`, `source`, `formula`, `timeframe`, `apiField`, and `display`.
- Consumers: API/cache builders and UI KPI construction.

- [ ] **Step 1: Write failing registry test**

Test that every fast-scan KPI has an allowed source and no descriptor references `report`, `html`, `ftp`, or `manual`.

- [ ] **Step 2: Implement registry**

Add descriptors for gain, drawdown, pips, trades, opens, floating P/L, margin, free margin, margin level, commission, swap, deposits, and withdrawals when backed by active sources.

- [ ] **Step 3: Refactor KPI construction**

Use descriptors to build KPI and detail chip values while preserving existing labels and layout.

- [ ] **Step 4: Verify**

Run registry test and relevant trading/UI tests.

### Task 5: Documentation and Final Verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `.gitignore`
- Delete: `prisma/dev.db`

**Interfaces:**
- Docs describe Bridge/Redis-only pipeline.
- Local DB artifacts are ignored.

- [ ] **Step 1: Update docs**

Remove FTP/manual import guidance and parser references. State Bridge/Redis-only source contract.

- [ ] **Step 2: Remove tracked SQLite artifact**

Delete `prisma/dev.db` and add `*.db` ignore rule if needed.

- [ ] **Step 3: Full verification**

Run:

```bash
node --import tsx --test src/worker/bridge-consumer.test.ts
node --import tsx --test src/worker/equity-sampler.test.ts
node --import tsx --test src/lib/trading/metric-registry.test.ts
npm run lint
npm run build
```
