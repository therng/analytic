import { prisma } from "../lib/prisma";
import {
  getMt5LiveData,
  type Mt5LiveInfo,
  type Mt5Position,
} from "../lib/redis-mt5";
import { computeDepositLoadPercent } from "../lib/trading/analytics";
import { ensureBridgeAccounts } from "./bridge-accounts";
import { abortableDelay } from "./background-loop";

export const DEFAULT_EQUITY_SAMPLE_MS = 60_000;
export const DEFAULT_EQUITY_RETENTION_DAYS = 7;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

type EquitySamplerDb = {
  tradingAccount: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      accountNo: string;
    }>>;
    upsert(args: unknown): Promise<{ id: string; accountNo: string }>;
  };
  equitySnapshot: {
    aggregate(args: unknown): Promise<{
      _max: { equity: unknown; maxDepositLoad: unknown };
    }>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  positionExcursion: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  position: {
    findMany(args: unknown): Promise<Array<{
      tradingAccountId: string;
      positionNo: string;
    }>>;
  };
};

export type EquitySampleStats = {
  sampled: number;
  skipped: number;
  failed: number;
};

export function equitySampleIntervalMs(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): number {
  const raw = env.WORKER_V2_EQUITY_SAMPLE_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_EQUITY_SAMPLE_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("WORKER_V2_EQUITY_SAMPLE_MS must be a positive integer");
  }
  return value;
}

export function equityRetentionDays(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): number {
  const raw = env.WORKER_V2_EQUITY_RETENTION_DAYS;
  if (raw == null || raw.trim() === "") return DEFAULT_EQUITY_RETENTION_DAYS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("WORKER_V2_EQUITY_RETENTION_DAYS must be a positive integer");
  }
  return value;
}

export function truncateToMinute(date: Date): Date {
  const truncated = new Date(date);
  // Date setters without the UTC prefix use the host timezone, while sampled
  // timestamps are canonical UTC.
  truncated.setUTCSeconds(0, 0);
  return truncated;
}

export function buildEquitySnapshotRow(
  tradingAccountId: string,
  ts: Date,
  live: Mt5LiveInfo,
  priorPeakEquity: number | null = null,
  priorMaxDepositLoad: number | null = null,
) {
  const peakEquity =
    priorPeakEquity == null
      ? live.equity
      : Math.max(priorPeakEquity, live.equity);
  const depositLoad = computeDepositLoadPercent(live);

  return {
    tradingAccountId,
    ts,
    equity: live.equity,
    margin: live.margin,
    balance: live.balance,
    floatingPl: live.profit,
    peakEquity,
    drawdown: Math.max(0, peakEquity - live.equity),
    depositLoad,
    maxDepositLoad:
      depositLoad == null
        ? priorMaxDepositLoad
        : priorMaxDepositLoad == null
          ? depositLoad
          : Math.max(priorMaxDepositLoad, depositLoad),
  };
}

export function buildPositionExcursionRows(
  tradingAccountId: string,
  ts: Date,
  positions: Mt5Position[],
) {
  return positions.map((position) => ({
    tradingAccountId,
    positionTicket: String(position.ticket),
    ts,
    profit: position.profit,
  }));
}

// The old bridge used to publish a running peak to
// `mt5:account:<no>:equity-state`; nothing writes that key anymore (dead,
// repo-wide grep confirms no writer), so it would freeze forever. Derive the
// peak from EquitySnapshot history instead — durable, self-correcting, and
// consistent with the project's PostgreSQL-is-authoritative convention.
async function getPriorEquityMetrics(
  db: EquitySamplerDb,
  tradingAccountId: string,
) {
  // Retention bounds both running maxima: a sampling gap longer than
  // RETENTION_DAYS starts a new retained-history run.
  const result = await db.equitySnapshot.aggregate({
    where: { tradingAccountId },
    _max: { equity: true, maxDepositLoad: true },
  });
  return {
    peakEquity:
      result._max.equity == null ? null : Number(result._max.equity),
    maxDepositLoad:
      result._max.maxDepositLoad == null
        ? null
        : Number(result._max.maxDepositLoad),
  };
}

export async function sampleEquityOnce(
  deps: {
    db?: EquitySamplerDb;
    ensureAccounts?: () => Promise<unknown>;
    readLive?: typeof getMt5LiveData;
  } = {},
): Promise<EquitySampleStats> {
  const db = deps.db ?? (prisma as unknown as EquitySamplerDb);
  const ensureAccounts =
    deps.ensureAccounts ??
    (() => ensureBridgeAccounts({ db }));
  const readLive = deps.readLive ?? getMt5LiveData;

  await ensureAccounts();

  const accounts = await db.tradingAccount.findMany({
    select: { id: true, accountNo: true },
  });

  const stats: EquitySampleStats = { sampled: 0, skipped: 0, failed: 0 };

  for (const account of accounts) {
    try {
      const data = await readLive(account.accountNo);
      const heartbeatSeconds = data.live?.timestamp;
      if (
        !data.live ||
        data.stale ||
        heartbeatSeconds == null ||
        !Number.isFinite(heartbeatSeconds)
      ) {
        stats.skipped += 1;
        continue;
      }
      const ts = truncateToMinute(new Date(heartbeatSeconds * 1000));
      const prior = await getPriorEquityMetrics(db, account.id);
      const snapshotRow = buildEquitySnapshotRow(
        account.id,
        ts,
        data.live,
        prior.peakEquity,
        prior.maxDepositLoad,
      );
      await db.equitySnapshot.upsert({
        where: { tradingAccountId_ts: { tradingAccountId: account.id, ts } },
        create: snapshotRow,
        update: snapshotRow,
      });

      for (const row of buildPositionExcursionRows(
        account.id,
        ts,
        data.positions,
      )) {
        await db.positionExcursion.upsert({
          where: {
            tradingAccountId_positionTicket_ts: {
              tradingAccountId: row.tradingAccountId,
              positionTicket: row.positionTicket,
              ts: row.ts,
            },
          },
          create: row,
          update: row,
        });
      }

      stats.sampled += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(
        `[equity-sampler] Failed to sample account ${account.accountNo}:`,
        error,
      );
    }
  }
  return stats;
}

export async function pruneOldSnapshots(
  retentionDays = DEFAULT_EQUITY_RETENTION_DAYS,
  db: EquitySamplerDb = prisma as unknown as EquitySamplerDb,
) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await db.equitySnapshot.deleteMany({ where: { ts: { lt: cutoff } } });

  const closed = await db.position.findMany({
    where: { closeTime: { lt: cutoff } },
    select: { tradingAccountId: true, positionNo: true },
  });
  if (closed.length === 0) return;

  await db.positionExcursion.deleteMany({
    where: {
      OR: closed.map((position) => ({
        tradingAccountId: position.tradingAccountId,
        positionTicket: position.positionNo,
      })),
    },
  });
}

export async function runEquitySamplerLoop(opts: {
  intervalMs: number;
  retentionDays: number;
  signal: AbortSignal;
  onCycle?: (stats: EquitySampleStats) => void;
  db?: EquitySamplerDb;
  ensureAccounts?: () => Promise<unknown>;
  readLive?: typeof getMt5LiveData;
}): Promise<void> {
  let nextPruneAt = Date.now() + PRUNE_INTERVAL_MS;
  while (!opts.signal.aborted) {
    try {
      const stats = await sampleEquityOnce({
        db: opts.db,
        ensureAccounts: opts.ensureAccounts,
        readLive: opts.readLive,
      });
      opts.onCycle?.(stats);
    } catch (error) {
      console.error("[equity-sampler] sample pass failed:", error);
      opts.onCycle?.({ sampled: 0, skipped: 0, failed: 1 });
    }

    if (Date.now() >= nextPruneAt) {
      try {
        await pruneOldSnapshots(
          opts.retentionDays,
          opts.db ?? (prisma as unknown as EquitySamplerDb),
        );
      } catch (error) {
        console.error("[equity-sampler] prune pass failed:", error);
      }
      nextPruneAt = Date.now() + PRUNE_INTERVAL_MS;
    }
    await abortableDelay(opts.intervalMs, opts.signal);
  }
}
