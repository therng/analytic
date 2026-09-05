// Deterministic synthetic account source for the view-build contract test.
// Every input is pinned (fixed reportTime, fixed rows) so buildTimeframeView
// output is reproducible across machines and refactors.
import type {
  AccountPreaggregatedSource,
  DealRow,
  OpenPositionRow,
  OrderRow,
  PositionRow,
} from "@/lib/trading/preaggregated-cache";
import type { SerializedAccount } from "@/lib/trading/types";

export const CONTRACT_REPORT_TIME = new Date("2026-08-25T08:30:00.000Z");

const CONTRACT_ACCOUNT: SerializedAccount = {
  id: "contract-account-1",
  account_number: "1000123",
  owner_name: "Contract Fixture",
  currency: "USD",
  server: "FixtureServer-Trade",
  status: "Active",
  last_updated: new Date("2026-08-25T08:29:40.000Z"),
  today_growth_percent: 0.82,
  week_growth_percent: 2.4,
  today_net_profit: 164.2,
  today_net_pips: 164,
  today_trade_count: 4,
  open_position_count: 2,
  position_opened_recently: true,
  balance: 20164.2,
  equity: 20210.55,
  floating_pl: 46.35,
  margin: 812.4,
  margin_level: 2487.7,
  deposit_load_source: "xauusd_filled_order_volume",
  deposit_load_pct: 4.1,
  deposit_load_margin_used: 826.7,
  xauusd_filled_lots: 2.2,
};

function tradeDeal(
  iso: string,
  symbol: string,
  direction: "in" | "out",
  profit: number,
  price: number,
  volume: number,
  comment: string,
  dealNo: string,
): DealRow {
  return {
    time: new Date(iso),
    type: "trade",
    direction,
    comment,
    symbol,
    volume,
    price,
    profit,
    commission: -0.62,
    swap: 0,
    fee: 0,
    dealNo,
    balanceAfter: null,
  };
}

function balanceDeal(
  iso: string,
  comment: string,
  profit: number,
  balanceAfter: number,
): DealRow {
  return {
    time: new Date(iso),
    type: "balance",
    direction: null,
    comment,
    symbol: null,
    volume: null,
    price: null,
    profit,
    commission: 0,
    swap: 0,
    fee: 0,
    dealNo: `b-${balanceAfter}`,
    balanceAfter,
  };
}

function closedPosition(
  openIso: string,
  closeIso: string,
  positionNo: string,
  symbol: string,
  type: "buy" | "sell",
  volume: number,
  openPrice: number,
  closePrice: number,
  profit: number,
  pips: number,
  mae: number,
  mfe: number,
  comment: string,
  magic: number | null,
): PositionRow {
  return {
    closeTime: new Date(closeIso),
    openTime: new Date(openIso),
    reportDate: new Date(closeIso),
    positionNo,
    symbol,
    type,
    volume,
    openPrice,
    closePrice,
    sl: 0,
    tp: 0,
    profit,
    swap: profit >= 0 ? -0.4 : 0.3,
    commission: -1.24,
    pips,
    mae,
    mfe,
    comment,
    magic,
  };
}

function openPosition(
  reportIso: string,
  symbol: string,
  profit: number,
): OpenPositionRow {
  return {
    positionNo: `op-${symbol}-1`,
    openTime: new Date(reportIso),
    symbol,
    type: "buy",
    volume: 0.5,
    price: 2000.5,
    sl: 1995,
    tp: 2010,
    marketPrice: 2001.25,
    swap: -0.2,
    profit,
    comment: null,
    magic: null,
    reportDate: new Date(reportIso),
    floatingProfit: profit,
    floating_profit: profit,
  };
}

export function buildContractSource(): AccountPreaggregatedSource {
  const deals: DealRow[] = [
    // Account funding history
    balanceDeal("2025-12-01T09:00:00.000Z", "deposit", 10000, 10000),
    balanceDeal("2026-04-02T10:15:00.000Z", "withdraw", -3000, 14000),
    balanceDeal("2026-04-02T10:15:01.000Z", "deposit", 5000, 19000),
    balanceDeal("2026-07-14T06:30:00.000Z", "credit bonus", 250, 19250),

    // Last-month window trades (scoped by "1m")
    tradeDeal("2026-07-25T01:00:00.000Z", "XAUUSD", "in", 0, 2380.5, 0.5, "Axonshift-N Buy", "t-0725-in"),
    tradeDeal("2026-07-25T05:00:00.000Z", "XAUUSD", "out", 120.5, 2382.9, 0.5, "close [tp 2382.9]", "t-0725-out"),
    tradeDeal("2026-07-28T09:30:00.000Z", "EURUSD", "in", 0, 1.0842, 1.0, "Nova-scalp Buy", "t-0728-in"),
    tradeDeal("2026-07-28T11:45:00.000Z", "EURUSD", "out", -45.2, 1.0831, 1.0, "close [sl 1.0831]", "t-0728-out"),

    // Last-week window trades (scoped by "1w", outside "1d")
    tradeDeal("2026-08-21T02:10:00.000Z", "XAUUSD", "in", 0, 2410.2, 0.4, "Axonshift-N Buy", "t-0821-in"),
    tradeDeal("2026-08-21T06:40:00.000Z", "XAUUSD", "out", 88.4, 2414.8, 0.4, "close [tp 2414.8]", "t-0821-out"),
    tradeDeal("2026-08-22T13:00:00.000Z", "US30", "in", 0, 40210, 0.2, "Helios-grid Buy", "t-0822-in"),
    tradeDeal("2026-08-22T15:20:00.000Z", "US30", "out", -22.1, 40180, 0.2, "close", "t-0822-out"),

    // Today ("1d" window, Bangkok-day-aware)
    tradeDeal("2026-08-25T01:05:00.000Z", "XAUUSD", "in", 0, 2431.1, 0.3, "Axonshift-N Buy", "t-0825a-in"),
    tradeDeal("2026-08-25T03:22:00.000Z", "XAUUSD", "out", 64.3, 2435.4, 0.3, "close [tp 2435.4]", "t-0825a-out"),
    tradeDeal("2026-08-25T04:40:00.000Z", "EURUSD", "in", 0, 1.0905, 0.8, "Nova-scalp Sell", "t-0825b-in"),
    tradeDeal("2026-08-25T07:58:00.000Z", "EURUSD", "out", 99.9, 1.0892, 0.8, "close [sl 1.0892]", "t-0825b-out"),
  ];

  const positions: PositionRow[] = [
    closedPosition("2026-07-25T01:00:00.000Z", "2026-07-25T05:00:00.000Z", "p-0725", "XAUUSD", "buy", 0.5, 2380.5, 2382.9, 120.5, 24, -6.2, 31.5, "Axonshift-N", 880123),
    closedPosition("2026-07-28T09:30:00.000Z", "2026-07-28T11:45:00.000Z", "p-0728", "EURUSD", "buy", 1.0, 1.0842, 1.0831, -45.2, -11, 14.8, 6.0, "Nova-scalp", 771001),
    closedPosition("2026-08-21T02:10:00.000Z", "2026-08-21T06:40:00.000Z", "p-0821", "XAUUSD", "buy", 0.4, 2410.2, 2414.8, 88.4, 46, -3.1, 52.2, "Axonshift-N", 880123),
    closedPosition("2026-08-22T13:00:00.000Z", "2026-08-22T15:20:00.000Z", "p-0822", "US30", "buy", 0.2, 40210, 40180, -22.1, -30, 45.0, 12.4, "Helios-grid", 660222),
    closedPosition("2026-08-25T01:05:00.000Z", "2026-08-25T03:22:00.000Z", "p-0825a", "XAUUSD", "buy", 0.3, 2431.1, 2435.4, 64.3, 43, -2.5, 48.6, "Axonshift-N", 880123),
    closedPosition("2026-08-25T04:40:00.000Z", "2026-08-25T07:58:00.000Z", "p-0825b", "EURUSD", "sell", 0.8, 1.0905, 1.0892, 99.9, 104, -18.9, 22.0, "Nova-scalp", 771001),
    closedPosition("2026-05-11T08:00:00.000Z", "2026-05-11T16:30:00.000Z", "p-0511", "XAUUSD", "sell", 0.6, 2322.0, 2311.4, 254.8, 176, -20.4, 188.0, "Axonshift-N", 880123),
    closedPosition("2026-03-03T12:00:00.000Z", "2026-03-04T09:10:00.000Z", "p-0303", "EURUSD", "buy", 1.2, 1.0712, 1.0698, -320.4, -140, 165.0, 18.0, "manual", null),
  ];

  const orders: OrderRow[] = [
    { orderTicket: "o-1", positionId: "p-0825a", symbol: "XAUUSD", sl: 2428.9, tp: 2435.4 },
    { orderTicket: "o-2", positionId: "p-0825b", symbol: "EURUSD", sl: 1.0892, tp: 1.0930 },
    { orderTicket: "o-3", positionId: "p-0821", symbol: "XAUUSD", sl: 0, tp: 0 },
    { orderTicket: "o-4", positionId: "p-0728", symbol: "EURUSD", sl: 1.0831, tp: 1.0870 },
    { orderTicket: "o-5", positionId: "p-0303", symbol: "EURUSD", sl: 1.0698, tp: 1.0760 },
  ];

  const openPositions: OpenPositionRow[] = [
    openPosition("2026-08-25T08:29:00.000Z", "XAUUSD", 31.2),
    openPosition("2026-08-25T08:29:00.000Z", "US30", -8.4),
    openPosition("2026-08-25T08:29:00.000Z", "EURUSD", 23.55),
  ];

  const equitySnapshots = Array.from({ length: 20 }, (_, index) => ({
    ts: new Date(CONTRACT_REPORT_TIME.getTime() - (19 - index) * 60_000),
    equity: 20180 + index * 1.5,
    margin: 810 + (index % 3),
    depositLoad: index === 12 ? 41.2 : 3.5 + (index % 4) * 0.3,
    maxDepositLoad: 41.2,
  }));

  return {
    account: CONTRACT_ACCOUNT,
    deals,
    positions,
    orders,
    openPositions,
    equitySnapshots,
    latestSnapshotBalance: 20164.2,
    latestSnapshotEquity: 20210.55,
    latestSnapshotMargin: 812.4,
    reportTime: CONTRACT_REPORT_TIME,
    pipsSummaryRows: [],
    monthlyGrowthSeries: [],
    accountReportResult: {
      // Plain number cast: the production type carries Prisma.Decimal, but the
      // view builder only ever reads Number(...) off it — the fixture pins the
      // numeric value without importing the Prisma runtime.
      totalNetProfit: 6247.8 as unknown as AccountPreaggregatedSource["accountReportResult"] extends null
        ? never
        : NonNullable<AccountPreaggregatedSource["accountReportResult"]>["totalNetProfit"],
      sourceReportDate: new Date("2026-08-25T08:00:00.000Z"),
    },
  };
}

/** Canonical JSON: Dates as ISO, non-finite numbers as strings, keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner instanceof Date) return inner.toISOString();
    if (typeof inner === "number" && !Number.isFinite(inner)) {
      return inner > 0 ? "Infinity" : inner < 0 ? "-Infinity" : "NaN";
    }
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.keys(inner as Record<string, unknown>)
          .sort()
          .map((key) => [key, (inner as Record<string, unknown>)[key]]),
      );
    }
    return inner;
  });
}
