# โครงสร้างโปรเจกต์ Analytic — สรุปปัจจุบัน

> อัปเดต: 2026-06-19

## ภาพรวม

`analytic` คือ Next.js App Router dashboard สำหรับ monitor บัญชี MT5 แบบ real-time ออกแบบสำหรับ mobile portrait/landscape บน iOS Safari เป็นหลัก

**Stack หลัก:**
- Next.js 16 + React 19 (App Router, Server Components)
- PostgreSQL 15 + Prisma 6 (ORM + migrations)
- Redis 7 (social layer / pubsub)
- Node.js background worker (FTP import)
- Caddy reverse proxy (production)
- Docker Compose (full local stack)

---

## โครงสร้าง Directory

```
analytic/
├── src/
│   ├── app/                     # Next.js App Router
│   ├── components/              # React components
│   ├── hooks/                   # Custom React hooks
│   └── lib/                     # Business logic / utilities
├── src/worker/                  # Background FTP import worker
├── prisma/                      # Database schema + migrations
├── docs/                        # Design tokens, architecture docs
├── scripts/                     # Operational scripts
├── conductor/                   # Feature tracks (Conductor system)
└── docker-compose.yml
```

---

## src/app — Pages & API Routes

### Pages
| Path | คำอธิบาย |
|------|-----------|
| `/` | หน้าหลัก dashboard — render `DashboardClient` |
| `/patterns` | candlestick pattern visualizer |
| `/stats` | สถิติรวม (ยังไม่ fully developed) |

### API Routes (`src/app/api/`)

**Account APIs** (`/api/accounts`)
| Route | คำอธิบาย |
|-------|-----------|
| `GET /api/accounts` | รายการ accounts พร้อม snapshot ปัจจุบัน (เรียงตาม growth 1D desc) |
| `GET /api/accounts/[id]` | account detail (default timeframe) |
| `GET /api/accounts/[id]/overview` | KPIs, balance curve, open positions, monthly performance |
| `GET /api/accounts/[id]/balance` | balance/equity curve |
| `GET /api/accounts/[id]/balance-detail` | drawdown metrics, Sharpe, recovery factor |
| `GET /api/accounts/[id]/profit` | profit breakdown |
| `GET /api/accounts/[id]/profit-detail` | by-symbol profit, daily profit series |
| `GET /api/accounts/[id]/positions` | trade history, open positions, working orders |
| `GET /api/accounts/[id]/pips` | pips by timeframe |
| `GET /api/accounts/[id]/pips-summary` | pips summary table |
| `GET /api/accounts/[id]/win-detail` | win rate, consecutive wins/losses, outcome series |
| `GET /api/economic-events` | Forex Factory economic calendar (Bangkok time) |
| `GET /api/health` | health check |

**Social APIs** (`/api/social`)
| Route | คำอธิบาย |
|-------|-----------|
| `POST /api/social/shouts` | post new shout (120 chars, expires) |
| `GET /api/social/shouts/stream` | SSE stream ของ shouts ล่าสุด |
| `POST /api/social/reactions` | emoji reaction บน shout |
| `GET/POST /api/social/username` | จัดการ username ของ user |

---

## src/components — UI Components

### `trading-monitor/` — Dashboard หลัก

| Component | ขนาด (บรรทัด) | หน้าที่ |
|-----------|---------------|---------|
| `DashboardClient.tsx` | 301 | entry point, pull-to-refresh, account list fetch |
| `card/DashboardCard.tsx` | — | account card หลัก (KPI chips + expand panels) |
| `card/LazyDashboardCard.tsx` | — | lazy wrapper (intersection observer) |
| `card/DeferredDashboardCard.tsx` | — | deferred loading สำหรับ off-screen cards |
| `PerformanceQualityPanel.tsx` | 846 | panel ใหญ่สุด — Sharpe, PF, Radar, Bars, Heatmap |
| `shared.tsx` | 608 | shared styles + CSS-in-JS constants |
| `PerformanceBars.tsx` | 333 | horizontal bar charts (win rate, PF, RF) |
| `SummaryChip.tsx` | 287 | KPI chip component (growth, pips, drawdown ฯลฯ) |
| `ProfitHeatmapPanel.tsx` | 287 | monthly profit heatmap calendar |
| `BotPnLPanel.tsx` | 268 | P&L breakdown panel |
| `OpenPositionsPanel.tsx` | 235 | open positions list |
| `formatters.ts` | 234 | number/currency formatters |
| `PerformanceRadar.tsx` | 140 | 7-axis radar chart (ApexCharts) |
| `TradeHistoryPanel.tsx` | 124 | trade history table |
| `EconomicCalendarList.tsx` | 125 | economic calendar list |
| `TradingViewAnalysisModal.tsx` | 149 | TradingView widget modal |
| `LoadingScreen.tsx` | 136 | candle animation loading screen |
| `DraggableCalendarPanel.tsx` | 52 | draggable calendar overlay |
| `useApiResource.ts` | 115 | generic API fetch hook + loading state |
| `DashboardFormatters.ts` | 122 | dashboard-specific formatters |

### `social/` — Social Layer

| Component | หน้าที่ |
|-----------|---------|
| `ShoutTicker.tsx` | scrolling shout ticker bar |
| `ShoutModal.tsx` | modal compose + view shouts |
| `EmojiReactionBar.tsx` | emoji reactions บน shout |
| `UsernameSetup.tsx` | username setup wizard |

### `patterns/` — Pattern Visualizer

| Component | หน้าที่ |
|-----------|---------|
| `PatternCanvas.tsx` | canvas renderer ของ candlestick patterns |
| `PatternCard.tsx` | card wrapper ของแต่ละ pattern |
| `Candle.tsx` | single candle render |
| `TrendTrace.tsx` | trend line overlay |

---

## src/lib — Business Logic

### `trading/` — Analytics Engine

| File | ขนาด | คำอธิบาย |
|------|-------|-----------|
| `analytics.ts` | 929 บรรทัด | engine หลัก: growth calculation, MQL5-style drawdown, Sharpe, win rate, balance ops segmentation |
| `account-data.ts` | — | Prisma queries สำหรับ account list และ account detail |
| `preaggregated-cache.ts` | — | cache view จาก `AccountReportResult` |
| `calculate-report-results.ts` | — | worker: คำนวณและ upsert `AccountReportResult` |
| `core/growth.ts` | — | MQL5 absolute gain core formula |
| `core/downsample.ts` | — | time-series downsampling |
| `types.ts` | — | TypeScript interfaces ทั้งหมด (SerializedAccount, responses ฯลฯ) |

**Source Boundaries (สำคัญมาก):**
- Win rate / PF / Sharpe → `Position`
- Balance curve / Growth / Drawdown → `Deal`
- Floating P/L / Open exposure → `OpenPosition` / Redis
- Latest balance / equity / margin → `AccountSnapshot` / Redis

### `patterns/` — Candlestick Pattern Detection

| File | คำอธิบาย |
|------|-----------|
| `bullish.ts` | bullish pattern definitions (Hammer, Engulfing ฯลฯ) |
| `bearish.ts` | bearish pattern definitions |
| `index.ts` | pattern scanner / scoring |
| `types.ts` | pattern types |

### `parser/`

| File | คำอธิบาย |
|------|-----------|
| `index.ts` | MT5 HTML report parser (cheerio) — แปลง HTML → structured data |

### Utilities

| File | คำอธิบาย |
|------|-----------|
| `animations.ts` | centralized framer-motion variants (ทุก animation อยู่ที่นี่) |
| `analytics.ts` | client-side analytics tracking |
| `time.ts` | Bangkok timezone utilities (Asia/Bangkok, UTC+7) |
| `prisma.ts` | Prisma client singleton |
| `redis-social.ts` | Redis client สำหรับ social layer |
| `auth.ts` | NextAuth config + Prisma adapter |
| `fonts.ts` | font loading constants |
| `server-env.ts` | server-side env validation |
| `database-errors.ts` | Prisma error → HTTP status mapping |

---

## src/hooks — Custom React Hooks

| Hook | คำอธิบาย |
|------|-----------|
| `useRealtimeAccount.ts` | WebSocket subscription ต่อ Gateway สำหรับ live equity |
| `useShouts.ts` | SSE subscription สำหรับ social shouts |
| `useReactions.ts` | emoji reactions state |
| `useSocialSession.ts` | social user session (username, auth state) |
| `usePatternTimeline.ts` | pattern timeline data fetching |

---

## src/worker — Background Import Worker

| File | คำอธิบาย |
|------|-----------|
| `index.ts` | main loop: poll FTP → parse HTML → upsert DB → compute `AccountReportResult` |
| `health.ts` | HTTP health endpoint (`GET /health`) บน port 9100 |

**Flow:** FTP poll (ทุก `WORKER_POLL_MS` = 150s) → SHA256 dedup → cheerio parse → Prisma upsert → recompute metrics

---

## prisma/ — Database

### Schema Tables

| Table (Prisma model) | SQL name | คำอธิบาย |
|---------------------|----------|-----------|
| `TradingAccount` | `Account` | metadata ของบัญชี |
| `AccountSnapshot` | `AccountSnapshot` | state ปัจจุบัน (balance, equity, margin) |
| `AccountReportResult` | `AccountReportResult` | precomputed metrics cache (PF, Sharpe, drawdowns) |
| `Position` | `Position` | closed positions (unique: accountId + positionNo) |
| `Deal` | `Deal` | all transactions (unique: accountId + dealNo) |
| `OpenPosition` | `OpenPosition` | active positions (safe upsert) |
| `ReportImport` | `ReportImport` | import tracking + SHA256 dedup |
| `SocialUser` | `social_users` | OAuth user สำหรับ social layer |
| `Shout` | `social_shouts` | shout messages (max 120 chars, มี expiry) |
| `Reaction` | `social_reactions` | emoji reactions บน shouts |

### Migrations (ตามลำดับ)

1. `20260331124459` — bootstrap trading tables
2. `20260331124500` — add AccountReportResult
3. `20260401113000` — add deal order_id
4. `20260419160829` — v4 schema improvements
5. `20260612095025` — social layer (SocialUser, Shout, Reaction)
6. `20260612095228` — social layer indexes
7. `20260613163500` — widen analytical indexes

---

## Data Flow

### Historical Path
```
MT5 FTP server
  → Worker (poll every 150s)
    → SHA256 dedup (ReportImport)
    → cheerio HTML parser (src/lib/parser)
    → Prisma upsert (Position, Deal, OpenPosition, AccountSnapshot)
    → compute AccountReportResult (src/lib/trading/calculate-report-results.ts)
      → Next.js API routes
        → DashboardClient (fetch + render)
```

### Real-time Path (ถ้า Gateway + Collector ใช้งาน)
```
MT5 terminal
  → Collector (HTTPS + HMAC)
    → Gateway (FastAPI)
      → Redis Pub/Sub
        → WebSocket → useRealtimeAccount hook → live equity beacon
```

---

## UI Patterns

### Animation System
- ทุก framer-motion variants อยู่ที่ `src/lib/animations.ts` เท่านั้น
- ไม่ inline `variants` ใน components

### Dashboard Layout
- **Portrait:** single-column stack, compact header, dense KPI grid
- **Landscape:** two-zone workspace, balance chart dominant
- **Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions

### Chart Libraries
- **ApexCharts** (`react-apexcharts`) — balance curve, radar — ต้อง `dynamic` import (SSR unsafe)
- **Chart.js** (`react-chartjs-2`) — secondary charts

### Font Stack
- Thai body: Sarabun + Noto Sans Thai
- Numeric mono: Bai Jamjuree

### Design Tokens
- Single source: `docs/Analytic Design Tokens (Standalone).html`
- ห้ามใช้ Tailwind color defaults (`green-500`, `red-400`) — ต้องใช้ semantic tokens

---

## Environment Variables สำคัญ

| Variable | Default | คำอธิบาย |
|----------|---------|-----------|
| `DATABASE_URL` | — | PostgreSQL connection |
| `REDIS_URL` | — | Redis connection |
| `FTP_HOST/PORT/USER/PASS/PATH` | — | MT5 FTP source |
| `WORKER_POLL_MS` | 150000 | poll interval |
| `WORKER_HEALTH_PORT` | 9100 | worker health endpoint |
| `LOCAL_REPORT_DIR` | `data/source-reports` | local report override |

---

## คำสั่งสำคัญ

```bash
npm run dev              # dev server
npm run build            # production build (baseline check)
npm run lint             # ESLint

# Tests
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/account-data.test.ts
node --import tsx --test src/lib/trading/core/growth.test.ts

# Worker
npm run worker:local     # single pass จาก local files

# DB
npx prisma migrate dev   # apply migrations
npx prisma generate      # regenerate client
```
