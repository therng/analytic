# Trading Analytics Dashboard

This project is a high-performance, dark-themed analytics dashboard for MT5 (MetaTrader 5) trading accounts. It provides deep insights into trading performance, growth metrics, and balance-operation-aware statistics.

## Project Overview

- **Frontend:** Next.js 16, React 19, Tailwind CSS.
- **Backend (Real-time):** FastAPI (Python) with Redis for live-state management and WebSocket streaming.
- **Backend (Historical):** Next.js API Routes (Route Handlers) with an in-memory caching layer.
- **Database:** PostgreSQL with Prisma ORM.
- **Collector:** A Python sidecar service that polls live MT5 data and pushes HMAC-signed updates.
- **Worker:** A background Node.js service for fetching (FTP), parsing (Cheerio), and importing trading reports.
- **Key Features:** Multi-account monitoring, near-realtime equity tracking, open positions view, and performance quality analytics.

## Architecture

- `src/app/`: Next.js App Router entry points and layouts.
- `backend/`: FastAPI ingestion gateway and WebSocket manager.
- `collector/`: Python-based MT5 sidecar collector.
- `src/app/api/`: RESTful API routes serving historical dashboard data.
- `src/components/trading-monitor/`: Core dashboard UI components.
- `src/lib/parser/`: Robust MT5 HTML report scraping logic.
- `src/lib/trading/`: Core analytics library for performance metrics.
- `src/worker/`: Historical report ingestion pipeline.
- `prisma/`: Database schema and migration history.

## Development Guide

### Prerequisites

- Node.js (v20.x or later)
- Docker & Docker Compose (for PostgreSQL)
- MT5 HTML reports (for ingestion)

### Building and Running

- **Development:** `npm run dev`
- **Database Migrations:** `npx prisma migrate dev`
- **Worker (Development):** `npm run worker:dev`
- **Worker (Production):** `npm run worker`
- **Clean Database:** `npm run db:clean` (custom script)
- **Backfill Results:** `npm run db:backfill-report-results`

### Testing

- **Formatters:** `npm run test:formatters`
- **Parser:** `npm run test:parser`

## Development Conventions

- **UI Components:** Follow the dark-themed aesthetic. Components in `src/components/trading-monitor` are heavily modularized.
- **Data Formatting:** Use functions in `src/components/trading-monitor/formatters.ts` and `src/components/trading-monitor/DashboardFormatters.ts` for consistent data display.
- **API Resources:** Use the `useApiResource` hook for fetching data from the internal API.
- **Type Safety:** Maintain strict TypeScript definitions in `src/lib/trading/types.ts`.
- **Database:** Always map fields to snake_case in PostgreSQL using `@map` in `schema.prisma`.
- **Worker:** The worker uses `basic-ftp` for report acquisition. It supports `WORKER_FORCE_REIMPORT` and `REPORT_SOURCE=local` for debugging and reprocessing.

## Key Files

- `prisma/schema.prisma`: The source of truth for the data model.
- `src/worker/index.ts`: The entry point for the report ingestion pipeline.
- `src/components/trading-monitor/DashboardClient.tsx`: The primary dashboard container.
- `src/lib/parser/index.ts`: The MT5 report parsing engine.
- `src/lib/trading/preaggregated-cache.ts`: Caching layer for complex analytical queries.
