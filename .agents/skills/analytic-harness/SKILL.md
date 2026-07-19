---
name: analytic-harness
description: >
  Orchestrator harness for analytic repo, three domains: trading-analytics
  (src/lib/trading, formulas, reports), bridge-worker-ops (bridge_v2,
  src/worker/worker-v2/worker-v3, Redis/Postgres ingestion, VPS),
  dashboard-ui (src/components/trading-monitor, mobile UI, design-system).
  Routes work through cavecrew subagents (investigator locate, builder
  edit, reviewer diff-check) plus domain expert reviewer. Use when user
  says "하네스 실행", "run the harness", "analytic harness", "fix X in
  trading/bridge/dashboard domain", or asks for coordinated locate-edit-
  review flow across these three areas. Also use for follow-ups: "다시
  실행", "부분 재실행", "harness again", "re-run harness".
---

Model: every `Agent` call this skill makes (investigator, builder, reviewer, domain reviewer) passes `model: "haiku"`, `effort: "medium"`. Overrides each agent file's own `model:` default for calls made through this skill. Exception: `planner` step always passes `model: "opus"`, `effort: "high"` — planning quality gates everything downstream.

Phase 0: check `_workspace/` under repo root for prior run. Exists +
user wants partial fix → reuse relevant phase only. Exists + new ask →
move to `_workspace_prev/`. Missing → fresh run.

## Domain routing

| Domain | Investigate scope | Domain reviewer |
|---|---|---|
| trading-analytics | `src/lib/trading/**`, `metric-registry.ts` | `analytics-formula-reviewer` (formulas) or `financial-data-reviewer` (data path) |
| bridge-worker-ops | `bridge_v2/**`, `src/worker/**`, `src/worker-v2/**`, `src/worker-v3/**` | `financial-data-reviewer` |
| dashboard-ui | `src/components/trading-monitor/**`, `src/app/globals.css` | `ui-mobile-reviewer` |
| schema/migration (any domain touching `prisma/`) | `prisma/schema.prisma`, `prisma/migrations/**` | `prisma-migration-reviewer` |

Pick domain from user request keywords; ask only if genuinely ambiguous.

## Flow (per task)

1. **Locate** — `caveman:cavecrew-investigator` — find file:line for target symbol/behavior in domain scope. Read-only, caveman-compressed output.
2. **Domain check** (skip if pure locate/read task) — matching domain reviewer above — evaluate correctness against AGENTS.md source-boundary rules before any edit.
3. **Plan** (skip for trivial single-line fix — go straight to build) — `planner` — turns investigator findings + domain verdict into ordered file:line edit plan. Flags scope overflow (3+ files) before builder ever sees it.
4. **Build** — `caveman:cavecrew-builder` — execute the plan, 1-2 files, mechanical scope only. No plan step ran → apply fix directly. Scope exceeds 2 files → stop, report scope, ask user before widening (builder hard-refuses 3+ files by design).
5. **Review** — `caveman:cavecrew-reviewer` — diff review, one line per finding, severity-tagged.
6. Findings from step 5 at 🔴 → loop back to step 4 with fix instruction (re-plan first via step 3 if the fix reshapes scope). 🟡/🔵 → report, let user decide.

Write intermediate notes to `_workspace/{domain}_{step}.md` only for multi-step runs (2+ files or 2+ domains in one ask); skip workspace files for a single quick fix.

## Cross-domain tasks

If a task spans domains (e.g. bridge persists wrong precision that surfaces in dashboard), run each domain's steps 1-4 independently, then a final `caveman:cavecrew-reviewer` pass over the combined diff for cross-boundary issues (e.g. source-boundary violations spanning worker → analytics → UI).

## Error handling

Investigator/builder/reviewer call fails or returns empty → retry once. Still fails → report gap explicitly, do not silently skip the domain.

## Boundaries

- Never invoke domain reviewer agents caveman-styled — their detailed prose output is load-bearing (formula tables, precision rules); only the locate/build/review scaffolding runs cavecrew.
- No new agent/skill files created per-run — this orchestrator is the reusable entry point.
- Destructive git ops (reset --hard, force-push) always outside this skill's scope — surface to user directly.

## Test scenarios

- Normal: "fix pips calc in analytics-formula-reviewer scope" → investigate `src/lib/trading/analytics.ts` → domain check via `analytics-formula-reviewer` → build → review → report.
- Error: investigator returns nothing for symbol → retry once → still empty → report "not found in domain scope, may be misrouted" instead of guessing.
