# Analytic API Reference

Internal REST API for the MT5 trading account dashboard. All routes are Next.js App Router handlers under `/src/app/api/`.

---

## Common Behavior

- **Authentication**: Only social endpoints require auth (`/api/social/*`). Account and health endpoints are public within the deployment.
- **Caching**: Account detail routes use a two-layer cache — Redis (TTL 5s, version-key invalidation) + in-memory LRU (max 500 bundles). List and health routes set `no-store`.
- **Timeframe parameter**: All `/api/accounts/[id]/*` endpoints accept `?timeframe=` with values `1d | 1w | 1m | all`. Defaults to `1d`.
- **Dates**: All timestamps are ISO 8601 strings. Display layer converts to Bangkok time (Asia/Bangkok, UTC+7) via `src/lib/time.ts`.
- **Error format**: `{ error: string }` with appropriate HTTP status code.

---

## Accounts

### `GET /api/accounts`

Returns the full account list with current snapshots, sorted by Growth 1D descending.

**Response:** `AccountListItem[]`

```ts
{
  id: string;
  accountNo: string;
  accountName: string;
  company: string;
  currency: string;
  serverName: string;
  snapshot: {
    balance: number;
    equity: number;
    margin: number;
    marginLevel: number | null;
    floatingPl: number;
    creditFacility: number;
    freeMargin: number;
  } | null;
  growth1d: number | null;
  growth1w: number | null;
  growth1m: number | null;
  growthAll: number | null;
  pips1d: number | null;
}
```

**Caching:** `no-store, no-cache, must-revalidate`

---

### `GET /api/accounts/[id]` · `GET /api/accounts/[id]/overview`

Full account overview for the selected timeframe. Both paths return the same payload.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `timeframe` | `1d \| 1w \| 1m \| all` | `1d` | Reporting window |

**Response:** `AccountOverviewResponse`

```ts
{
  timeframe: string;
  account: AccountMeta;
  kpis: {
    periodGrowth: number | null;
    netProfit: number | null;
    grossProfit: number | null;
    grossLoss: number | null;
    totalSwap: number | null;
    totalCommission: number | null;
    winRate: number | null;
    profitFactor: number | null;
    sharpeRatio: number | null;
    relativeDrawdownPct: number | null;
    totalPips: number | null;
    totalTrades: number | null;
  };
  openPositions: OpenPosition[];
  openBySymbol: { symbol: string; count: number; volume: number; floatingProfit: number }[];
  monthlyPerformance: { year: number; months: { month: number; growth: number | null }[] }[];
  balanceCurve: { x: string; y: number; eventType?: string; eventDelta?: number }[];
  tradeExecutions: TradeDistributionData;
}
```

---

### `GET /api/accounts/[id]/balance` · `GET /api/accounts/[id]/balance-detail`

Balance curve with drawdown overlay and risk metrics. Both paths return the same payload.

**Response:** `BalanceDetailResponse`

```ts
{
  timeframe: string;
  account: AccountMeta;
  summary: {
    absoluteDrawdown: number | null;
    relativeDrawdownPct: number | null;
    maximalDrawdownAmount: number | null;
    maximalDrawdownPct: number | null;
    averageLossTrade: number | null;
    maximalDepositLoad: number | null;
    maximumConsecutiveLossAmount: number | null;
    sharpeRatio: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
  };
  mfeMae: { available: boolean; reason: string; mfe: null; mae: null };
  balanceCurve: { x: string; y: number; balance: number; eventType?: string; eventDelta?: number }[];
  drawdownCurve: { x: string; y: number }[];
}
```

---

### `GET /api/accounts/[id]/pips` · `GET /api/accounts/[id]/pips-summary`

Pips and volume breakdown by period. Both paths return the same payload.

**Response:** `PipsSummaryResponse`

```ts
{
  timeframe: string;
  account: AccountMeta;
  rows: {
    label: string;    // Thai label: "วันนี้", "สัปดาห์นี้", "เดือนนี้", "ทั้งหมด"
    profit: number | null;
    growth: number | null;
    pips: number | null;
    volume: number | null;
  }[];
}
```

---

### `GET /api/accounts/[id]/positions`

Closed position history with open exposure summary.

**Response:** `PositionsResponse`

```ts
{
  timeframe: string;
  account: AccountMeta;
  summary: {
    dealCount: number | null;
    totalTrades: number | null;
    tradeActivityPercent: number | null;
    algoTradingPercent: number | null;
    tradesPerWeek: number | null;
    averageProfitTrade: number | null;
    longTradesTotal: number | null;
    shortTradesTotal: number | null;
    longTradeWin: number | null;
    shortTradeWin: number | null;
    averageHoldHours: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    sharpeRatio: number | null;
    expectedPayoff: number | null;
  };
  openPositions: OpenPosition[];
  workingOrders: [];
  openBySymbol: { symbol: string; count: number; volume: number; floatingProfit: number }[];
  historyPositions: {
    positionId: string;
    symbol: string;
    type: "Buy" | "Sell";
    volume: number;
    openedAt: string;
    closedAt: string;
    openPrice: number;
    closePrice: number;
    profit: number;
    sl: number | null;
    tp: number | null;
    swap: number;
    commission: number;
    pips: number | null;
    comment: string | null;
    slHit: boolean;
    tpHit: boolean;
  }[];
  recentDeals: {
    dealId: string;
    symbol: string;
    side: string;
    volume: number;
    time: string;
    price: number;
    pnl: number;
  }[];  // last 30
}
```

---

### `GET /api/accounts/[id]/profit` · `GET /api/accounts/[id]/profit-detail`

P&L breakdown by symbol and daily distribution. Both paths return the same payload.

**Response:** `ProfitDetailResponse`

```ts
{
  timeframe: string;
  account: AccountMeta;
  summary: {
    netProfit: number | null;
    grossProfit: number | null;
    grossLoss: number | null;
    totalCommission: number | null;
    totalSwap: number | null;
    totalDeposit: number | null;
    totalWithdrawal: number | null;
    profitFactor: number | null;
    dailyProfit: { date: string; profit: number }[];
  };
  bySymbol: {
    symbol: string;
    trades: number;
    netProfit: number;
    avgTrade: number;
    winRate: number | null;
  }[];
  recentDeals: {
    dealId: string;
    symbol: string;
    side: string;
    volume: number;
    time: string;
    price: number;
    pnl: number;
  }[];  // last 8
}
```

---

### `GET /api/accounts/[id]/win-detail`

Win/loss analysis with streak data and per-symbol breakdown.

**Response:** `WinDetailResponse`

```ts
{
  timeframe: string;
  account: AccountMeta;
  summary: {
    winRate: number | null;
    wins: number | null;
    losses: number | null;
    longTradeWin: number | null;
    shortTradeWin: number | null;
    largestProfitTrade: number | null;
    largestLossTrade: number | null;
    sharpeRatio: number | null;
    profitFactor: number | null;
    recoveryFactor: number | null;
    expectedPayoff: number | null;
    maximumConsecutiveWins: number | null;
    maximumConsecutiveLosses: number | null;
    maximumConsecutiveProfitAmount: number | null;
    averageConsecutiveWins: number | null;
    averageConsecutiveLosses: number | null;
  };
  bySymbol: { symbol: string; trades: number; netProfit: number; winRate: number | null }[];
  bySide: { side: string; trades: number; netProfit: number; winRate: number | null }[];
  outcomeSeries: { x: string; y: number }[];  // last 30 closed trades
}
```

---

## Economic Events

### `GET /api/economic-events`

Forex Factory economic calendar filtered to Bangkok timezone.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `scope` | `default \| expanded` | `default` | `default` = today + nearest week; `expanded` = 30-day window |

**Response:**

```ts
{
  events: {
    id: string;
    name: string;
    currency: string;
    impact: "High" | "Medium" | "Low" | "Holiday";
    time: string;           // HH:MM Bangkok, or "" for all-day events
    forecast: string | null;
    previous: string | null;
    actual: string | null;
    dateLabel: string;      // e.g. "Today", "Mon Jun 24"
    isToday: boolean;
    status: "upcoming" | "released" | "holiday";
  }[];
  date: string;             // Bangkok date key YYYY-MM-DD
  scope: "default" | "expanded";
  queryScope: "today" | "week" | "empty";
}
```

**Caching:** Revalidates every 300 seconds. Deduplicates by `currency|name|hour`.  
**Fallback:** Returns empty `events: []` on Forex Factory fetch failure (6s timeout).

---

## Social

All social endpoints require an active session with `session.user.socialId`. Unauthenticated requests return `401`.

### `GET /api/social/reactions`

**Query params:**

| Param | Type | Required |
|---|---|---|
| `targetType` | string | Yes |
| `targetId` | string | Yes |

**Response:**

```ts
{
  counts: Record<string, number>;  // emoji → reaction count
  mine: string[];                  // emojis the current user has reacted with
}
```

Valid emojis: `🔥 💎 🎯 👏 😱`

---

### `POST /api/social/reactions`

Toggle a reaction (add if absent, remove if present).

**Body:**
```ts
{ targetType: string; targetId: string; emoji: string }
```

**Response:** `{ action: "added" | "removed" }`

---

### `GET /api/social/shouts`

Returns all non-expired shouts, newest first.

**Response:** `Shout[]`

```ts
{
  id: string;
  authorId: string;
  message: string;
  expiresAt: string;   // ISO — shouts expire 12h after creation
  createdAt: string;
  author: { username: string; displayName: string };
}[]
```

---

### `POST /api/social/shouts`

Post a new shout. Expires any previous shout by the same author.

**Body:** `{ message: string }` — trimmed, max 120 characters.

**Response:** The created `Shout` object.  
Publishes to Redis `SHOUT_CHANNEL` for SSE consumers.

---

### `GET /api/social/shouts/stream`

Server-Sent Events stream for real-time shout delivery.

**Response:** `text/event-stream`

```
: ping
data: {"id":"...","message":"...","author":{...}}
: keepalive    (every 25s)
```

No auth required. Subscribes to Redis `SHOUT_CHANNEL`.

---

### `POST /api/social/username`

Set or update the current user's username.

**Body:** `{ username: string }` — 3–20 chars, `[a-zA-Z0-9_]` only.

**Response:** `{ username: string }`  
Returns `409 Conflict` if username is already taken.

---

## Health

### `GET /api/health`

**Response:** `{ ok: true; timestamp: string }`

No auth, no caching. Suitable for uptime monitoring and container health checks.

---

## Shared Types

```ts
type AccountMeta = {
  id: string;
  accountNo: string;
  accountName: string;
  company: string;
  currency: string;
  serverName: string;
};

type OpenPosition = {
  positionId: string;
  symbol: string;
  type: "Buy" | "Sell";
  volume: number;
  openPrice: number;
  currentPrice: number | null;
  floatingProfit: number;
  openedAt: string;
  sl: number | null;
  tp: number | null;
  comment: string | null;
};
```

---

_Auto-generated from `src/app/api/` — 2026-06-24_
