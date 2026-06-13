import { createServer, type Server } from "node:http";

export type ReportPassStats = {
  found: number;
  ready: number;
  deferred: number;
  imported: number;
  skipped: number;
  failed: number;
};

export type HealthStatus = "starting" | "ok" | "stale";

export type HealthSnapshot = {
  status: HealthStatus;
  healthy: boolean;
  uptimeMs: number;
  startedAt: string;
  lastPollStartedAt: string | null;
  lastPollFinishedAt: string | null;
  lastPollOk: boolean | null;
  pollCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastStats: ReportPassStats | null;
  staleAfterMs: number;
};

/**
 * Tracks liveness of the background import worker so an HTTP probe can report
 * whether the polling loop is still making progress. The worker is a long
 * running loop rather than a request/response server, so "healthy" means it
 * started a poll recently — within {@link staleAfterMs} of the last activity —
 * not that the most recent poll succeeded. A poll can legitimately fail (FTP
 * down, etc.) without the worker being unhealthy; that surfaces via
 * {@link consecutiveFailures} and {@link lastError} for observability.
 */
export class WorkerHeartbeat {
  private readonly startedAt: number;
  private readonly staleAfterMs: number;
  private lastPollStartedAt: number | null = null;
  private lastPollFinishedAt: number | null = null;
  private lastPollOk: boolean | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;
  private pollCount = 0;
  private lastStats: ReportPassStats | null = null;

  constructor(staleAfterMs: number, now: number = Date.now()) {
    this.staleAfterMs = staleAfterMs;
    this.startedAt = now;
  }

  markPollStart(now: number = Date.now()) {
    this.lastPollStartedAt = now;
  }

  markPollSuccess(stats: ReportPassStats | null, now: number = Date.now()) {
    this.lastPollFinishedAt = now;
    this.lastPollOk = true;
    this.lastError = null;
    this.consecutiveFailures = 0;
    this.pollCount += 1;
    this.lastStats = stats;
  }

  markPollFailure(error: unknown, now: number = Date.now()) {
    this.lastPollFinishedAt = now;
    this.lastPollOk = false;
    this.lastError = error instanceof Error ? error.message : String(error);
    this.consecutiveFailures += 1;
    this.pollCount += 1;
  }

  status(now: number = Date.now()): HealthStatus {
    // The most recent sign of life is whichever happened later: the start of an
    // in-flight poll, or the completion of the previous one.
    const lastActivity = Math.max(this.lastPollStartedAt ?? 0, this.lastPollFinishedAt ?? 0);

    if (lastActivity === 0) {
      // No poll has begun yet. Treat the startup window as healthy so the probe
      // does not flap before the first cycle runs.
      return now - this.startedAt <= this.staleAfterMs ? "starting" : "stale";
    }

    return now - lastActivity <= this.staleAfterMs ? "ok" : "stale";
  }

  snapshot(now: number = Date.now()): HealthSnapshot {
    const status = this.status(now);
    return {
      status,
      healthy: status !== "stale",
      uptimeMs: now - this.startedAt,
      startedAt: new Date(this.startedAt).toISOString(),
      lastPollStartedAt: this.lastPollStartedAt ? new Date(this.lastPollStartedAt).toISOString() : null,
      lastPollFinishedAt: this.lastPollFinishedAt ? new Date(this.lastPollFinishedAt).toISOString() : null,
      lastPollOk: this.lastPollOk,
      pollCount: this.pollCount,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastStats: this.lastStats,
      staleAfterMs: this.staleAfterMs,
    };
  }
}

/**
 * Exposes the heartbeat over HTTP. Responds 200 when healthy and 503 when the
 * polling loop has gone stale, so container orchestrators (Docker healthcheck,
 * Kubernetes liveness probes) can restart a wedged worker.
 */
export function startHealthServer(heartbeat: WorkerHeartbeat, port: number, host = "0.0.0.0"): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET" || !req.url || !["/health", "/healthz", "/"].includes(req.url.split("?")[0])) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const snapshot = heartbeat.snapshot();
    res.writeHead(snapshot.healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(snapshot));
  });

  server.listen(port, host, () => {
    console.log(`Worker health endpoint listening on http://${host}:${port}/health`);
  });

  server.on("error", (error) => {
    console.error("Worker health server error:", error);
  });

  return server;
}
