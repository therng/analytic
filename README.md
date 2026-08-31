# Trading Analytics Dashboard

This is a Next.js application that provides a dashboard for analyzing trading account performance. It uses Prisma to connect to PostgreSQL, a Bridge/Redis-backed worker to consume MT5 data, and a React frontend to display analytics.

**Data path:** MT5 API → Python bridge (`bridge/`, runs beside the MT5 terminals) → Redis (live keys + history streams) → Worker V2 (`src/worker-v2/`) → PostgreSQL → dashboard.

## Getting Started

### Prerequisites

- Node.js (v20.x or later)
- npm
- PostgreSQL 16+ and Redis 7.2+ (native services or WSL2; the repo no longer ships a Docker/Compose stack)

### Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd analytic
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure the environment:**
    Point `DATABASE_URL` and `REDIS_URL` in your local `.env` at your PostgreSQL and Redis instances (never commit that file).

4.  **Run database migrations and start the development server:**

    ```bash
    npx prisma migrate dev
    npm run dev
    ```

The local application is available at [http://localhost:3000](http://localhost:3000).

## Production deployment

Production runs as **native Windows services on a single host** (`forexvps`, Windows Server 2022): MT5 terminals + the `bridge` NSSM service, plus PostgreSQL 18, Redis 7.2 in WSL2, `analytic-web`, `analytic-worker`, and Caddy (the only public exposure, serving `https://therng.duckdns.org`). The data plane is loopback-only; deploys are `git pull` + on-host rebuild.

- Design: `docs/superpowers/specs/2026-08-17-windows-single-host-migration-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-17-windows-single-host-migration.md`

## Architecture

The application uses a Bridge/Redis architecture optimized for historical analytics and low-latency real-time monitoring:

### 1. Historical Analytics (Next.js/TypeScript)

- **Frontend:** A Next.js/React application that provides a dark-themed, high-density analytical dashboard.
- **Backend API:** Next.js Route Handlers serving analytical data with an in-memory caching layer (`preaggregated-cache.ts`).
- **Database:** PostgreSQL (via Prisma ORM) for long-term relational storage.
- **Worker V2:** The sole background service in `src/worker-v2/index.ts`; it consumes durable Redis streams, syncs live state, samples equity/excursions, and polls economic events.

### 2. Redis Cache

- **Redis Layer:** Transport between the bridge and Worker V2 — per-account live snapshot keys (`mt5:account:{login}:live`, 60 s TTL) and durable history streams (`mt5:account:{login}:stream:history`, consumer-group based) — plus state caching for the web layer. The dashboard's live updates are HTTP polling; there are no WebSockets.

### Component Map

- `src/app/`: Next.js App Router entry points and layouts.
- `src/components/trading-monitor/`: Modularized dashboard UI components.
- `src/lib/trading/`: Core analytics engine for growth and drawdown metrics.
- `src/worker-v2/`: The sole Node worker — durable Deal/Order/Position ingestion, live sync, equity/excursion sampling, economic events.
- `bridge/`: The native MT5 bridge (Python) — publishes to Redis with lease-based fencing; owns history backfill state in a per-account SQLite journal.
- `prisma/`: Relational data model and migrations.

## API Reference

### `GET /api/accounts`

- **Description:** Retrieves a list of all trading accounts.
- **Response:**
  ```json
  [
    {
      "id": "...",
      "account_number": "...",
      "owner_name": "...",
      "currency": "USD",
      "server": "...",
      "status": "Active",
      "last_updated": "...",
      "today_growth_percent": 0.42,
      "today_net_profit": 123.45,
      "today_net_pips": 12.3,
      "today_trade_count": 4,
      "open_position_count": 2,
      "position_opened_recently": true,
      "balance": 10000.0,
      "equity": 10050.0,
      "floating_pl": 50.0,
      "margin": 250.0,
      "margin_level": 4020.0,
      "deposit_load_pct": null,
      "xauusd_filled_lots": 0
    }
  ]
  ```

### `GET /api/accounts/[id]?timeframe=<all|1d|1w|1m|3m|6m|1y>`

- **Description:** Retrieves a detailed overview for a specific account.
- **Parameters:**
  - `id` (required): The ID of the trading account.
  - `timeframe` (optional): The timeframe for the data. Defaults to `all`.
- **Response:** A JSON object containing KPIs, balance curve data, and open positions.

### `GET /api/accounts/[id]/balance?timeframe=<...>`

- **Description:** Retrieves balance and drawdown details for a specific account.
- **Response:** A JSON object with detailed drawdown and deposit load statistics.

### `GET /api/accounts/[id]/overview?timeframe=<...>`

- **Description:** Retrieves detailed profit and loss information for a specific account.
- **Response:** A JSON object with a summary of commissions, swaps, deposits, and withdrawals.

### `GET /api/accounts/[id]/positions?timeframe=<...>`

- **Description:** Retrieves open and historical positions plus win-rate statistics for a specific account.
- **Response:** A JSON object containing position lists, short/long win rates, largest profit trade, and consecutive-win statistics.
