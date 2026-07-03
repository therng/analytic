import { getRedisSocialClient } from "@/lib/redis-social";

export interface Mt5LiveInfo {
  login: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  profit: number;
  credit: number;
  currency: string;
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
}

export async function getMt5LiveData(accountNo: string): Promise<Mt5LiveData> {
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
        balance: parseFloat(liveRaw.balance),
        equity: parseFloat(liveRaw.equity),
        margin: parseFloat(liveRaw.margin),
        freeMargin: parseFloat(liveRaw.freeMargin),
        marginLevel: parseFloat(liveRaw.marginLevel),
        profit: parseFloat(liveRaw.profit),
        credit: parseFloat(liveRaw.credit ?? "0"),
        currency: liveRaw.currency,
        timestamp: Number.isFinite(parseFloat(liveRaw.timestamp ?? "NaN"))
          ? parseFloat(liveRaw.timestamp)
          : null,
      }
    : null;

  const positions: Mt5Position[] = posJson ? (JSON.parse(posJson) as Mt5Position[]) : [];

  return { live, positions, stale };
}
