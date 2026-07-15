import { createServer, type Server } from "node:http";

type StreamStats = { processed: number; failed: number };
type AccountStats = {
  lastDeal: string | null;
  lastOrder: string | null;
  lastLiveSync: string | null;
  lastPositionSync: string | null;
  openPositionCount: number | null;
};

export type WorkerV2Snapshot = {
  startedAt: string;
  streams: { deals: StreamStats; orders: StreamStats };
  accounts: Record<string, AccountStats>;
  dbLatencyMsLast: number | null;
};

export class WorkerV2Status {
  private startedAt = new Date().toISOString();
  private streams = {
    deals: { processed: 0, failed: 0 },
    orders: { processed: 0, failed: 0 },
  };
  private accounts = new Map<string, AccountStats>();
  private dbLatencyMsLast: number | null = null;

  private account(login: string): AccountStats {
    let entry = this.accounts.get(login);
    if (!entry) {
      entry = {
        lastDeal: null,
        lastOrder: null,
        lastLiveSync: null,
        lastPositionSync: null,
        openPositionCount: null,
      };
      this.accounts.set(login, entry);
    }
    return entry;
  }

  recordDealProcessed(login: string, redisId: string): void {
    this.streams.deals.processed += 1;
    this.account(login).lastDeal = redisId;
  }

  recordOrderProcessed(login: string, redisId: string): void {
    this.streams.orders.processed += 1;
    this.account(login).lastOrder = redisId;
  }

  recordFailure(
    kind: "deal" | "order" | "live" | "positions",
    login?: string,
    reason?: string,
  ): void {
    // Intentionally accept login/reason for future use; reference to avoid unused-var lint
    void login;
    void reason;
    if (kind === "deal") this.streams.deals.failed += 1;
    if (kind === "order") this.streams.orders.failed += 1;
  }

  recordLiveSync(login: string): void {
    this.account(login).lastLiveSync = new Date().toISOString();
  }

  recordPositionSync(login: string, count: number): void {
    const entry = this.account(login);
    entry.lastPositionSync = new Date().toISOString();
    entry.openPositionCount = count;
  }

  recordDbLatency(ms: number): void {
    this.dbLatencyMsLast = ms;
  }

  snapshot(): WorkerV2Snapshot {
    return {
      startedAt: this.startedAt,
      streams: {
        deals: { ...this.streams.deals },
        orders: { ...this.streams.orders },
      },
      accounts: Object.fromEntries(this.accounts),
      dbLatencyMsLast: this.dbLatencyMsLast,
    };
  }
}

export function startWorkerV2HealthServer(
  status: WorkerV2Status,
  port: number,
  host = "0.0.0.0",
): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(status.snapshot()));
  });
  server.listen(port, host);
  return server;
}
