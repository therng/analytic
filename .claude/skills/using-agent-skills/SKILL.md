---
name: using-agent-skills
description: This skill should be used when starting any non-trivial task and it's unclear which skill applies — e.g. "build this feature", "fix this bug", "write a spec", "review this change" — or when the user asks "which skill should I use", "what category does this fall under", "how do I pick a skill". Maps task shapes (spec-authoring, implementation, review, verification, deployment, etc.) to capability categories and defers to the active project's own skill registry for the actual skill names.
---

# Using Agent Skills

## Registry Note

This document defines **routing patterns** — how to recognize what a task needs and in what order. It does **not** define the skill registry. Every placeholder below (`<requirements-discovery>`, `<planning>`, etc.) is a capability category, not a real skill name. Canonical skill identifiers for the current project must come from its actual registry — check, in order: (1) a repo-local skills directory named in AGENTS.md/AGENTS.md (e.g. `.agents/skills/`), (2) `.Codex/skills/`, (3) an explicit skill list in AGENTS.md/AGENTS.md. Resolve each placeholder to whatever skill actually exists there before invoking it.

Category resolution:
- Exactly one matching skill → use it.
- Multiple matching skills → prefer the first matching source according to the registry lookup order above; if ambiguity remains within the same source, ask the user rather than guessing.
- Zero matching skills → skip the category or handle the task ad hoc.
- Never invent, assume, or fabricate a skill name that does not exist in the resolved registry.

## Overview

Treat Agent Skills as a collection of reusable knowledge modules — each one encodes a specific process, domain constraint, or capability that senior engineers follow. Load skills on demand for whatever the task currently needs; don't treat them as lifecycle phases to march through in order.

The general lifecycle any task moves through is:

```
Task → Agent selection → Skill loading → Execution → Verification → Handoff/Release
```

Skills plug into the **Skill loading** step (and get consulted again during Execution/Verification/Handoff as needed) — they are not stages a task marches through in order. This meta-skill picks which *category* of skill to load for the task at hand; the project's registry supplies the actual name.

- **Agent selection** — before loading a skill, check whether the project defines specialized agents/subagents for the domain the task touches; route to the matching one instead of doing domain work generically.
- **Handoff/Release** — follow the project's own commit/PR/deploy conventions (branch strategy, review gate, release process); this skill doesn't define one.

For a complex multi-step task, prefer routing through the project's coordinator role, if one exists in its agent registry, instead of picking skills ad hoc:

```
Complex multi-step task
        │
        v
<orchestrator-agent>
        │
        ├── selects skills
        ├── selects specialist agents
        └── verifies completion
```

No such role in the active registry → fall back to Skill Discovery below directly.

## Skill Discovery

Match what the task needs right now to the corresponding capability category:

```
Task arrives
    │
    ├── Don't know what you want yet? ──────→ <requirements-discovery>
    ├── Have a rough concept, need variants? → <idea-exploration>
    ├── New project/feature/change? ──→ <spec-authoring>
    ├── Have a spec, need tasks? ──────→ <planning>
    ├── Implementing code? ────────────→ <implementation>
    │   ├── UI work? ─────────────────→ <ui-implementation>
    │   ├── API work? ────────────────→ <api-design>
    │   ├── Need better context? ─────→ <context-preparation>
    │   ├── Need doc-verified code? ───→ <source-verification>
    │   └── Stakes high / unfamiliar code? ──→ escalate scrutiny (see Domain-Sensitive Change Recognition)
    ├── Writing/running tests? ────────→ <verification>
    │   └── Browser-based? ───────────→ <browser-verification>
    ├── Something broke? ──────────────→ <debugging>
    ├── Reviewing code? ───────────────→ <review>
    │   ├── Too complex? ─────────────→ <simplification>
    │   ├── Security concerns? ───────→ <security-review>
    │   └── Performance concerns? ────→ <performance-review>
    ├── Committing/branching? ─────────→ <version-control>
    ├── CI/CD pipeline work? ──────────→ <ci-cd>
    ├── Deprecating/migrating? ────────→ <migration>
    ├── Writing docs/ADRs? ───────────→ <documentation>
    ├── Adding logs/metrics/alerts? ───→ <observability>
    └── Deploying/launching? ─────────→ <deployment>
```

For full ordering across a large/unfamiliar/high-stakes change (Define → Plan → Build → Verify → Review → Ship) plus a one-line purpose per category, see `references/skill-order-reference.md`.

## Domain-Sensitive Change Recognition

Some changes carry correctness risk beyond normal code review. Before implementing, check if the task touches:

- **External integration boundary** (third-party API/broker/hardware integration) — timestamp/timezone handling, connection resilience, silent data loss.
- **Streaming/queue ingestion** (e.g. message streams, event queues) — idempotency, ordering, replay/backfill correctness, at-least-once vs exactly-once semantics.
- **Worker/ingestion pipelines** — durability ("published" ≠ "persisted"), checkpoint/cursor advancement, crash-recovery gaps.
- **Schema/ORM layer** — migration safety on live tables, index cost, constraint changes affecting existing data.
- **Regulated or high-stakes calculations** (financial, medical, legal, etc.) — source-of-truth boundaries (which table/system is authoritative for a value), precision/rounding.

Any of these: don't freelance from general knowledge. Check for project-local domain rules first (AGENTS.md/AGENTS.md, ADRs, a repo harness/review skill) — they override this skill's default flow. None exist → treat as high-stakes: escalate scrutiny before implementing (adversarial re-read of the plan, assumptions surfaced explicitly, verification includes correctness evidence not just a passing build). This is a required behavior, not a skill lookup — apply it even if no matching skill exists in the project's registry.

## Ownership Boundaries

This skill routes work — it grants no authority to change system architecture, service ownership, or data-authority boundaries.

- Never reassign which component/table/service is authoritative for data as a side effect of an unrelated task.
- Never retire, replace, or bypass an existing durability/ownership mechanism (a checkpoint system, a sole-writer worker, a schema-of-record) without an explicit request plus a documented decision (ADR or equivalent).
- A task whose natural implementation crosses an ownership boundary is a stop-and-surface case (see Manage Confusion Actively in `references/operating-behaviors.md`), not a unilateral call.
- Project-local rules (AGENTS.md, AGENTS.md, repo harness/team-spec) always take precedence over this generic skill's defaults.

## Core Operating Behaviors

These apply at all times, across all skills — non-negotiable. Full text (assumption format, confusion-handling steps, failure-mode list) in `references/operating-behaviors.md`.

1. **Surface Assumptions** — state them explicitly before non-trivial implementation; don't silently fill ambiguous requirements.
2. **Manage Confusion Actively** — stop on inconsistencies, name the confusion, ask rather than guess.
3. **Push Back When Warranted** — flag problems with a concrete downside and an alternative; sycophancy is a failure mode.
4. **Enforce Simplicity** — resist overcomplication; prefer the boring, obvious solution.
5. **Maintain Scope Discipline** — touch only what was asked; no unsolicited cleanup or refactors.
6. **Verify, Don't Assume** — every skill's verification step needs evidence (tests, build output, runtime data), not "seems right."

## Skill Rules and Ordering

When in doubt on a non-trivial task with no spec, start with `<spec-authoring>`. Full rule set plus the ordered table (Define → Plan → Build → Verify → Review → Ship, with one-line purpose per category): `references/skill-order-reference.md`.

## Additional Resources

- **`references/operating-behaviors.md`** — full text of the six Core Operating Behaviors plus the Failure Modes list.
- **`references/skill-order-reference.md`** — full Skill Rules and the ordered Quick Reference table across all capability categories.
