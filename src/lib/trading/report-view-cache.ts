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

export async function getCachedTimeframeView<T>(
  accountId: string,
  timeframe: string,
  aggregateVersionKey: string,
  equityVersionKey: string,
  client: ReportViewCacheClient | Promise<ReportViewCacheClient> = getRedisSocialClient(),
): Promise<T | null> {
  try {
    const resolvedClient = await client;
    const raw = await resolvedClient.get(
      buildReportViewCacheKey(
        accountId,
        timeframe,
        aggregateVersionKey,
        equityVersionKey,
      ),
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
    const resolvedClient = await client;
    await resolvedClient.setEx(
      buildReportViewCacheKey(
        accountId,
        timeframe,
        aggregateVersionKey,
        equityVersionKey,
      ),
      REPORT_VIEW_CACHE_TTL_SECONDS,
      JSON.stringify(view),
    );
  } catch (error) {
    console.error("[report-view-cache] write failed:", error);
  }
}
