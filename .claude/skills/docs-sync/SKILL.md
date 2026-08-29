---
name: docs-sync
description: Keep analytic repo docs in sync after every code change.
version: 0.1.0
author: Supachai Therng (therng), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Docs, Git, Documentation, Workflow]
    related_skills: []
---

# docs-sync — repo documentation impact review

Maps a diff (worktree or commit range) to the repo docs it can invalidate, so
every commit that changes behavior, architecture, ingestion, schema, or ops
also updates the prose describing it. The map is a heuristic; the checked-out
code is always the authority. Zero dependencies: `git` + Node >= 18 only.

## When to Use

- **Triggers:** about to commit (or just committed) changes to `bridge/`,
  `src/worker-v2/`, `src/lib/trading/`, `src/components/trading-monitor/`,
  `src/app/`, `prisma/`, `scripts/`, `package.json` · "update docs" /
  "sync docs" / "docs drift" · PR body needs a docs-impact note.
- **Don't use for:** authoring new ADRs or incident reports from scratch
  (design work), deploying the host (vps-ops skill), GitHub PR mechanics.

## Scope guard — run FIRST, every time

This skill maps THIS repo's layout. Confirm the working directory is the
analytic repo root before trusting any output:

```
terminal(command="git rev-parse --show-toplevel && node -e \"console.log(require('./package.json').name)\"")
```

- Prints a repo path ending in `analytic` and `analytic` → proceed.
- Anything else → STOP. The path-to-doc map below would be wrong; do not
  apply it to another repository.

## Procedure

1. **Scope the diff.** Worktree: `git diff --stat HEAD`. Commit range:
   `git diff --stat A..B`. Completion criterion: a concrete list of changed
   source paths exists.
2. **Map the impact.**
   `node .claude/skills/docs-sync/scripts/docs-impact.mjs [--diff A..B] [--check]`
   (run from repo root; default diff = uncommitted worktree).
   Completion criterion: the script prints either doc targets or
   `no doc impact`.
3. **Review each flagged target.** `read_file` the flagged section,
   `search_files` the changed symbol/behavior, then `patch` only the claims
   the diff actually invalidates. Completion criterion: every target is
   either updated (with code evidence, not memory) or dismissed with a
   one-line reason recorded in the commit message / PR body.
4. **CHANGELOG.md.** Add one line per user-visible change under the
   Unreleased heading (Keep a Changelog format — `read_file` the top of the
   file to confirm the exact heading before patching). Completion criterion:
   entry present under the correct heading.
5. **Verify.** Re-run the script with `--check` for the same range: exit 0 =
   nothing pending; exit 1 = resolve each listed pair (edit or dismiss).
   If the script itself was edited, `node --check` it. Completion criterion:
   `--check` exits 0 or every flagged pair has an explicit dismissal.

## Quick Reference

```
# map uncommitted changes to docs (report only)
node .claude/skills/docs-sync/scripts/docs-impact.mjs
# map one committed change
node .claude/skills/docs-sync/scripts/docs-impact.mjs --diff HEAD~1..HEAD
# gate before commit: exit 0 clean / exit 1 pending doc targets
node .claude/skills/docs-sync/scripts/docs-impact.mjs --check
```

Exit codes: `0` no doc impact or all targets already touched in the same
diff · `1` pending targets need review (list printed) · `2` usage or git
error.

## Impact map (script is the source of truth)

| Changed path                          | Docs to review                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/lib/trading/metric-registry.ts`  | `AGENTS.md` (metric mapping rules)                                                                  |
| `prisma/`                             | `CLAUDE.md`, `docs/architecture-data-models.md`, `docs/ARCHITECTURE.md`                              |
| `bridge/`                             | `docs/ARCHITECTURE.md`, `docs/architecture-data-models.md`, `docs/mql5book-{deal,order,position}-properties.md` |
| `src/worker-v2/`                      | `docs/ARCHITECTURE.md`, `docs/decisions/0002-worker-v2-adoption.md` (read-only reference)            |
| `src/lib/trading/`                    | `docs/ARCHITECTURE.md`, `AGENTS.md`                                                                 |
| `src/components/trading-monitor/`, `src/app/` | `AGENTS.md` (dashboard behavior / visual rules)                                             |
| `scripts/`                            | `CLAUDE.md` (commands / workflow)                                                                   |
| `package.json`                        | `CLAUDE.md`, `README.md`                                                                            |
| `next.config*`, `.env.example`        | `docs/ARCHITECTURE.md` / `CLAUDE.md`                                                                |
| any source change                     | `CHANGELOG.md` entry (always)                                                                       |

Already-`.md` and `docs/`, `specs/` changes never map further — they ARE the
sync work.

## Pitfalls

- **Code beats docs.** Known-stale prose has shipped here before (stale
  migration-plan checkboxes, only fixed in `6ec12de`). Never edit a doc
  toward a guess; if the doc and code disagree and the code looks wrong,
  that is a bug report, not a doc edit. Cite `file:line` evidence per edit.
- **AGENTS.md vs CLAUDE.md routing** is defined at the top of both files:
  dashboard/analytics/visual rules → `AGENTS.md`; commands, stack, dir
  structure, env vars → `CLAUDE.md`. Wrong file = review flag.
- **ADRs are immutable history.** Never rewrite an existing ADR's decision;
  record reversals as a new `docs/decisions/NNNN-*.md`.
- **Working state is out of scope:** `docs/superpowers/plans`, `specs/`,
  `logs/` — skip unless the user asks.
- **Heuristic map.** A user-visible change with an empty map still deserves
  a manual glance at `README.md` + `CHANGELOG.md`.
- **Untracked files are invisible** to worktree mode (`git diff HEAD`); stage
  them or `git add -N` first. Merge commits: pass an explicit `A..B` range.
- **Version bump convention:** release commits ride with the `package.json`
  version bump in the same commit (e.g. 8.50→8.51) — docs edits for a
  release join that same commit.
- **Mirror copies exist** (`~/.agents/skills/docs-sync`, Hermes
  `skills/software-development/docs-sync`): edit this repo copy only, then
  robocopy /MIR outward — direct edits inside an installed copy get wiped at
  the next sync.

## Verification

- `docs-impact.mjs --check` exits 0, or every exit-1 line has an explicit
  edit or dismissal.
- `node --check .claude/skills/docs-sync/scripts/docs-impact.mjs` passes
  whenever the script changed.
- `git diff --stat` shows only the intended doc files touched.
