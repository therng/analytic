# Analytic Harness Team Spec

## Goal

Provide a portable, repo-local workflow for safely changing the trading analytics platform while preserving financial semantics, durable ingestion, and the chart-first mobile dashboard.

## Architecture

Use a **Pipeline with an Expert Pool review stage**:

1. scope
2. plan
3. implement
4. select relevant domain reviewers
5. verify and synthesize

Direct work remains the default for small, tightly coupled tasks. Reviewers are selected by affected boundary; they are not all run automatically.

## Roles

| Role | Responsibility | Skill | Durable output |
| --- | --- | --- | --- |
| Coordinator | Own scope, plan, implementation integration, and final acceptance | `.agents/skills/analytic-harness/SKILL.md` | `_workspace/01_plan_change.md` when needed |
| Analytics reviewer | Guard formulas, sources, timeframes, and display mappings | `.agents/skills/trading-analytics-review/SKILL.md` | `_workspace/02_review_analytics.md` when needed |
| Ingestion reviewer | Guard UTC, replay, durability, checkpoints, and rollout | `.agents/skills/bridge-ingestion-review/SKILL.md` | `_workspace/02_review_ingestion.md` when needed |
| Dashboard reviewer | Guard responsive layout, interactions, accessibility, and tokens | `.agents/skills/dashboard-responsive-review/SKILL.md` | `_workspace/02_review_dashboard.md` when needed |

The coordinator is always the synthesis owner.

## Routing

| Change surface | Required review |
| --- | --- |
| Trading formulas, account analytics API, metric registry | Analytics |
| `bridge_v2`, Redis protocol, `src/worker*`, ingestion Prisma models | Ingestion |
| Trading-monitor components, global dashboard CSS, charts, panels | Dashboard |
| API field changes consumed by dashboard | Analytics + Dashboard |
| Ingestion schema affecting analytics | Ingestion + Analytics |
| Cross-stack feature | Every affected reviewer, never unrelated reviewers |

## Handoffs

Use thread summaries for ephemeral, low-risk coordination. Use `_workspace/` only when work must survive interruption, support audit, or cross an agent boundary:

```text
_workspace/
├── 00_input/
│   └── request-summary.md
├── 01_plan_change.md
├── 02_review_analytics.md
├── 02_review_ingestion.md
├── 02_review_dashboard.md
└── 03_verification.md
```

Review artifacts contain:

- status: `pass`, `fix`, or `blocked`
- reviewed scope and commit/diff identity
- findings with file/line evidence
- required action
- checks performed and missing evidence

## Delegation Decision Gate

Delegate only when independent slices provide clear specialization, context isolation, or latency value.

- Read-heavy discovery and domain reviews may run independently from the same diff snapshot.
- Parallel writers must own non-overlapping files and semantic boundaries, or use isolated worktrees.
- Stateful tests sharing Postgres, Redis, ports, or Docker services run serially unless each worker has an isolated environment.
- Maximum delegation depth is one layer below the coordinator.
- A failed reviewer does not become an implicit pass. The coordinator reports the missing review and limits the completion claim.
- Conflicting reviewers cite evidence; the coordinator resolves against `AGENTS.md`, source code, tests, and authoritative project docs or escalates the unresolved semantic decision.

## Failure and Revision Policy

- A `fix` result permits one targeted revision followed by repeated affected review and focused tests.
- A `blocked` result names the missing decision, source, service, or permission.
- Never broaden the request merely to satisfy review.
- If integration services are unavailable, preserve unit/static evidence and document the unverified runtime boundary.
- Schema or ingestion changes with unclear rollback or shared-environment impact stop before destructive action.

## Validation Scenarios

### Normal flow: cross-stack metric

Request: add a timeframe-filtered performance metric to an account panel.

Expected:

- coordinator traces source, API, registry, and component
- analytics and dashboard reviews run
- focused calculation/component tests, lint, build, portrait, and landscape checks are reported
- ingestion review is skipped unless the source contract changes

### Failure flow: premature history acknowledgement

Request: advance history after Redis publish succeeds.

Expected:

- ingestion review returns `fix` because publish is not durable completion
- coordinator requires all barriers/counts/digests and PostgreSQL transaction commit
- mismatch/restart test is added before acceptance

### Near miss: simple question

Request: explain where win rate comes from.

Expected:

- answer directly from `AGENTS.md` and code
- no harness handoff files or reviewer workflow
