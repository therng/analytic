import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmptyPre2025Window,
  needsAutomaticHistoryRecovery,
  recoverInitialHistoryState,
} from "./history-recovery";
import { parseArgs } from "../../scripts/reset-history";

const START = 1735689600n;

function checkpoint(overrides: Record<string, unknown> = {}) {
  return {
    tradingAccountId: "account-1",
    phase: "backfill",
    coverageStartServerTime: START,
    completedThroughServerTime: START,
    dealsCursorTime: START,
    dealsCursorTicket: 0n,
    ordersCursorTime: START,
    ordersCursorTicket: 0n,
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
    ...overrides,
  };
}

function fixture(existing: any, chunks = 0) {
  let stored = existing;
  let chunkDeletes = 0;
  const prisma: any = {
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback(prisma),
    bridgeHistoryCheckpoint: {
      findUnique: async () => stored,
      update: async ({ data }: any) => {
        stored = { ...stored, ...data };
        return stored;
      },
      create: async ({ data }: any) => {
        stored = data;
        return stored;
      },
    },
    bridgeHistoryChunk: {
      count: async () => chunks,
      deleteMany: async () => {
        chunkDeletes += 1;
      },
    },
  };
  const streams = new Map<string, Array<{ id: string; message: Record<string, string> }>>([
    [
      "mt5:v2:history:deals",
      [
        { id: "1-0", message: { data: JSON.stringify({ login: 1001 }) } },
        { id: "2-0", message: { data: JSON.stringify({ login: 2002 }) } },
      ],
    ],
    [
      "mt5:v2:history:orders",
      [{ id: "3-0", message: { data: JSON.stringify({ login: 1001 }) } }],
    ],
  ]);
  const values = new Map<string, string>();
  const acked: string[] = [];
  const redis: any = {
    xRange: async (stream: string) => streams.get(stream) ?? [],
    xAck: async (_stream: string, _group: string, ids: string[]) => {
      acked.push(...ids);
      return ids.length;
    },
    xDel: async (stream: string, ids: string[]) => {
      const before = streams.get(stream) ?? [];
      streams.set(
        stream,
        before.filter((entry) => !ids.includes(entry.id)),
      );
      return ids.length;
    },
    del: async (key: string) => values.delete(key),
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
  return {
    prisma,
    redis,
    streams,
    values,
    acked,
    getStored: () => stored,
    getChunkDeletes: () => chunkDeletes,
  };
}

const account = {
  id: "account-1",
  accountNo: "1001",
} as any;

function recoveryAccount(row: any, chunks = 0) {
  return {
    ...account,
    bridgeHistoryCheckpoint: row,
    _count: { bridgeHistoryChunks: chunks },
  };
}

test("automatic recovery recognizes missing, legacy, and partial initial state", () => {
  assert.equal(needsAutomaticHistoryRecovery(null), true);
  assert.equal(
    needsAutomaticHistoryRecovery(
      checkpoint({ completedThroughServerTime: 946684800n }),
    ),
    true,
  );
  assert.equal(needsAutomaticHistoryRecovery(checkpoint()), true);
  assert.equal(
    needsAutomaticHistoryRecovery(
      checkpoint({
        completedThroughServerTime: START + 1n,
        lastCompletedChunkId: "chunk-1",
      }),
    ),
    false,
  );
});

test("guarded manual recovery only allows empty pre-2025 windows", () => {
  const legacy = checkpoint({ completedThroughServerTime: 946684800n });
  assert.equal(isEmptyPre2025Window(recoveryAccount(legacy)), true);
  assert.equal(isEmptyPre2025Window(recoveryAccount(legacy, 1)), false);
  assert.equal(
    isEmptyPre2025Window(
      recoveryAccount(
        checkpoint({
          completedThroughServerTime: START + 1n,
          lastCompletedChunkId: "chunk-1",
        }),
      ),
    ),
    false,
  );
});

test("automatic recovery resets Postgres and purges only the affected login", async () => {
  const f = fixture(checkpoint({ completedThroughServerTime: 946684800n }));

  const repaired = await recoverInitialHistoryState(
    f.prisma,
    f.redis,
    [account],
  );

  assert.equal(repaired, 1);
  assert.equal(f.getChunkDeletes(), 1);
  assert.equal(f.getStored().completedThroughServerTime, START);
  assert.deepEqual(f.acked.sort(), ["1-0", "3-0"]);
  assert.deepEqual(
    f.streams.get("mt5:v2:history:deals")?.map((entry) => entry.id),
    ["2-0"],
  );
  const ack = JSON.parse(
    f.values.get("mt5:v2:history:1001:ack") ?? "{}",
  );
  assert.equal(ack.completedThroughServerTime, String(START));
});

test("automatic recovery leaves an advanced checkpoint and Redis untouched", async () => {
  const f = fixture(
    checkpoint({
      phase: "incremental",
      completedThroughServerTime: START + 1n,
      lastCompletedChunkId: "chunk-1",
      backfillCompletedAt: new Date(),
    }),
  );

  const repaired = await recoverInitialHistoryState(
    f.prisma,
    f.redis,
    [account],
  );

  assert.equal(repaired, 0);
  assert.equal(f.getChunkDeletes(), 0);
  assert.equal(f.acked.length, 0);
});

test("forced recovery refuses an advanced checkpoint for the manual CLI", async () => {
  const f = fixture(
    checkpoint({
      phase: "incremental",
      completedThroughServerTime: START + 1n,
      lastCompletedChunkId: "chunk-1",
      backfillCompletedAt: new Date(),
    }),
  );

  await assert.rejects(
    () =>
      recoverInitialHistoryState(
        f.prisma,
        f.redis,
        [recoveryAccount(f.getStored())],
        { force: true, clearWatermark: true },
      ),
    /not an empty pre-2025 window/,
  );
  assert.equal(f.getStored().completedThroughServerTime, START + 1n);
});

test("history reset CLI defaults to preview and deduplicates account filters", () => {
  assert.deepEqual(parseArgs([]), {
    accountNos: [],
    confirmed: false,
    help: false,
  });
  assert.deepEqual(
    parseArgs([
      "--account",
      "1001",
      "--account",
      "1001",
      "--confirm",
      "RESET_HISTORY",
    ]),
    {
      accountNos: ["1001"],
      confirmed: true,
      help: false,
    },
  );
  assert.throws(
    () => parseArgs(["--confirm", "yes"]),
    /must be exactly RESET_HISTORY/,
  );
});
