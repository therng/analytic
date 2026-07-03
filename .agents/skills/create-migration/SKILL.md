---
name: create-migration
description: Guided Prisma migration workflow for the analytic project. Runs schema edit → safety review → migrate dev → verify. Use when adding columns, changing types, or modifying indexes on any production table. Invoked as /create-migration <migration-name>.
---

# Create Migration

Safe Prisma migration workflow for the `analytic` trading dashboard.

## Steps

### 1. Pre-flight Check
```bash
git status  # ensure clean state before schema changes
npx prisma migrate status  # check current migration state
```

### 2. Edit Schema
Open `prisma/schema.prisma` and make the required changes.

### 3. Safety Review (before migrating)
Call the `prisma-migration-reviewer` subagent to review the pending changes:
- Describe the schema diff
- Wait for risk assessment
- If CRITICAL or DO NOT APPLY — stop and fix

### 4. Generate & Apply Migration
```bash
npx prisma migrate dev --name <migration-name>
```
- Migration name: use lowercase-kebab-case (e.g. `add-pips-to-position`)
- Review the generated SQL in `prisma/migrations/<timestamp>_<name>/migration.sql` before confirming

### 5. Verify
```bash
npx prisma generate  # ensure client is in sync
npm run build        # full type-check via build
```

### 6. If Adding Columns with Data Backfill
Run the appropriate backfill script or create one in `scripts/`. Never backfill in the migration SQL itself — run as a separate step after migration succeeds.

## Common Patterns

**Add nullable column (safe):**
```prisma
pipsValue  Decimal?  // always nullable first, backfill, then make required
```

**Add index on existing table:**
```prisma
@@index([accountId, time])  // check if similar index already exists first
```

**Never do in migration SQL:**
- `ALTER TABLE ... ADD COLUMN foo NOT NULL` on large tables without a DEFAULT
- `DROP INDEX` without verifying it's unused in analytics queries
