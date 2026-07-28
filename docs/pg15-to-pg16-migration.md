# PostgreSQL 15 → 16 Migration Plan (Production)

Context: `docker-compose.yml`'s `db` service, `docker-compose.test.yml`'s `db-test`, and `.github/workflows/ci.yml` were bumped to `postgres:16-alpine`. CI and the test stack are disposable (fresh volume each run) — no action needed there. This plan covers the **named volume `postgres_data`** backing prod, which holds real trading data and cannot start under a pg16 binary without a dump/restore (pg major versions are not on-disk compatible).

## Pre-checks

- Confirm current running version: `docker compose exec db psql -U supachai -d trading_db -c "SHOW server_version;"`
- Confirm disk headroom on host for a second copy of the data directory + a SQL dump (check `docker system df` and host `df -h`).
- Announce/schedule a maintenance window — worker-v2 and web must be stopped for the duration (writes during dump = inconsistent restore).

## Step 1 — Stop writers, take final backup

```bash
# Stop everything that writes to the DB; leave db running for the dump
docker compose stop web worker-v2

# Full logical dump, custom format (parallel-restorable, includes schema+data)
docker compose exec db pg_dump -U supachai -d trading_db -Fc -f /tmp/trading_db_pre16.dump
docker compose cp db:/tmp/trading_db_pre16.dump ./trading_db_pre16.dump

# Verify the dump is non-trivial and restorable-looking
docker compose exec db pg_restore -l /tmp/trading_db_pre16.dump | head -20
ls -lh ./trading_db_pre16.dump
```

Keep `trading_db_pre16.dump` off the docker host too (scp to another machine) — it's the rollback anchor.

## Step 2 — Stop db, snapshot the volume (belt-and-suspenders rollback)

```bash
docker compose stop db

# Snapshot the named volume itself, not just the logical dump
docker run --rm -v analytic_postgres_data:/from -v "$PWD":/backup alpine \
  tar czf /backup/postgres_data_pg15_$(date +%Y%m%d).tar.gz -C /from .
```

(Volume name may be prefixed by the compose project name, e.g. `analytic_postgres_data` — check `docker volume ls` first.)

## Step 3 — Create a fresh pg16 volume, restore

Do **not** point pg16 at the old pg15 volume directly.

```bash
# Point compose at a new volume name temporarily, or rename/remove the old one
# after Step 2's snapshot is confirmed good, then recreate:
docker volume rm analytic_postgres_data
docker compose up -d db   # now pulls postgres:16-alpine per the edited docker-compose.yml, creates a fresh empty volume

# Wait for health check to pass
docker compose ps db

# Restore into the fresh pg16 instance
docker compose cp ./trading_db_pre16.dump db:/tmp/trading_db_pre16.dump
docker compose exec db pg_restore -U supachai -d trading_db --clean --if-exists --create -j4 /tmp/trading_db_pre16.dump
```

If `trading_db` doesn't exist yet on the fresh cluster (POSTGRES_DB env creates it on init), drop `--create` and restore straight into it.

## Step 4 — Verify

```bash
docker compose exec db psql -U supachai -d trading_db -c "SHOW server_version;"   # expect 16.x
docker compose exec db psql -U supachai -d trading_db -c "\dt" | wc -l             # table count sanity check vs pre-migration
docker compose exec db psql -U supachai -d trading_db -c "SELECT count(*) FROM \"Account\";"
docker compose exec db psql -U supachai -d trading_db -c "SELECT count(*) FROM \"Deal\";"
```

Compare row counts against numbers captured before Step 1 (run the same counts pre-migration and save them).

```bash
npx prisma migrate deploy   # confirm Prisma sees the schema as up to date, no pending migrations
npx prisma generate
```

## Step 5 — Bring workers back up

```bash
docker compose up -d web worker-v2
docker compose logs -f worker-v2   # watch for durable-history / equity-sampler startup errors
curl -s localhost/api/health       # or WORKER_V2_HEALTH_PORT endpoint
```

Watch first few equity-sample cycles (60s cadence) and next scheduled history-backfill chunk actually persists — don't declare done on health check alone.

## Rollback (if Step 3/4 verification fails)

```bash
docker compose stop db web worker-v2
docker volume rm analytic_postgres_data
docker volume create analytic_postgres_data
docker run --rm -v analytic_postgres_data:/to -v "$PWD":/backup alpine \
  tar xzf /backup/postgres_data_pg15_<date>.tar.gz -C /to

# Revert docker-compose.yml db image back to postgres:15-alpine before starting
docker compose up -d db web worker-v2
```

Keeping the pg15-tagged image line revertible is why the volume snapshot (Step 2) matters more than the logical dump alone for a fast rollback — restoring the tarball is a straight volume swap, no `pg_restore` pass needed.

## Cleanup

Once pg16 has run clean for a few days (equity samples, history backfill chunks, live sync all confirmed healthy):

```bash
rm ./trading_db_pre16.dump
rm ./postgres_data_pg15_*.tar.gz   # or move to cold storage instead of deleting
```
