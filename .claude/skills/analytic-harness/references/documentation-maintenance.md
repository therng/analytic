# Documentation Maintenance Workflow

Use this workflow when the requested outcome is to update repository documentation so it matches verified code, runtime state, decisions, and current external documentation.

## Purpose

Keep documentation accurate without turning a docs task into an uncontrolled code or repository cleanup. The workflow is evidence-first, scope-bounded, and safe for dirty working trees.

## Required Process Skills

When the runtime provides process skills such as Superpowers, invoke the relevant process skill before editing:

- use brainstorming before changing a reusable workflow, architecture, or behavior contract;
- use systematic debugging before documenting a root cause for unexpected behavior;
- use writing plans for multi-step documentation migrations;
- use verification-before-completion before claiming that documentation is complete or consistent.

Do not copy provider-specific invocation syntax into the canonical artifact contract. Record the required capability and let the active runtime map it to its installed skill system.

## External Documentation Verification

Use an authoritative documentation retrieval tool such as Context7 when a document makes a current, version-sensitive, or library-specific claim.

1. Resolve the canonical library or product identifier first.
2. Query one concept at a time.
3. Prefer official or primary documentation.
4. Record only the conclusion needed by the repository document; do not paste large retrieved passages.
5. Distinguish external documentation facts from repository observations and operator decisions.
6. If the external source is inconclusive, mark the claim as unresolved instead of presenting an inference as fact.

Context7 is a verification dependency, not an authority over repository reality. Running code, deployed configuration, test evidence, and explicit product decisions remain separate sources that must be reconciled.

## Workflow

### 1. Establish repository reality

Inspect before editing:

- `git status --short`
- relevant unstaged and staged diffs
- recent commits affecting the subject
- code and configuration that currently implement the documented behavior
- tests that freeze the contract
- deployment or runtime evidence when the document describes production state

Never infer that a dirty-tree change belongs to the current task. Classify each path as current-task, pre-existing, generated, or unknown.

### 2. Identify authoritative documents

Build a small change map:

| Claim or decision | Evidence source | Canonical document | Secondary documents |
| --- | --- | --- | --- |
| behavior contract | implementation + tests | architecture/spec | README, operator guide |
| current task state | task evidence | implementation plan/status doc | changelog |
| external API behavior | official docs via Context7 | relevant technical reference | architecture notes |
| operator decision | explicit user approval | ADR/spec/changelog | migration notes |

Update only documents whose meaning changed. Do not rewrite unrelated prose for style.

### 3. Separate evidence classes

Use explicit language for:

- **Verified:** directly supported by code, tests, commands, runtime evidence, or authoritative docs.
- **Observed:** seen during one or more checks but without a confirmed mechanism.
- **Inferred:** a reasoned explanation that still requires proof.
- **Open:** acceptance criteria are not yet met.
- **Historical:** retained only to explain prior state and clearly marked as retired or superseded.

Do not turn an observation into a root cause, or an implemented change into a deployed change, without evidence.

### 4. Edit with scope isolation

- Modify documentation only unless the user explicitly expands scope.
- Preserve unrelated working-tree changes.
- Never use `git reset`, `git restore`, or `git checkout` to make the tree look clean.
- Do not stage, commit, push, delete data, or change runtime state unless explicitly requested.
- Preserve deterministic identifiers, compatibility salts, schema versions, and historical references unless an explicit migration decision authorizes changing them.
- Prefer surgical edits over wholesale rewrites of long documents.

### 5. Reconcile contradictions

Search for stale terms, status banners, paths, commands, and claims across the repository. Resolve contradictions by identifying one canonical source and updating secondary references to match it.

Typical checks:

```sh
rg -n "<old-term>|<new-term>|<status-token>" README.md AGENTS.md docs .agents
```

A historical reference may remain only when its historical role is explicit.

### 6. Verify the documentation change

At minimum:

```sh
git diff --check
git diff --stat
git diff -- <changed-document-paths>
```

Also run repository-provided docs validators, link checks, generated-file checks, or focused tests when the documents describe tested contracts.

Before completion, verify:

- every changed claim has evidence;
- status words such as complete, deployed, healthy, retired, and fixed match reality;
- no open acceptance criterion was accidentally marked complete;
- external claims were checked against current primary documentation when needed;
- unrelated files were not modified;
- the final report lists exact changed files and validation commands.

## Output Contract

Return:

1. documents changed;
2. what factual or contractual inconsistency each change resolved;
3. external documentation consulted and the narrow conclusion used;
4. validation commands and raw pass/fail status;
5. open items that remain unresolved;
6. confirmation that no code, data, stage, commit, or push occurred unless explicitly requested.

## Failure Policy

- If repository evidence conflicts, stop at the first unresolved contract boundary and report both sources.
- If Context7 or another external documentation source is unavailable, continue only for repository-local claims and mark external claims unverified.
- If a target document contains extensive unrelated edits, avoid overwriting it; produce a focused patch or change map.
- If verification fails, do not claim completion. Report the failure and leave the edits inspectable.
