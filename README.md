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

3.  **Set up environment variables:**
    Copy the `.env.example` file to `.env` and fill in the required values, especially the `DATABASE_URL`.

    ```bash
    cp .env.example .env
    ```

4.  **Start the database:**
    The project uses a PostgreSQL database managed with Docker Compose.

    ```bash
    docker-compose up -d
    ```

5.  **Run database migrations:**

    ```bash
    npx prisma migrate dev
    ```

6.  **Run the development server:**
    ```bash
    npm run dev
    ```

The application should now be running at [http://localhost:3000](http://localhost:3000).

## Architecture

The application uses a Bridge/Redis architecture optimized for historical analytics and low-latency real-time monitoring:

### 1. Historical Analytics (Next.js/TypeScript)

- **Frontend:** A Next.js/React application that provides a dark-themed, high-density analytical dashboard.
- **Backend API:** Next.js Route Handlers serving analytical data with an in-memory caching layer (`preaggregated-cache.ts`).
- **Database:** PostgreSQL (via Prisma ORM) for long-term relational storage.
- **Worker:** A background service in `src/worker/index.ts` that consumes Redis streams and live Redis state from the MT5 bridge.

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
