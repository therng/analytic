import { getRedisSocialClient } from "@/lib/redis-social";

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

const DEFAULT_LIVE_POSITION_LIMIT = 100;
const MAX_LIVE_POSITION_LIMIT = 250;

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

function parseOptionalBoolean(value: string | null | undefined) {
  if (value == null || value === "") {
    return null;
  }

  const normalized = value.toLowerCase().trim();
  if (normalized === "true" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return null;
}

function clampLivePositionLimit(limit: number | null | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIVE_POSITION_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIVE_POSITION_LIMIT, Math.trunc(Number(limit))));
}

export async function getMt5LiveData(
  accountNo: string,
  options: { positionLimit?: number | null } = {},
): Promise<Mt5LiveData> {
  const r = await getRedisSocialClient();
  const keyLive = `mt5:account:${accountNo}:live`;
  const keyPos = `mt5:account:${accountNo}:positions`;

  const [liveRaw, posJson] = await Promise.all([
    r.hGetAll(keyLive),
    r.get(keyPos),
  ]);

  const hasLive = liveRaw && Object.keys(liveRaw).length > 0;
  const stale = !posJson;

  const live: Mt5LiveInfo | null = hasLive
    ? {
        login: liveRaw.login,
        name: parseOptionalText(liveRaw.name),
        server: parseOptionalText(liveRaw.server),
        company: parseOptionalText(liveRaw.company),
        leverage: parseOptionalNumber(liveRaw.leverage),
        tradeMode: parseOptionalNumber(liveRaw.tradeMode),
        limitOrders: parseOptionalNumber(liveRaw.limitOrders),
        marginSoMode: parseOptionalNumber(liveRaw.marginSoMode),
        tradeAllowed: parseOptionalBoolean(liveRaw.tradeAllowed),
        tradeExpert: parseOptionalBoolean(liveRaw.tradeExpert),
        marginMode: parseOptionalNumber(liveRaw.marginMode),
        currencyDigits: parseOptionalNumber(liveRaw.currencyDigits),
        fifoClose: parseOptionalBoolean(liveRaw.fifoClose),
        balance: parseFloat(liveRaw.balance),
        equity: parseFloat(liveRaw.equity),
        margin: parseFloat(liveRaw.margin),
        freeMargin: parseFloat(liveRaw.freeMargin),
        marginLevel: parseFloat(liveRaw.marginLevel),
        profit: parseFloat(liveRaw.profit),
        credit: parseFloat(liveRaw.credit ?? "0"),
        currency: liveRaw.currency,
        marginSoCall: parseOptionalNumber(liveRaw.marginSoCall),
        marginSoSo: parseOptionalNumber(liveRaw.marginSoSo),
        marginInitial: parseOptionalNumber(liveRaw.marginInitial),
        marginMaintenance: parseOptionalNumber(liveRaw.marginMaintenance),
        commissionBlocked: parseOptionalNumber(liveRaw.commissionBlocked),
        terminalCommunityAccount: parseOptionalBoolean(liveRaw.terminalCommunityAccount),
        terminalCommunityConnection: parseOptionalBoolean(liveRaw.terminalCommunityConnection),
        terminalConnected: parseOptionalBoolean(liveRaw.terminalConnected),
        terminalTradeAllowed: parseOptionalBoolean(liveRaw.terminalTradeAllowed),
        terminalTradeapiDisabled: parseOptionalBoolean(liveRaw.terminalTradeapiDisabled),
        terminalFtpEnabled: parseOptionalBoolean(liveRaw.terminalFtpEnabled),
        terminalNotificationsEnabled: parseOptionalBoolean(liveRaw.terminalNotificationsEnabled),
        terminalBuild: parseOptionalNumber(liveRaw.terminalBuild),
        terminalMaxbars: parseOptionalNumber(liveRaw.terminalMaxbars),
        terminalPingLast: parseOptionalNumber(liveRaw.terminalPingLast),
        terminalName: parseOptionalText(liveRaw.terminalName),
        terminalPath: parseOptionalText(liveRaw.terminalPath),
        terminalDataPath: parseOptionalText(liveRaw.terminalDataPath),
        terminalCommondataPath: parseOptionalText(liveRaw.terminalCommondataPath),
        ordersTotal: parseOptionalNumber(liveRaw.ordersTotal),
        positionsTotal: parseOptionalNumber(liveRaw.positionsTotal),
        historyOrdersTotal: parseOptionalNumber(liveRaw.historyOrdersTotal),
        historyDealsTotal: parseOptionalNumber(liveRaw.historyDealsTotal),
        historyTotalsUpdatedAt: parseOptionalNumber(liveRaw.historyTotalsUpdatedAt),
        timestamp: Number.isFinite(parseFloat(liveRaw.timestamp ?? "NaN"))
          ? parseFloat(liveRaw.timestamp)
          : null,
      }
    : null;

  const allPositions: Mt5Position[] = posJson ? (JSON.parse(posJson) as Mt5Position[]) : [];
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
