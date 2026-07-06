# Review Report — MT5 Analytic Production Skill

## Change summary

This revision removes the legacy statement-file tooling from the skill package and keeps only the production runtime guidance.

Removed:

- statement-file conversion script directory
- statement field-mapping reference
- statement output-schema reference
- all command examples for local statement conversion
- all related checklist and reference links

Kept:

- Bridge → Redis → worker → Prisma/PostgreSQL → analytics/API → dashboard runtime guidance
- Redis live key and stream contracts
- worker/debug flows
- metric rules
- overfitting and advanced metric reference notes

## Final boundary

Production source boundary is now single-path only:

```text
MT5 terminal/API
  → Python Bridge
  → Redis live hashes + Redis streams
  → worker consumers/samplers
  → PostgreSQL via Prisma
  → analytics/cache/API
  → dashboard UI
```
