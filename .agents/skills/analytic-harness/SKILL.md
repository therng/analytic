---
name: analytic-harness
description: Coordinate non-trivial changes to the analytic trading platform through scoped discovery, implementation, domain review, and verification. Use for fixes or features that touch trading analytics, Bridge/Redis/Postgres ingestion, Prisma data contracts, or responsive dashboard behavior; answer simple questions directly.
---

# Analytic Harness

## When to Use

- Use for code changes where a wrong source boundary, history checkpoint, schema contract, or responsive layout can silently corrupt behavior.
- Use for multi-file fixes and features in `src/lib/trading/`, `src/worker*`, `bridge_v2/`, `prisma/`, account APIs, or `src/components/trading-monitor/`.
- Do not use for a read-only question, typo-only edit, dependency-only task, or an isolated change with an obvious local test.

## Required Inputs

- The user's requested outcome and acceptance criteria.
- Current `git status`, because unrelated work may already be present.
- `AGENTS.md` and the relevant portions of `CLAUDE.md`.
- The implementation files, nearest tests, and relevant plan or architecture docs.

## Workflow

### 1. Scope

1. Inspect the worktree before editing and preserve unrelated changes.
2. Classify the affected domains:
   - analytics and metric semantics
   - Bridge/Redis/worker/Postgres ingestion
   - Prisma schema or migration
   - dashboard UI and responsive behavior
3. Record a concise change contract in the working thread. For work that must be resumed, audited, or handed between workers, write `_workspace/00_input/request-summary.md`.
4. Identify exact files, tests, commands, permissions, and shared mutable resources before implementation.

### 2. Plan

Create the smallest ordered plan that reaches the requested outcome. Name:

- the intended behavior
- the authoritative source for each changed value
- files expected to change
- focused tests and final checks
- rollback or migration concern when ingestion or schema behavior changes

Persist `_workspace/01_plan_change.md` only when the plan is a durable handoff. A short in-thread plan is enough for tightly coupled work.

### 3. Implement

1. Make incremental, minimal changes.
2. Add or update focused tests with the implementation.
3. Preserve the rules in `AGENTS.md`; do not introduce fields or fallbacks outside the Bridge/Redis/Postgres path.
4. Serialize shared writes and stateful tests. Parallel work is allowed only for independent read-heavy investigation, review, or isolated tests with explicit ownership.

### 4. Review

Select only the relevant repo-local reviewers:

- `.agents/skills/trading-analytics-review/SKILL.md`
- `.agents/skills/bridge-ingestion-review/SKILL.md`
- `.agents/skills/dashboard-responsive-review/SKILL.md`

The coordinator remains synthesis owner. Review can be performed directly from the relevant skill or delegated when the slices are independent and the runtime permits it. If review findings need audit or handoff, write `_workspace/02_review_{domain}.md` with `pass`, `fix`, or `blocked`, evidence, and required action.

### 5. Verify

1. Run the narrowest relevant tests first.
2. Run `npm run lint`.
3. Run `npm run build` for application changes.
4. For Bridge/worker/history changes, use the focused verification block in `CLAUDE.md`; run opt-in integration tests only when their isolated services and explicit flags are available.
5. For dashboard changes, verify portrait and landscape at representative mobile viewports and preserve screenshots when visual behavior changed.
6. Inspect the final diff for unrelated edits, source-boundary violations, and unreviewed migrations.
7. Run `git diff --staged` (or the equivalent full diff) and check every added line for credentials: `REDIS_PASSWORD`, `DATABASE_URL` connection strings, `DUCKDNS_TOKEN`, API keys, or a new `.env*` file other than `.env.test.example`. Treat any match as blocking, not a note in the final report.

## Outputs

- Completed code and focused tests.
- A concise final report listing user-visible behavior, changed paths, checks run, and checks not run.
- Optional durable artifacts:
  - `_workspace/00_input/request-summary.md`
  - `_workspace/01_plan_change.md`
  - `_workspace/02_review_{domain}.md`
  - `_workspace/03_verification.md`

Do not create `_workspace/` files for small work when the thread itself is sufficient.

## Failure Policy

- Stop before implementation when authoritative behavior cannot be determined from the request, code, tests, or repository docs and a reasonable assumption would materially alter the result.
- If a focused test fails, determine whether it exposes the requested defect, a regression from the change, or unrelated pre-existing state before editing further.
- If a reviewer returns `fix`, make one targeted revision and repeat the affected review and tests. Escalate unresolved semantic conflict instead of looping indefinitely.
- If an integration dependency is unavailable, complete safe unit/static checks and report the exact unverified boundary.
- Never repair partial or conflicting parallel writes through blind synthesis; serialize or isolate the writers first.

## Validation

- Every changed metric has one authoritative source and matches `src/lib/trading/metric-registry.ts` where displayed.
- Every ingestion checkpoint advances only after its complete durable commit conditions.
- Prisma changes include reviewed migration implications.
- Dashboard changes retain chart-first behavior, 44×44pt touch targets, and both mobile orientations.
- Final claims cite commands actually run and their outcomes.

## Team Contract

Read `docs/harness/analytic/team-spec.md` when coordinating a durable handoff, choosing reviewers for a cross-domain change, or delegating independent review slices.
