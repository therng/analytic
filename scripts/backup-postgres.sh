#!/bin/sh
# Dumps analytic-db-1 to a timestamped file and prunes dumps older than 14 days.
set -eu

BACKUP_DIR="$HOME/docker-backup-rescue"
CONTAINER="analytic-db-1"
DB_USER="${POSTGRES_USER:-supachai}"
DB_NAME="${POSTGRES_DB:-trading_db}"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/trading_db_${STAMP}.dump"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -F c -f /tmp/backup.dump
docker cp "$CONTAINER:/tmp/backup.dump" "$OUT"
docker exec "$CONTAINER" rm -f /tmp/backup.dump

find "$BACKUP_DIR" -name 'trading_db_*.dump' -mtime "+${RETENTION_DAYS}" -delete
