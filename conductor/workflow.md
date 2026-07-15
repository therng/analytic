# Workflow

## TDD Policy

**Flexible** — write tests for complex business logic (analytics engine, Bridge/Redis ingestion, financial calculations). Simple UI wiring and straightforward API routes don't require tests upfront. Run the closest `*.test.ts` or `pytest` file after changes to logic.

## Commit Strategy

Descriptive messages — no enforced format. Focus on the "why" in the message, not just "what changed". Keep commits atomic and meaningful.

## Code Review

Optional / self-review OK. The developer who wrote the change is responsible for verifying it works before merging.

## Verification Checkpoints

Verify at **track completion** only. Use `npm run build` + `npm run lint` as the standard check. For Bridge/Redis ingestion or analytics changes, run the relevant worker/trading tests.

## Task Lifecycle

1. Task created in a track
2. Implementation in progress
3. Relevant tests run (if applicable)
4. `npm run build` passes
5. Manual verification at track completion
6. Merged

## Standard Verification Commands

```bash
npm run build          # Required baseline for all app changes
npm run lint           # ESLint
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/time.test.ts
cd backend && source venv/bin/activate && PYTHONPATH=.. pytest
```
