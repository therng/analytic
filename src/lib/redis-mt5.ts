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

/** Preserves MetaTrader Python UTC epochs for API consumers. */
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

// bridge_v2's heartbeat write cadence is V2_LIVE_POLL_INTERVAL (default 2s).
// A heartbeat older than this is treated as a stalled/disconnected bridge.
const HEARTBEAT_STALE_MS = 60_000;

function parseOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function parseOptionalNumber(value: string | null | undefined) {
  const numeric = Number.parseFloat(value ?? "NaN");
  return Number.isFinite(numeric) ? numeric : null;
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

// bridge_v2 (the currently-running bridge) publishes only mt5:v2:* keys —
// see bridge_v2/config.py's key_live/key_positions/key_heartbeat. The legacy
// mt5:account:<no>:{live,positions} keys have no writer left in this repo or
// on the VPS and go stale the moment the bridge that used to write them
// stops running.
interface Mt5V2PositionRaw {
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

export async function getMt5LiveData(
  accountNo: string,
  options: { positionLimit?: number | null } = {},
): Promise<Mt5LiveData> {
  const r = await getRedisSocialClient();
  const keyLive = `mt5:v2:account:${accountNo}:live`;
  const keyPos = `mt5:v2:account:${accountNo}:positions`;
  const keyHeartbeat = `mt5:v2:bridge:${accountNo}:heartbeat`;

  const [liveRaw, posJson, heartbeat] = await Promise.all([
    r.hGetAll(keyLive),
    r.get(keyPos),
    r.hGetAll(keyHeartbeat),
  ]);

  const hasLive = liveRaw && Object.keys(liveRaw).length > 0;
  const lastSeen = parseOptionalNumber(heartbeat?.lastSeen);
  const heartbeatFresh =
    lastSeen != null && Date.now() - lastSeen * 1000 < HEARTBEAT_STALE_MS;
  const stale = !posJson || !heartbeatFresh;

  const live: Mt5LiveInfo | null = hasLive
    ? {
        login: liveRaw.login,
        name: parseOptionalText(liveRaw.name),
        server: parseOptionalText(liveRaw.server),
        company: parseOptionalText(liveRaw.company),
        leverage: parseOptionalNumber(liveRaw.leverage),
        tradeMode: parseOptionalNumber(liveRaw.trade_mode),
        limitOrders: null,
        marginSoMode: null,
        tradeAllowed: null,
        tradeExpert: null,
        marginMode: parseOptionalNumber(liveRaw.margin_mode),
        currencyDigits: null,
        fifoClose: null,
        balance: parseFloat(liveRaw.balance),
        equity: parseFloat(liveRaw.equity),
        margin: parseFloat(liveRaw.margin),
        freeMargin: parseFloat(liveRaw.margin_free),
        marginLevel: parseFloat(liveRaw.margin_level),
        profit: parseFloat(liveRaw.profit),
        credit: parseFloat(liveRaw.credit ?? "0"),
        currency: liveRaw.currency,
        marginSoCall: null,
        marginSoSo: null,
        marginInitial: null,
        marginMaintenance: null,
        commissionBlocked: null,
        terminalCommunityAccount: null,
        terminalCommunityConnection: null,
        // bridge_v2 doesn't publish a terminal-connected flag — derive it
        // from heartbeat recency instead, same signal the `stale` field uses.
        terminalConnected: heartbeatFresh,
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
        ordersTotal: null,
        positionsTotal: parseOptionalNumber(heartbeat?.positions),
        historyOrdersTotal: null,
        historyDealsTotal: null,
        historyTotalsUpdatedAt: null,
        // bridge_v2's live hash carries no timestamp field of its own — the
        // heartbeat's lastSeen is the actual freshness signal for this account.
        timestamp: lastSeen,
      }
    : null;

  const allPositionsRaw: Mt5V2PositionRaw[] = posJson
    ? (JSON.parse(posJson) as Mt5V2PositionRaw[])
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
