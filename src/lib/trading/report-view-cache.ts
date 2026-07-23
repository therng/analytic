import { getRedisSocialClient } from "@/lib/redis-social";

// L2 memoization of computed per-timeframe account views (the exact object
// returned to the API). Keyed by the same aggregateVersionKey the in-process
// cache already trusts, so a hit is byte-identical to a live recompute — no
// divergence, and staleness is bounded by that key changing. Never call this
// for a bundle whose equity was just patched (see preaggregated-cache.ts
// equityPatched flag) — the aggregateVersionKey does not change on an equity
// patch, so an L2 entry from before the patch would serve stale equity.
const REPORT_VIEW_CACHE_TTL_SECONDS = 300;
const REPORT_VIEW_CACHE_PREFIX = "report-view";

export type ReportViewCacheClient = {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
};

function buildReportViewCacheKey(
  accountId: string,
  timeframe: string,
  aggregateVersionKey: string,
) {
  return `${REPORT_VIEW_CACHE_PREFIX}:${accountId}:${timeframe}:${aggregateVersionKey}`;
}

export async function getCachedTimeframeView<T>(
  accountId: string,
  timeframe: string,
  aggregateVersionKey: string,
  client: ReportViewCacheClient | Promise<ReportViewCacheClient> = getRedisSocialClient(),
): Promise<T | null> {
  try {
    const resolvedClient = await client;
    const raw = await resolvedClient.get(
      buildReportViewCacheKey(accountId, timeframe, aggregateVersionKey),
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
  view: unknown,
  client: ReportViewCacheClient | Promise<ReportViewCacheClient> = getRedisSocialClient(),
): Promise<void> {
  try {
    const resolvedClient = await client;
    await resolvedClient.setEx(
      buildReportViewCacheKey(accountId, timeframe, aggregateVersionKey),
      REPORT_VIEW_CACHE_TTL_SECONDS,
      JSON.stringify(view),
    );
  } catch (error) {
    console.error("[report-view-cache] write failed:", error);
  }
}
