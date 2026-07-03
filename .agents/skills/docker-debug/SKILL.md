---
name: docker-debug
description: Debug the analytic docker-compose stack. Shows service health, recent logs per service, and common failure patterns. Use when services are down, worker not importing, or gateway not responding. Invoked as /docker-debug or /docker-debug <service-name>.
---

# Docker Debug

Diagnose the `analytic` docker-compose stack (db, redis, web, gateway, worker, caddy).

## Quick Stack Status
```bash
docker-compose ps
docker-compose logs --tail=50 <service>
```

## Services Overview

| Service | Port | Health Check |
|---------|------|-------------|
| `db` | 5432 | `docker-compose exec db pg_isready` |
| `redis` | 6379 | `docker-compose exec redis redis-cli ping` |
| `web` | 3000 | `curl http://localhost:3000/api/health` |
| `gateway` | 8000 | `curl http://localhost:8000/api/health` |
| `worker` | 9100 | `curl http://localhost:9100/health` |
| `caddy` | 80/443 | `curl http://localhost/api/health` |

## Common Failure Patterns

### Worker not importing reports
```bash
docker-compose logs --tail=100 worker
# Look for: "skipped", "fileHash exists", "WORKER_FORCE_REIMPORT"
```
Check: bridge Redis stream length/consumer lag, `LOCAL_REPORT_DIR` for manual imports, file size > `WORKER_MIN_FILE_SIZE_BYTES`

### Gateway WebSocket not connecting
```bash
docker-compose logs --tail=50 gateway
# Look for Redis connection errors
docker-compose exec redis redis-cli ping
```

### Web can't reach DB
```bash
docker-compose logs --tail=50 web
docker-compose exec db pg_isready -U postgres
```

### Caddy SSL/proxy issues
```bash
docker-compose logs --tail=50 caddy
# Check: Caddyfile config, DOMAIN env var
```

## Restart Individual Service
```bash
docker-compose restart <service>
docker-compose up -d --force-recreate <service>
```

## Full Reset (data preserved)
```bash
docker-compose down && docker-compose up -d
```

## Nuclear Option (wipes DB — ask user first)
```bash
docker-compose down -v  # removes volumes including postgres data
```
**Always confirm with user before running -v flag.**
