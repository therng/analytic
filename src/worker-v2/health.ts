import { createServer, type Server } from "node:http";

type StreamStats = { processed: number; failed: number };
export type WorkerV2Component =
  | "deals"
  | "orders"
  | "live"
  | "equity"
  | "calendar";

export type ComponentHealth = {
  enabled: boolean;
  status: "disabled" | "starting" | "ok" | "stale";
  staleAfterMs: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
};
type AccountStats = {
  lastDeal: string | null;
  lastOrder: string | null;
  lastLiveSync: string | null;
  lastPositionSync: string | null;
  openPositionCount: number | null;
};

type QueueDepth = {
  streams: number;
  pendingTotal: number;
  lengthTotal: number;
  sampledAt: string | null;
};

export type WorkerV2Snapshot = {
  startedAt: string;
  status: "starting" | "ok" | "stale";
  healthy: boolean;
  streams: { deals: StreamStats; orders: StreamStats };
  accounts: Record<string, AccountStats>;
  components: Record<WorkerV2Component, ComponentHealth>;
  dbLatencyMsLast: number | null;
  // Redis backlog across all per-account native history streams
  // (mt5:account:{login}:stream:history) — sampled periodically by the
  // main loop via recordQueueDepth, not on every consume cycle, to avoid
  // adding XLEN/XPENDING overhead to the hot read path.
  queue: QueueDepth;
};

export class WorkerV2Status {
  private startedAtMs: number;
  private streams = {
    deals: { processed: 0, failed: 0 },
    orders: { processed: 0, failed: 0 },
  };
  private accounts = new Map<string, AccountStats>();
  private components = new Map<
    WorkerV2Component,
    {
      enabled: boolean;
      staleAfterMs: number;
      lastAttemptAt: number | null;
      lastSuccessAt: number | null;
      lastFailureAt: number | null;
      consecutiveFailures: number;
      lastError: string | null;
    }
  >();
  private dbLatencyMsLast: number | null = null;
  private queueDepth: QueueDepth = {
    streams: 0,
    pendingTotal: 0,
    lengthTotal: 0,
    sampledAt: null,
  };

  constructor(now: number = Date.now()) {
    this.startedAtMs = now;
    for (const name of [
      "deals",
      "orders",
      "live",
      "equity",
      "calendar",
    ] as const) {
      this.configureComponent(name, false, 60_000);
    }
  }

  configureComponent(
    name: WorkerV2Component,
    enabled: boolean,
    staleAfterMs: number,
  ): void {
    this.components.set(name, {
      enabled,
      staleAfterMs,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      lastError: null,
    });
  }

  recordComponentCycle(
    name: WorkerV2Component,
    error?: unknown,
    now: number = Date.now(),
  ): void {
    const component = this.components.get(name);
    if (!component || !component.enabled) return;
    component.lastAttemptAt = now;
    if (error == null) {
      component.lastSuccessAt = now;
      component.consecutiveFailures = 0;
      component.lastError = null;
      return;
    }
    component.lastFailureAt = now;
    component.consecutiveFailures += 1;
    component.lastError = error instanceof Error ? error.message : String(error);
  }

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

  recordQueueDepth(
    sample: { streams: number; pendingTotal: number; lengthTotal: number },
    now: number = Date.now(),
  ): void {
    this.queueDepth = { ...sample, sampledAt: new Date(now).toISOString() };
  }

  snapshot(now: number = Date.now()): WorkerV2Snapshot {
    const components = {} as Record<WorkerV2Component, ComponentHealth>;
    let hasStarting = false;
    let hasStale = false;
    for (const [name, component] of this.components) {
      let status: ComponentHealth["status"];
      if (!component.enabled) {
        status = "disabled";
      } else if (component.lastSuccessAt == null) {
        status =
          now - this.startedAtMs <= component.staleAfterMs
            ? "starting"
            : "stale";
      } else {
        status =
          now - component.lastSuccessAt <= component.staleAfterMs
            ? "ok"
            : "stale";
      }
      if (status === "starting") hasStarting = true;
      if (status === "stale") hasStale = true;
      components[name] = {
        enabled: component.enabled,
        status,
        staleAfterMs: component.staleAfterMs,
        lastAttemptAt: component.lastAttemptAt
          ? new Date(component.lastAttemptAt).toISOString()
          : null,
        lastSuccessAt: component.lastSuccessAt
          ? new Date(component.lastSuccessAt).toISOString()
          : null,
        lastFailureAt: component.lastFailureAt
          ? new Date(component.lastFailureAt).toISOString()
          : null,
        consecutiveFailures: component.consecutiveFailures,
        lastError: component.lastError,
      };
    }

    return {
      startedAt: new Date(this.startedAtMs).toISOString(),
      status: hasStale ? "stale" : hasStarting ? "starting" : "ok",
      healthy: !hasStale,
      streams: {
        deals: { ...this.streams.deals },
        orders: { ...this.streams.orders },
      },
      accounts: Object.fromEntries(this.accounts),
      components,
      dbLatencyMsLast: this.dbLatencyMsLast,
      queue: { ...this.queueDepth },
    };
  }
}

export function startWorkerV2HealthServer(
  status: WorkerV2Status,
  port: number,
  host = "0.0.0.0",
): Server {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method !== "GET" || !["/", "/health", "/healthz"].includes(path ?? "")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const snapshot = status.snapshot();
    res.writeHead(snapshot.healthy ? 200 : 503, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify(snapshot));
  });
  server.listen(port, host);
  return server;
}
