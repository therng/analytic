# Worker Internals — Bridge/Redis Runtime

## Runtime Entry

`src/worker/index.ts` starts three services:

- `startBridgeConsumer()` — drains Bridge Redis streams into PostgreSQL.
- `startEquitySampler()` — samples Redis live state into snapshot/runtime tables.
- `startHealthServer()` — exposes `GET /health` when `WORKER_HEALTH_PORT > 0`.

The worker is Bridge/Redis-only. There is no legacy local import path, file-hash deduplication, or `ReportImport` path.

## Redis Keys

### Streams

| Key | Consumer | Target |
|---|---|---|
| `mt5:account:{login}:deals-stream` | `bridge-consumer.ts` | `Deal` |
| `mt5:account:{login}:orders-stream` | `bridge-consumer.ts` | `Order` |
| `mt5:account:{login}:position-closed-stream` | `bridge-consumer.ts` | `Position` |

The consumer group is `worker`; the consumer name is `worker-1`. Entries are acknowledged only after their Prisma upsert succeeds.

### Live State

| Key | Consumer | Target |
|---|---|---|
| `mt5:account:{login}:live` | `equity-sampler.ts` | `EquitySnapshot`, `AccountSnapshot` |
| `mt5:account:{login}:positions` | `equity-sampler.ts` | `OpenPosition`, `PositionExcursion` |
| `mt5:account:{login}:equity-state` | `equity-sampler.ts` | runtime drawdown on `EquitySnapshot` |

The `:live` hash can outlive the bridge connection. Treat `:positions` as the freshness guard before mutating `AccountSnapshot` or replacing `OpenPosition`.

## Upsert Flow

`processStreamEntry()` maps raw JSON through `src/worker/bridge-mapper.ts`:

1. Deals: upsert `Deal` by `(tradingAccountId, dealNo)`.
2. Orders: upsert `Order` by `(tradingAccountId, orderTicket)`.
3. Closed positions: upsert `Position` by `(tradingAccountId, positionNo)`.
4. Defer metric recompute while draining a stream batch.
5. Recompute once using the latest report date seen in the drained entries.

Pending stream entries older than `CLAIM_IDLE_MS` are reclaimed and retried.

## Live Sampling Flow

`startEquitySampler()`:

1. Ensures accounts exist for live Redis keys via `ensureBridgeAccounts()`.
2. Reads live account state and active positions for each account.
3. Writes `EquitySnapshot` and `PositionExcursion`.
4. Only when positions data is fresh, upserts `AccountSnapshot` and replaces `OpenPosition`.

This prevents stale live hashes from wiping open positions or presenting stale WebSocket data as current account state.

## Environment Variables

| Variable | Default | Purpose |
|---|---:|---|
| `REDIS_URL` | required | Redis connection string |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `WORKER_POLL_MS` | `150000` | Worker heartbeat interval |
| `WORKER_HEALTH_PORT` | `9100` | Worker health HTTP port; `0` disables |
| `WORKER_HEALTH_STALE_MS` | `WORKER_POLL_MS * 2 + 60000` | Stale threshold for `/health` |

## Verification

Run the focused worker tests after changing worker runtime behavior:

```bash
node --import tsx --test src/worker/bridge-only-runtime.test.ts
node --import tsx --test src/worker/equity-sampler.test.ts
node --import tsx --test src/worker/health.test.ts
```

Also run `npm run lint` before finishing code changes.
