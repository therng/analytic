# Skill Rules and Quick Reference

## Skill Rules

1. **Check for an applicable skill before starting work.** Skills encode processes that prevent common mistakes.

2. **Skills are workflows, not suggestions.** Follow the steps in order. Don't skip verification steps.

3. **Multiple skills can apply.** A feature implementation might chain `<idea-exploration>` → `<spec-authoring>` → `<planning>` → `<implementation>` → `<verification>` → `<review>` → `<simplification>` → `<deployment>` in sequence.

4. **When in doubt, start with a spec.** If the task is non-trivial and there's no spec, begin with `<spec-authoring>`.

## Quick Reference

Order is the sequence a large/unfamiliar/high-stakes change typically pulls categories in (not phases every task marches through — most tasks load a short ad hoc subset, e.g. a bug fix might only need `<debugging>` → `<verification>` → `<review>`). `<observability>` runs parallel with implementation, not after.

| Order | Stage | Category | One-Line Purpose |
|-------|-------|----------|-------------------|
| 1 | Define | `<requirements-discovery>` | Surface what the user actually wants before any plan, spec, or code exists |
| 2 | Define | `<idea-exploration>` | Refine ideas through structured divergent and convergent thinking |
| 3 | Define | `<spec-authoring>` | Requirements and acceptance criteria before code |
| 4 | Plan | `<planning>` | Decompose into small, verifiable tasks |
| 5 | Build | `<context-preparation>` | Right context at the right time |
| 6 | Build | `<source-verification>` | Verify against official docs before implementing |
| 7 | Build | `<implementation>` | Turn the plan into working code, escalating scrutiny on non-trivial decisions (see Domain-Sensitive Change Recognition in SKILL.md) |
| 7 | Build | `<ui-implementation>` | Production-quality UI with accessibility |
| 7 | Build | `<api-design>` | Stable interfaces with clear contracts |
| 7 | Build | `<observability>` | Structured logs, RED metrics, traces, symptom-based alerts — instrument alongside implementation |
| 8 | Verify | `<verification>` | Prove the change works before calling it done |
| 8 | Verify | `<browser-verification>` | Runtime verification in a real browser |
| — | Verify | `<debugging>` | Reproduce → localize → fix → guard |
| 9 | Review | `<review>` | Multi-axis review with quality gates |
| 9 | Review | `<simplification>` | Preserve behavior while reducing unnecessary complexity |
| 9 | Review | `<security-review>` | Prevention, input validation, least privilege |
| 9 | Review | `<performance-review>` | Measure first, optimize only what matters |
| 10 | Ship | `<version-control>` | Atomic commits, clean history |
| 10 | Ship | `<ci-cd>` | Automated quality gates on every change |
| 11 | Ship | `<migration>` | Remove old systems and migrate users safely, when needed |
| 11 | Ship | `<documentation>` | Document the why, not just the what |
| 12 | Ship | `<deployment>` | Pre-launch checklist, monitoring, rollback plan |

Resolve each `<category>` to the matching skill name in the active project's registry — check a repo-local directory named in CLAUDE.md/AGENTS.md (e.g. `.agents/skills/`) first, then `.claude/skills/`, then a skill list in CLAUDE.md/AGENTS.md — before invoking.

Category resolution:
- Exactly one matching skill → use it.
- Multiple matching skills → prefer the first matching source according to the registry lookup order above; if ambiguity remains within the same source, ask the user rather than guessing.
- Zero matching skills → skip the category or handle the task ad hoc.
- Never invent, assume, or fabricate a skill name that does not exist in the resolved registry.
