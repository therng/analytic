import { getRedisSocialClient } from "@/lib/redis-social";

// L2 memoization of computed per-timeframe account views (the exact object
// returned to the API). Keyed by aggregateVersionKey AND equityVersionKey —
// timeframe views embed equity-derived fields (floatingPL, openPositions,
// the 1D balance curve), so the view itself is equity-sensitive, not just
// the aggregate. Folding both keys in means a hit is byte-identical to a
// live recompute (no divergence) and staleness is bounded by either key
// changing — including across process replicas, since each replica reads
// equityVersionKey fresh from the DB on every version probe rather than
// relying on any process-local state.
const REPORT_VIEW_CACHE_TTL_SECONDS = 300;
const REPORT_VIEW_CACHE_PREFIX = "report-view";
// A slow-but-reachable Redis must never make a request slower than skipping
// the cache outright — bound every call so a stalled read/write degrades to
// a miss/no-op instead of stalling the API route behind it.
const REPORT_VIEW_CACHE_IO_TIMEOUT_MS = 150;
// Accounts with very large closed-position history can produce a
// historyPositions payload of unbounded size; refuse to persist anything
// past this so one heavy account can't blow up Redis memory/network cost
// for every dashboard request. A skipped write just means that account
// falls back to live compute — never a correctness issue, only a cache
// miss.
const REPORT_VIEW_CACHE_MAX_VALUE_BYTES = 512 * 1024;

export type ReportViewCacheClient = {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
};

function buildReportViewCacheKey(
  accountId: string,
  timeframe: string,
  aggregateVersionKey: string,
  equityVersionKey: string,
) {
  return `${REPORT_VIEW_CACHE_PREFIX}:${accountId}:${timeframe}:${aggregateVersionKey}:${equityVersionKey}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[report-view-cache] ${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function getCachedTimeframeView<T>(
  accountId: string,
  timeframe: string,
  aggregateVersionKey: string,
  equityVersionKey: string,
  client: ReportViewCacheClient | Promise<ReportViewCacheClient> = getRedisSocialClient(),
): Promise<T | null> {
  try {
    const resolvedClient = await withTimeout(
      Promise.resolve(client),
      REPORT_VIEW_CACHE_IO_TIMEOUT_MS,
      "connect",
    );
    const raw = await withTimeout(
      resolvedClient.get(
        buildReportViewCacheKey(
          accountId,
          timeframe,
          aggregateVersionKey,
          equityVersionKey,
        ),
      ),
      REPORT_VIEW_CACHE_IO_TIMEOUT_MS,
      "read",
    );
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.error("[report-view-cache] read failed:", error);
    return null;
  }
}

export async function setCachedTimeframeView(
  accountId: string,
  timeframe: string,
  aggregateVersionKey: string,
  equityVersionKey: string,
  view: unknown,
  client: ReportViewCacheClient | Promise<ReportViewCacheClient> = getRedisSocialClient(),
): Promise<void> {
  try {
    const serialized = JSON.stringify(view);
    if (Buffer.byteLength(serialized, "utf8") > REPORT_VIEW_CACHE_MAX_VALUE_BYTES) {
      return;
    }

    const resolvedClient = await withTimeout(
      Promise.resolve(client),
      REPORT_VIEW_CACHE_IO_TIMEOUT_MS,
      "connect",
    );
    await withTimeout(
      resolvedClient.setEx(
        buildReportViewCacheKey(
          accountId,
          timeframe,
          aggregateVersionKey,
          equityVersionKey,
        ),
        REPORT_VIEW_CACHE_TTL_SECONDS,
        serialized,
      ),
      REPORT_VIEW_CACHE_IO_TIMEOUT_MS,
      "write",
    );
  } catch (error) {
    console.error("[report-view-cache] write failed:", error);
  }
}
