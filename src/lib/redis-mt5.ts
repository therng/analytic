import { getRedisSocialClient } from "@/lib/redis-social";
import { epochSecondsToDate } from "@/lib/time";

export interface Mt5LiveInfo {
  login: string;
  name: string | null;
  server: string | null;
  company: string | null;
  leverage: number | null;
  tradeMode: number | null;
  limitOrders: number | null;
  marginSoMode: number | null;
  tradeAllowed: boolean | null;
  tradeExpert: boolean | null;
  marginMode: number | null;
  currencyDigits: number | null;
  fifoClose: boolean | null;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  profit: number;
  credit: number;
  currency: string;
  marginSoCall: number | null;
  marginSoSo: number | null;
  marginInitial: number | null;
  marginMaintenance: number | null;
  commissionBlocked: number | null;
  terminalCommunityAccount: boolean | null;
  terminalCommunityConnection: boolean | null;
  terminalConnected: boolean | null;
  terminalTradeAllowed: boolean | null;
  terminalTradeapiDisabled: boolean | null;
  terminalFtpEnabled: boolean | null;
  terminalNotificationsEnabled: boolean | null;
  terminalBuild: number | null;
  terminalMaxbars: number | null;
  terminalPingLast: number | null;
  terminalName: string | null;
  terminalPath: string | null;
  terminalDataPath: string | null;
  terminalCommondataPath: string | null;
  ordersTotal: number | null;
  positionsTotal: number | null;
  historyOrdersTotal: number | null;
  historyDealsTotal: number | null;
  historyTotalsUpdatedAt: number | null;
  timestamp: number | null;
}

export interface Mt5Position {
  ticket: number;
  symbol: string;
  type: number;
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  comment: string;
  openTime: number;
  magic?: number | null;
}

export interface Mt5LiveData {
  live: Mt5LiveInfo | null;
  positions: Mt5Position[];
  stale: boolean;
  positionsPage?: {
    total: number;
    limit: number;
    hasMore: boolean;
  };
}

/**
 * Corrects MT5 `positions_get()` open times (broker server wall clock, not
 * UTC) to true UTC epochs for API consumers. See `epochSecondsToDate`.
 */
export function normalizeMt5PositionTimes(
  positions: Mt5Position[],
  brokerUtcOffsetMinutes: number,
): Mt5Position[] {
  return positions.map((position) => ({
    ...position,
    openTime: epochSecondsToDate(
      position.openTime,
      brokerUtcOffsetMinutes,
    ).getTime() / 1000,
  }));
}

const DEFAULT_LIVE_POSITION_LIMIT = 1000;
const MAX_LIVE_POSITION_LIMIT = 1000;

// The native bridge (bridge/) publishes a fresh live.snapshot envelope every
// poll tick. A snapshot older than this is treated as a stalled/disconnected
// bridge — mirrors the old heartbeat-staleness threshold.
const HEARTBEAT_STALE_MS = 60_000;

function parseOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function parseOptionalNumber(value: unknown): number | null {
  const numeric = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function clampLivePositionLimit(limit: number | null | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIVE_POSITION_LIMIT;
  }

  return Math.max(
    1,
    Math.min(MAX_LIVE_POSITION_LIMIT, Math.trunc(Number(limit))),
  );
}

// Native bridge (bridge/) contract: one JSON envelope per account at
// mt5n:v1:live:{login} (literal braces — a Redis hash tag, not a template
// placeholder; see bridge/redis_transport.py's cluster_keys). schema is
// always "mt5n.bridge.v1"; message_type is "live.snapshot" for this key.
// payload.account.raw / payload.orders.rows / payload.positions.rows are the
// MT5 API's own dict shapes (mt5.account_info()._asdict(),
// positions_get()._asdict()), forwarded verbatim.
interface BridgeLiveEnvelope {
  schema?: unknown;
  message_type?: unknown;
  observed_at_utc?: unknown;
  payload?: {
    account?: { raw?: Record<string, unknown>; state?: unknown };
    orders?: { rows?: unknown[]; state?: unknown };
    positions?: { rows?: unknown[]; state?: unknown };
  };
}

interface NativePositionRaw {
  ticket: number;
  symbol: string;
  type: number;
  magic?: number | null;
  volume: number;
  price_open: number;
  price_current: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  comment: string;
  time: number;
}

function liveKey(accountNo: string): string {
  return `mt5n:v1:live:{${accountNo}}`;
}

function parseBridgeLiveEnvelope(raw: string): BridgeLiveEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as BridgeLiveEnvelope;
    if (
      parsed.schema !== "mt5n.bridge.v1" ||
      parsed.message_type !== "live.snapshot"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getMt5LiveData(
  accountNo: string,
  options: { positionLimit?: number | null } = {},
): Promise<Mt5LiveData> {
  const r = await getRedisSocialClient();
  const raw = await r.get(liveKey(accountNo));
  const envelope = raw ? parseBridgeLiveEnvelope(raw) : null;

  const observedAtMs = envelope
    ? Date.parse(String(envelope.observed_at_utc))
    : NaN;
  const fresh =
    Number.isFinite(observedAtMs) && Date.now() - observedAtMs < HEARTBEAT_STALE_MS;
  const accountRaw = envelope?.payload?.account?.raw ?? null;
  const accountOk = envelope?.payload?.account?.state === "success_nonempty"
    || envelope?.payload?.account?.state === "success_empty";
  const positionsRows = envelope?.payload?.positions?.rows;
  const ordersRows = envelope?.payload?.orders?.rows;

  const live: Mt5LiveInfo | null =
    accountRaw && accountOk
      ? {
          login: String(accountRaw.login ?? accountNo),
          name: parseOptionalText(accountRaw.name),
          server: parseOptionalText(accountRaw.server),
          company: parseOptionalText(accountRaw.company),
          leverage: parseOptionalNumber(accountRaw.leverage),
          tradeMode: parseOptionalNumber(accountRaw.trade_mode),
          limitOrders: parseOptionalNumber(accountRaw.limit_orders),
          marginSoMode: parseOptionalNumber(accountRaw.margin_so_mode),
          tradeAllowed: parseOptionalBoolean(accountRaw.trade_allowed),
          tradeExpert: parseOptionalBoolean(accountRaw.trade_expert),
          marginMode: parseOptionalNumber(accountRaw.margin_mode),
          currencyDigits: parseOptionalNumber(accountRaw.currency_digits),
          fifoClose: parseOptionalBoolean(accountRaw.fifo_close),
          balance: parseOptionalNumber(accountRaw.balance) ?? 0,
          equity: parseOptionalNumber(accountRaw.equity) ?? 0,
          margin: parseOptionalNumber(accountRaw.margin) ?? 0,
          freeMargin: parseOptionalNumber(accountRaw.margin_free) ?? 0,
          marginLevel: parseOptionalNumber(accountRaw.margin_level) ?? 0,
          profit: parseOptionalNumber(accountRaw.profit) ?? 0,
          credit: parseOptionalNumber(accountRaw.credit) ?? 0,
          currency: String(accountRaw.currency ?? ""),
          marginSoCall: parseOptionalNumber(accountRaw.margin_so_call),
          marginSoSo: parseOptionalNumber(accountRaw.margin_so_so),
          marginInitial: parseOptionalNumber(accountRaw.margin_initial),
          marginMaintenance: parseOptionalNumber(accountRaw.margin_maintenance),
          commissionBlocked: parseOptionalNumber(accountRaw.commission_blocked),
          terminalCommunityAccount: null,
          terminalCommunityConnection: null,
          // The native envelope doesn't carry a discrete terminal-connected
          // flag — derive it from snapshot recency, same signal `stale` uses.
          terminalConnected: fresh,
          terminalTradeAllowed: null,
          terminalTradeapiDisabled: null,
          terminalFtpEnabled: null,
          terminalNotificationsEnabled: null,
          terminalBuild: null,
          terminalMaxbars: null,
          terminalPingLast: null,
          terminalName: null,
          terminalPath: null,
          terminalDataPath: null,
          terminalCommondataPath: null,
          ordersTotal: Array.isArray(ordersRows) ? ordersRows.length : null,
          positionsTotal: Array.isArray(positionsRows)
            ? positionsRows.length
            : null,
          historyOrdersTotal: null,
          historyDealsTotal: null,
          historyTotalsUpdatedAt: null,
          timestamp: Number.isFinite(observedAtMs)
            ? Math.floor(observedAtMs / 1000)
            : null,
        }
      : null;

  const stale = !fresh || !live;

  const allPositionsRaw = Array.isArray(positionsRows)
    ? (positionsRows as NativePositionRaw[])
    : [];
  const allPositions: Mt5Position[] = allPositionsRaw.map((p) => ({
    ticket: p.ticket,
    symbol: p.symbol,
    type: p.type,
    volume: p.volume,
    openPrice: p.price_open,
    currentPrice: p.price_current,
    sl: p.sl,
    tp: p.tp,
    profit: p.profit,
    swap: p.swap,
    comment: p.comment,
    openTime: p.time,
    magic: p.magic ?? null,
  }));
  const positionLimit = clampLivePositionLimit(options.positionLimit);
  const positions = allPositions.slice(0, positionLimit);

  return {
    live,
    positions,
    stale,
    positionsPage: {
      total: allPositions.length,
      limit: positionLimit,
      hasMore: allPositions.length > positions.length,
    },
  };
}
