import {
  buildEquitySnapshotRow,
  buildPositionExcursionRows,
  equityRetentionDays,
  equitySampleIntervalMs,
  pruneOldSnapshots,
  sampleEquityOnce,
  truncateToMinute,
} from "./equity-sampler";
import assert from "node:assert/strict";
import test from "node:test";

const liveMetadata = {
  name: "Owner",
  server: "Demo",
  company: "Broker",
  leverage: 500,
  tradeMode: 0,
  limitOrders: 200,
  marginSoMode: 0,
  tradeAllowed: true,
  tradeExpert: true,
  marginMode: 2,
  currencyDigits: 2,
  fifoClose: false,
  marginSoCall: 50,
  marginSoSo: 30,
  marginInitial: 0,
  marginMaintenance: 0,
  commissionBlocked: 0,
  terminalCommunityAccount: true,
  terminalCommunityConnection: true,
  terminalConnected: true,
  terminalTradeAllowed: false,
  terminalTradeapiDisabled: false,
  terminalFtpEnabled: false,
  terminalNotificationsEnabled: false,
  terminalBuild: 2366,
  terminalMaxbars: 5000,
  terminalPingLast: 77850,
  terminalName: "MetaTrader 5",
  terminalPath: "E:\\ProgramFiles\\MetaTrader 5",
  terminalDataPath: "E:\\ProgramFiles\\MetaTrader 5",
  terminalCommondataPath:
    "C:\\Users\\Rosh\\AppData\\Roaming\\MetaQuotes\\Terminal\\Common",
  ordersTotal: 0,
  positionsTotal: 1,
  historyOrdersTotal: 100,
  historyDealsTotal: 200,
  historyTotalsUpdatedAt: 1751000000,
};

test("truncateToMinute zeroes out seconds and milliseconds", () => {
  const input = new Date("2026-07-01T03:45:27.812Z");
  const result = truncateToMinute(input);
  assert.equal(result.toISOString(), "2026-07-01T03:45:00.000Z");
});

test("buildEquitySnapshotRow maps live data to a snapshot row", () => {
  const ts = new Date("2026-07-01T03:45:00.000Z");
  const row = buildEquitySnapshotRow("acct-1", ts, {
    login: "12345",
    ...liveMetadata,
    balance: 1000,
    equity: 1050,
    margin: 200,
    freeMargin: 850,
    marginLevel: 525,
    profit: 50,
    credit: 0,
    currency: "USD",
    timestamp: 1751000000,
  }, 1000, 15);
  assert.deepEqual(row, {
    tradingAccountId: "acct-1",
    ts,
    equity: 1050,
    margin: 200,
    balance: 1000,
    floatingPl: 50,
    peakEquity: 1050,
    drawdown: 0,
    depositLoad: (200 / 1050) * 100,
    maxDepositLoad: (200 / 1050) * 100,
  });
});

test("buildEquitySnapshotRow preserves the running max deposit load", () => {
  const row = buildEquitySnapshotRow(
    "acct-1",
    new Date("2026-07-01T03:45:00.000Z"),
    {
      login: "12345",
      ...liveMetadata,
      balance: 10_000,
      equity: 10_000,
      margin: 5_000,
      freeMargin: 5_000,
      marginLevel: 200,
      profit: 0,
      credit: 0,
      currency: "USD",
      timestamp: 1751000000,
    },
    12_000,
    40,
  );

  assert.equal(row.depositLoad, 50);
  assert.equal(row.maxDepositLoad, 50);
  assert.equal(row.peakEquity, 12_000);
  assert.equal(row.drawdown, 2_000);
});

test("buildEquitySnapshotRow keeps a prior max when deposit load is unavailable", () => {
  const row = buildEquitySnapshotRow(
    "acct-1",
    new Date("2026-07-01T03:45:00.000Z"),
    {
      login: "12345",
      ...liveMetadata,
      balance: 0,
      equity: 0,
      margin: 5_000,
      freeMargin: 0,
      marginLevel: 0,
      profit: 0,
      credit: 0,
      currency: "USD",
      timestamp: 1751000000,
    },
    0,
    40,
  );

  assert.equal(row.depositLoad, null);
  assert.equal(row.maxDepositLoad, 40);
});

test("buildPositionExcursionRows maps each open position to an excursion row", () => {
  const ts = new Date("2026-07-01T03:45:00.000Z");
  const rows = buildPositionExcursionRows("acct-1", ts, [
    {
      ticket: 111,
      symbol: "EURUSD",
      type: 0,
      volume: 0.1,
      openPrice: 1.1,
      currentPrice: 1.11,
      sl: 0,
      tp: 0,
      profit: 12.5,
      swap: 0,
      comment: "",
      openTime: 0,
    },
    {
      ticket: 222,
      symbol: "GBPUSD",
      type: 1,
      volume: 0.2,
      openPrice: 1.2,
      currentPrice: 1.19,
      sl: 0,
      tp: 0,
      profit: -8.25,
      swap: 0,
      comment: "",
      openTime: 0,
    },
  ]);
  assert.deepEqual(rows, [
    { tradingAccountId: "acct-1", positionTicket: "111", ts, profit: 12.5 },
    { tradingAccountId: "acct-1", positionTicket: "222", ts, profit: -8.25 },
  ]);
});

test("buildPositionExcursionRows returns an empty array for no open positions", () => {
  const ts = new Date("2026-07-01T03:45:00.000Z");
  assert.deepEqual(buildPositionExcursionRows("acct-1", ts, []), []);
});

test("sampler config uses safe defaults and rejects invalid values", () => {
  assert.equal(equitySampleIntervalMs({}), 60_000);
  assert.equal(equityRetentionDays({}), 7);
  assert.equal(
    equitySampleIntervalMs({ WORKER_V2_EQUITY_SAMPLE_MS: "120000" }),
    120_000,
  );
  assert.equal(
    equityRetentionDays({ WORKER_V2_EQUITY_RETENTION_DAYS: "14" }),
    14,
  );
  assert.throws(
    () => equitySampleIntervalMs({ WORKER_V2_EQUITY_SAMPLE_MS: "0" }),
    /positive integer/,
  );
});

function samplerDb() {
  const snapshots: any[] = [];
  const excursions: any[] = [];
  const deletedExcursions: any[] = [];
  return {
    snapshots,
    excursions,
    deletedExcursions,
    db: {
      tradingAccount: {
        findMany: async () => [{ id: "acct-1", accountNo: "12345" }],
        upsert: async () => ({ id: "acct-1", accountNo: "12345" }),
      },
      equitySnapshot: {
        aggregate: async () => ({
          _max: { equity: null, maxDepositLoad: null },
        }),
        upsert: async (args: any) => snapshots.push(args),
        deleteMany: async () => ({ count: 0 }),
      },
      positionExcursion: {
        upsert: async (args: any) => excursions.push(args),
        deleteMany: async (args: any) => deletedExcursions.push(args),
      },
      position: {
        findMany: async (): Promise<
          Array<{ tradingAccountId: string; positionNo: string }>
        > => [],
      },
    },
  };
}

const freshLive = {
  login: "12345",
  ...liveMetadata,
  balance: 1000,
  equity: 1050,
  margin: 200,
  freeMargin: 850,
  marginLevel: 525,
  profit: 50,
  credit: 0,
  currency: "USD",
  timestamp: Date.parse("2026-07-01T03:45:27Z") / 1000,
};

test("sampleEquityOnce uses the Redis heartbeat minute and writes fresh data", async () => {
  const fixture = samplerDb();
  const stats = await sampleEquityOnce({
    db: fixture.db,
    ensureAccounts: async () => [],
    readLive: async () => ({
      live: freshLive,
      positions: [],
      stale: false,
    }),
  });

  assert.deepEqual(stats, { sampled: 1, skipped: 0, failed: 0 });
  assert.equal(
    fixture.snapshots[0].create.ts.toISOString(),
    "2026-07-01T03:45:00.000Z",
  );
});

test("sampleEquityOnce skips stale live hashes without writing snapshots", async () => {
  const fixture = samplerDb();
  const stats = await sampleEquityOnce({
    db: fixture.db,
    ensureAccounts: async () => [],
    readLive: async () => ({
      live: freshLive,
      positions: [],
      stale: true,
    }),
  });

  assert.deepEqual(stats, { sampled: 0, skipped: 1, failed: 0 });
  assert.equal(fixture.snapshots.length, 0);
  assert.equal(fixture.excursions.length, 0);
});

test("pruning removes excursions only for positions durably closed before the cutoff", async () => {
  const fixture = samplerDb();
  fixture.db.position.findMany = async () => [
    { tradingAccountId: "acct-1", positionNo: "closed-1" },
  ];

  await pruneOldSnapshots(7, fixture.db);

  assert.deepEqual(fixture.deletedExcursions[0].where.OR, [
    { tradingAccountId: "acct-1", positionTicket: "closed-1" },
  ]);
});
