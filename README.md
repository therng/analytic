# Trading Analytics Dashboard

This is a Next.js application that provides a dashboard for analyzing trading account performance. It uses Prisma to connect to PostgreSQL, a Bridge/Redis-backed worker to consume MT5 data, and a React frontend to display analytics.

## Getting Started

### Prerequisites

- Node.js (v20.x or later)
- npm
- Docker and Docker Compose

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

3.  **Set the Compose secret:**
    The main Compose stack requires `REDIS_PASSWORD` because Redis is published on port `6379`. Export it in your shell or place it in a local `.env` file (never commit that file).

    ```bash
    export REDIS_PASSWORD='choose-a-local-password'
    ```

4.  **Start the local stack:**
    The Compose stack starts PostgreSQL, Redis, the Next.js web service, Worker V2, and Caddy. The web container applies pending Prisma migrations on startup.

    ```bash
    docker compose up -d --build
    ```

5.  **Run the development server (optional):**
    Use this when developing the Next.js app outside the web container. Stop the Compose `web` service first if port `3000` is already in use.

    ```bash
    docker compose stop web
    npm run dev
    ```

The local application is available at [http://localhost:3000](http://localhost:3000). Caddy serves the stack on port `80`; HTTPS for `therng.duckdns.org` additionally requires `DUCKDNS_TOKEN`.

### Isolated test services

The test Compose file uses separate ports and a separate volume, so it can run alongside the main stack:

```bash
npm run test:env:up       # PostgreSQL :5434 and Redis :6380
npm run test:env:down     # Stop and remove the test containers and volume
```

The first command creates `.env.test` from `.env.test.example` when needed. Adjust `.env.test` for local credentials or port changes; it is ignored by Git and Docker builds.

To stop the main stack without removing persistent data:

```bash
docker compose down
```

Use `docker compose down -v` only when you intentionally want to remove the local PostgreSQL and Redis volumes.

## Architecture

The application uses a Bridge/Redis architecture optimized for historical analytics and low-latency real-time monitoring:

### 1. Historical Analytics (Next.js/TypeScript)

- **Frontend:** A Next.js/React application that provides a dark-themed, high-density analytical dashboard.
- **Backend API:** Next.js Route Handlers serving analytical data with an in-memory caching layer (`preaggregated-cache.ts`).
- **Database:** PostgreSQL (via Prisma ORM) for long-term relational storage.
- **Worker V2:** The sole background service in `src/worker-v2/index.ts`; it consumes durable Redis streams, syncs live state, samples equity/excursions, and polls economic events.

### 2. Redis Cache

- **Redis Layer:** Used for state caching and Pub/Sub broadcasting to WebSockets.

### Component Map

- `src/app/`: Next.js App Router entry points and layouts.
- `src/components/trading-monitor/`: Modularized dashboard UI components.
- `src/lib/trading/`: Core analytics engine for growth and drawdown metrics.
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
      ...
    }
  ]
  ```

### `GET /api/accounts/[id]?timeframe=<all|1d|7d|30d>`

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
