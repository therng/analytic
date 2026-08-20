---
name: analytic-harness
description: Use when making non-trivial code or documentation changes to the analytic trading platform, especially across trading analytics, Bridge/Redis/Postgres ingestion, Prisma contracts, responsive dashboard behavior, or repository documentation that must match verified implementation and runtime state.
---

# Analytic Harness

## When to Use

- Code changes where a wrong source boundary, history checkpoint, schema contract, or responsive layout can silently corrupt behavior.
- Multi-file fixes and features in `src/lib/trading/`, `src/worker*`, `bridge/`, `prisma/`, account APIs, `src/lib/redis-mt5*`, or `src/components/trading-monitor/`.
- Documentation updates that must reconcile code, tests, runtime evidence, operator decisions, and current external library/API documentation.
- Not for read-only questions, typo-only edits, dependency-only tasks, or isolated changes with an obvious local test.

## Required Inputs

- Requested outcome and acceptance criteria; current `git status` (unrelated work may be present).
- `AGENTS.md`, relevant `CLAUDE.md` sections, implementation files, nearest tests, relevant plan or architecture docs.
- For documentation work: the claims being updated, their evidence sources, and the canonical document for each claim.

## Workflow Selection

- **Implementation path:** the five-step workflow below.
- **Documentation-maintenance path:** when the deliverable is documentation, follow `references/documentation-maintenance.md` instead. Documentation-only work must not modify runtime code unless the user explicitly expands scope.
- Use installed process skills when their triggers apply: brainstorming before changing reusable workflows or behavior contracts; systematic debugging before documenting a root cause; writing plans for multi-step migrations; verification-before-completion before claiming work complete.
- Use Context7 or an equivalent authoritative retriever for current, version-sensitive, or library-specific claims. Repository code, tests, runtime evidence, and explicit operator decisions remain separate authorities to reconcile, never overwrite.

## Implementation Workflow

### 1. Scope

Inspect the worktree before editing and preserve unrelated changes. Classify affected domains using the pre-push gate's canonical trio — **analytics** (metric semantics), **ingestion** (Bridge/Redis/worker/Postgres, including Prisma schema and migrations), **dashboard** (UI and responsive behavior). Record a concise change contract in-thread; write `_workspace/00_input/request-summary.md` only for durable handoff. Identify files, tests, commands, permissions, and shared mutable resources before implementing.

### 2. Plan

Smallest ordered plan naming: intended behavior, authoritative source for each changed value, files expected to change, focused tests and final checks, and rollback/migration concern when ingestion or schema behavior changes. Persist `_workspace/01_plan_change.md` only when the plan is a durable handoff.

### 3. Implement

Incremental, minimal changes with focused tests added alongside. Preserve `AGENTS.md` rules; no fields or fallbacks outside the Bridge/Redis/Postgres path. Serialize shared writes and stateful tests — parallelism is for independent read-heavy investigation, review, or isolated tests with explicit ownership only.

### 4. Review

Select only the relevant repo-local reviewers:

- `.claude/skills/trading-analytics-review/SKILL.md`
- `.claude/skills/bridge-ingestion-review/SKILL.md`
- `.claude/skills/dashboard-responsive-review/SKILL.md`

The coordinator remains synthesis owner. For durable evidence write `_workspace/02_review_{domain}.md` (`pass`/`fix`/`blocked`, findings with file/line evidence, required action). Review is invoked by the coordinator as routing requires — the pre-push gate (`scripts/check-harness-review.sh`) checks only secrets and stray `.env` files, not review evidence.

### 5. Verify

Run narrowest relevant tests first, then `npm run lint`, then `npm run build` for application changes. For Bridge/worker/history changes use the focused verification block in `CLAUDE.md`; run opt-in integration tests only with isolated services and explicit flags. For dashboard changes verify portrait and landscape at representative mobile viewports, preserving screenshots when visual behavior changed. Inspect the final diff for unrelated edits, source-boundary violations, and unreviewed migrations. Scan every added line for credential literals — `REDIS_PASSWORD`, `DATABASE_URL`, `DUCKDNS_TOKEN` — and treat any match, or a stray `.env*` file beyond `.env.example`/`.env.test.example`, as blocking.

## Outputs

- Implementation work: completed code and focused tests. Documentation work: updated canonical documents, evidence classification, contradiction checks, and exact validation results.
- A concise final report: user-visible behavior, changed paths, checks run, checks not run.
- Optional durable artifacts: `_workspace/00_input/request-summary.md`, `01_plan_change.md`, `02_review_{domain}.md`, `03_verification.md`. None for small work where the thread suffices.

## Failure Policy

- Stop before implementing when authoritative behavior cannot be determined and any assumption would materially alter the result.
- A failing focused test: decide requested defect vs regression vs pre-existing state before editing further.
- A reviewer `fix`: one targeted revision, then repeat the affected review and tests; escalate unresolved semantic conflict instead of looping.
- Integration dependency unavailable: complete safe unit/static checks and report the exact unverified boundary.
- Never repair partial or conflicting parallel writes through blind synthesis; serialize or isolate the writers first.

## Validation

- Every changed metric has one authoritative source and matches `src/lib/trading/metric-registry.ts` where displayed.
- History progress advances only when the bridge SQLite journal durably records the completed window and the worker has durably persisted it (idempotent); Redis publication alone is never completion.
- Prisma changes include reviewed migration implications.
- Dashboard changes retain chart-first behavior, 44×44pt touch targets, and both mobile orientations.
- Final claims cite commands actually run and their outcomes; documentation claims are classified Verified/Observed/Inferred/Open/Historical when the distinction matters; external claims are verified or explicitly marked unverified; documentation-only work reports that no code, data, commit, or push occurred unless requested.

## Team Contract

Read `docs/harness/analytic/team-spec.md` when coordinating a durable handoff, choosing reviewers for a cross-domain change, or delegating independent review slices.

## Reference Pointers

- `references/documentation-maintenance.md` for evidence-first documentation updates, dirty-tree isolation, external-doc verification, and completion reporting.
- `docs/harness/analytic/team-spec.md` for role topology, the routing table, and handoff contracts.
