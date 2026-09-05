# Plan: `verify-deploy` — orchestrator subagent for analytic project workflows

> Approved 2026-09-06. Working draft also at `~/.claude/plans/create-a-subagent-for-snazzy-brook.md`; this copy is the record of truth.

## Context

The `analytic` repo (C:\analytic, Next.js trading-account monitor on the forexvps single Windows host, dev = prod) has rich documented operational workflows — verify (smoke/build/service dance), docs-sync (doc impact mapping), vps-ops (deploy/host ops) — but every multi-step ceremony today runs inline in the main session, burning orchestrator context on mechanical steps. The repo has **zero subagent definitions** (`.claude/agents/` does not exist yet).

This change creates the first one: a project-level **`verify-deploy` subagent** that runs the two operational workflows end-to-end when dispatched — (A) the post-change verify pipeline and (B) the production deploy — with production-service operations gated on an explicit operator-approval token in the dispatch prompt.

## User-approved decisions (fixed — answered via clarifying questions)

1. **Scope** — verify pipeline + deploy lifecycle, one agent.
2. **Autonomy** — approval-via-dispatch: service ops / deploy run only when the dispatch prompt carries a literal `APPROVAL: service-ops` / `APPROVAL: deploy` line; otherwise the agent stops at the boundary and reports `AWAITING_APPROVAL` (resumable with the token).
3. **Git** — scoped commits with explicit pathspecs only; never pushes, never bumps `package.json` version.

## Verified ground truth (spot-checked against disk, not agent claims)

- `CHANGELOG.md`: no Unreleased heading at top; newest is `## [8.75] - 2026-09-03` (line 8); the only `## [Unreleased]` is a stale June-2026 section at **line 250** — leave it alone.
- `docs-impact.mjs`: `isDoc()` (line 132) treats any `.md` path as a doc → `.claude/agents/verify-deploy.md` produces **zero** doc-impact flags; RULES table (lines 29–87) has no `.claude/` mapping. CLAUDE.md/CHANGELOG companion edits are docs themselves. Nothing pending for docs-sync `--check`.
- `.claude/skills/vps-ops/references/deploy.md`: 7-step procedure (Step 0 clean-tree pre-state → 1 pull → 2 classify diff + 2a bridge pip-install → 3 rebuild w/ EBUSY+EPERM+restart gotchas and the incremental-`npm install` escape hatch → 4 migrations gate → 5 diff-scoped restart table, worker BEFORE web → 6 verify with hairpin caveat) + rollback (operator-level). Workflow B follows this file verbatim.
- Format reference: `coordinator-claude/2.2.0/agents/executor.md` frontmatter keys — `name`, `description`, `model`, `color`, `tools` (JSON array), `access-mode`.
- Coordinator doctrine: subagents do NOT see CLAUDE.md → agent body must be self-contained; workers-over-personas → `model: sonnet`; write-capable dispatches need `mode: "acceptEdits"` on the Agent call.

## Deliverables

1. **`C:\analytic\.claude\agents\verify-deploy.md`** (new directory + file) — content in next section.
2. **`CLAUDE.md`** — one bullet under `## Agent Workflow Notes`, inserted after the "Production deploys" bullet.
3. **`CHANGELOG.md`** — new `## [Unreleased]` section directly above `## [8.75]` (top of file; ignore stale line-250 Unreleased), `### Added`, entry describing the subagent.
4. **`package.json`** — bump 8.75 → 8.76. Per the repo's push convention the bump rides the same commit being pushed: fold the bump + CHANGELOG retitle (`## [Unreleased]` → `## [8.76] - <push date>`) into the commit at push time (amend — branch is unpushed), after user confirms. `release.yml` tags when it reaches main.

## The agent file — content

### Frontmatter

```yaml
---
name: verify-deploy
description: "Runs the analytic repo's two operational workflows end-to-end on the forexvps host. Dispatch for: (A) post-change verify pipeline — scope diff, run relevant tests, lint, tsc --noEmit, npm run build with the NSSM stop/start dance, spare-port smoke test with screenshot review, docs-sync + CHANGELOG entry, scoped docs-only commit; and (B) production deploy per .claude/skills/vps-ops/references/deploy.md — pull, classify diff, rebuild, migrate, restart only diff-touched services, verify + ANALYTIC_URL=:3000 smoke. Service operations and deploys execute ONLY when the dispatch prompt contains an APPROVAL: token line; otherwise the agent stops at the boundary and reports AWAITING_APPROVAL. Not for: implementing source changes (use coordinator:executor or inline), ad-hoc single-service restarts outside these workflows, MT5/bridge/terminal ops, db cleanup, read-only code exploration. Never pushes, never bumps package.json version."
model: sonnet
color: orange
tools: ["Read", "Edit", "Bash", "Grep", "Glob", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]
access-mode: read-write
---
```

Tool notes: **no `Write`** (nothing creates files — Edit-only shrinks blast radius); **no `Skill`** (unreliable in subagents — skills are Read as files); **no `Agent`** (leaf operator, no sub-dispatch); **no web/MCP** (everything on-box).

### Body (~230 lines — full near-final draft lives in `~/.claude/plans/create-a-subagent-for-snazzy-brook.md` "The agent file — content" section; copy verbatim, de-escaping any `&lt;` → `<` artifacts)

Structure: Identity · Two-tier platform guard (Tier 1 repo identity for all steps; Tier 2 VPS-HOST + checkout IS `C:\analytic` for build/service/smoke/deploy) · Hard rules (nssm-only, PG16 ban, taskkill-by-PID, no chained pull+build+restart, on-box builds, secret masking, no MT5/bridge touches, no db:clean, never push, never edit source, PowerShell quoting, Bangkok timestamps) · Approval-via-dispatch protocol (literal `APPROVAL: service-ops` / `APPROVAL: deploy` line, prose doesn't count, out-of-workflow declined even with token, AWAITING_APPROVAL report with boundary-untouched proof, resume re-verifies state, restore-your-own-stops covered) · Workflow A (A0 preflight → A1 scope → A2 tests → A3 lint → A4 tsc → A5 build+service dance with EBUSY/EPERM/bring-back-ordered handling → A6 smoke with screenshot-read rule and exit-code triage → A7 docs-sync incl. CHANGELOG top-Unreleased rule → A8 scoped docs commit → A9 report) · Workflow B (B0 preconditions → B1 pre-state clean-tree gate → B2–B4 deploy.md Steps 1–3 → B5 migrations gate → B6 diff-scoped restarts w/ stop-pending trap → B7 verify → B8 :3000 post-deploy smoke → B9 pre/post report) · Failure & escalation (5 exit-status tags incl. AWAITING_APPROVAL; BLOCKED requires Obstacle/Tried/Unblocks/State; never fix source; retry whitelist = EBUSY orphan kill + smoke exit-3 rebuild only) · Report format template.

## Implementation steps

1. Worktree branch `worktree-verify-deploy-agent` (done — this plan copy is committed from it).
2. Create `.claude/agents/verify-deploy.md`.
3. Edit `CLAUDE.md` (bullet after "Production deploys" under Agent Workflow Notes) and `CHANGELOG.md` (top `## [Unreleased]` + entry; line-250 stale section untouched).
4. Static sanity: filename ↔ `name:` match, tools JSON valid, `git diff --stat` = 3 files; docs-impact `--check` exit 0.
5. Worktree smoke dispatch (read-only: preflight + A1 + docs-impact report only; expect Tier-1 pass, Tier-2 correctly deferred, zero nssm calls, worktree unchanged).
6. Scoped commit (no bump yet).
7. Push flow (user-gated): confirm 8.75 → 8.76 → amend commit with package.json bump + CHANGELOG retitle → push branch → draft PR to main. Never push main directly.

## Verification

- **Static:** filename/frontmatter match, YAML intact, `git status` clean post-commit, docs-impact `--check` exit 0 (isDoc filters `.claude/**.md`).
- **Worktree smoke:** dispatch read-only preflight/scope/docs-impact from the worktree (zero-dependency steps only — worktree has no node_modules).
- **Post-merge (next session at C:\analytic):** (a) no-token Workflow A → AWAITING_APPROVAL with service-state proof; (b) `APPROVAL: service-ops` + out-of-workflow request → declined, caddy untouched; (c) full lint/tsc.
- **First real use:** next code change → Workflow A with `APPROVAL: service-ops`; next release → Workflow B with `APPROVAL: deploy`. No rehearsal on production.

## Out of scope

- MT5 terminal/bridge operations, `db:clean`, `remediate-corrupt-positions --apply`, rollback actions — main-session/operator-only even with a token.
- Source-code editing when verification fails — agent reports with evidence; fixes belong to main session / coordinator:executor.
- User-level agents (`~/.claude/agents/`) — workflows are repo-specific; project-level only.
- Permission-allowlist additions for the agent's commands (possible follow-up after first real runs).
