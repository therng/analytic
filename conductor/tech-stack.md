# Tech Stack

## Languages

- **TypeScript** — frontend and Node.js worker
- **Python 3.12** — MT5 bridge utilities

## Frontend

- **Next.js 16** App Router + **React 19**
- **ApexCharts** + **Chart.js** for trading charts
- **CSS Modules** via `src/app/globals.css`

## Backend

- **Node.js** background worker — Redis stream consumption, live sampling, DB writes

## Database

- **PostgreSQL 15** — primary data store
- **Prisma 6** — ORM + migrations
- **Redis 7** — pub/sub broadcasting + cache

## Infrastructure

- **Docker Compose** — local and production stack
- **Caddy** — reverse proxy (port 80)
- Self-hosted

## Key Dependencies

| Package                           | Purpose          |
| --------------------------------- | ---------------- |
| `@prisma/client`                  | DB access        |
| `apexcharts` / `react-apexcharts` | Trading charts   |
| `chart.js` / `react-chartjs-2`    | Secondary charts |

## Source Boundaries (Critical)

| Data                            | Source                    |
| ------------------------------- | ------------------------- |
| Win rate, profit factor, Sharpe | `Position` table          |
| Balance curve, drawdown         | `Deal` table              |
| Floating P/L, open exposure     | `OpenPosition` + Redis    |
| Latest balance, equity, margin  | `AccountSnapshot` + Redis |
