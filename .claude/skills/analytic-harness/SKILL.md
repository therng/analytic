---
name: analytic-harness
description: Use when making non-trivial code or documentation changes to the analytic trading platform, especially across trading analytics, Bridge/Redis/Postgres ingestion, Prisma contracts, responsive dashboard behavior, or repository documentation that must match verified implementation and runtime state.
---

# Analytic Harness

## When to Use

- Use for code changes where a wrong source boundary, history checkpoint, schema contract, or responsive layout can silently corrupt behavior.
- Use for multi-file fixes and features in `src/lib/trading/`, `src/worker*`, `bridge/`, `prisma/`, account APIs, or `src/components/trading-monitor/`.
- Use for documentation updates that must reconcile code, tests, runtime evidence, operator decisions, and current external library/API documentation.
- Do not use for a read-only question, typo-only edit, dependency-only task, or an isolated change with an obvious local test.

## Required Inputs

- The user's requested outcome and acceptance criteria.
- Current `git status`, because unrelated work may already be present.
- `AGENTS.md` and the relevant portions of `CLAUDE.md`.
- The implementation files, nearest tests, and relevant plan or architecture docs.
- For documentation work, the claims being updated, their evidence sources, and the canonical document for each claim.


## Workflow Selection

Choose one path before editing:

- **Implementation path:** use the five-step workflow below for code, schema, ingestion, analytics, or dashboard behavior changes.
- **Documentation-maintenance path:** when the requested deliverable is documentation, read `references/documentation-maintenance.md` and follow it instead of the implementation steps. Documentation-only work must not modify runtime code unless the user explicitly expands scope.

Use installed process skills when their trigger conditions apply:

- brainstorming before changing reusable workflows, architecture, or behavior contracts;
- systematic debugging before documenting a root cause;
- writing plans for multi-step migrations or broad documentation updates;
- verification-before-completion before claiming the work is complete.

Use Context7 or an equivalent authoritative documentation retriever for current, version-sensitive, or library-specific claims. Repository code, tests, runtime evidence, and explicit operator decisions remain separate authorities and must be reconciled rather than overwritten by external docs.

## Implementation Workflow

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

- For implementation work: completed code and focused tests.
- For documentation work: updated canonical documents, evidence classification, contradiction checks, external-documentation conclusions, and exact validation results.
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
- Documentation claims are classified as Verified, Observed, Inferred, Open, or Historical when the distinction matters.
- Current external API/library claims are verified with Context7 or explicitly marked unverified.
- Documentation-only work reports that no code, data, stage, commit, or push occurred unless explicitly requested.

## Team Contract

Read `docs/harness/analytic/team-spec.md` when coordinating a durable handoff, choosing reviewers for a cross-domain change, or delegating independent review slices.


## Reference Pointers

- `references/documentation-maintenance.md` for evidence-first documentation updates, dirty-tree isolation, Context7 verification, contradiction checks, and completion reporting.
- `references/agents-md-guide.md` before creating or revising repo-wide `AGENTS.md`.
- `references/agent-design-patterns.md` when selecting Pipeline, Fan-out/Fan-in, Expert Pool, Producer-Reviewer, Supervisor, or Hierarchical Delegation.
- `references/autonomous-experimentation.md` for controlled experiment loops with immutable evaluation surfaces.
- `references/orchestrator-template.md` for reusable coordination contracts.
- `references/team-examples.md` for example artifact trees and handoffs.
- `references/skill-writing-guide.md` and `references/skill-testing-guide.md` when authoring or validating repo-local skills.
- `references/qa-agent-guide.md` for cross-boundary QA reviews.
- `references/codex-agent-adapter.md` only for optional Codex-specific runtime mapping.
- `templates/codex-agent.toml` as an inactive template to copy and adapt intentionally.
- `docs/harness/analytic/team-spec.md` for durable handoffs and cross-domain reviewer selection.
