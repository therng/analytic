// Worker-thread entry for timeframe view builds. Loaded as a plain CJS
// bundle (dist/view-build-worker.js, built by esbuild — see the
// build:view-worker npm script). The heavy synchronous build
// (buildTimeframeView: seconds of CPU per view on large accounts) runs
// here so the web event loop never freezes.
//
// Protocol (JSON-string source, structured-clone views):
//   req:  { id, sourceId, sourceJson, timeframes }   // first build of a version
//   req:  { id, sourceId, timeframes }               // later builds reuse the
//                                                    // worker-cached source
//   resp: { id, views: Record<timeframe, view> }     // postMessage structured
//                                                    // clone — plain data and
//                                                    // Dates cross natively
// The parsed source is retained per sourceId (small LRU), so one transfer
// amortizes serialization across every timeframe build of that version.
// Prisma.Decimal cannot cross postMessage (structuredClone DataCloneError),
// but has toJSON — so the source still moves as a JSON string.
import { parentPort } from "node:worker_threads";
import { buildTimeframeView } from "./preaggregated-cache";
import {
  buildTimeframePrecomputed,
  type TimeframeInvariantPrecomputed,
} from "@/lib/trading/view-precompute";
import type { Timeframe } from "@/lib/trading/types";

type BuildRequest = {
  id: number;
  timeframes: Timeframe[];
} & (
  | { sourceId: string; sourceJson: string }
  | { sourceId: string }
  | { sourceJson: string }
);

const SOURCE_CACHE_MAX_ENTRIES = 8;
const sources = new Map<
  string,
  { source: unknown; precomputed: TimeframeInvariantPrecomputed | null }
>();

function reviveDates(source: any) {
  for (const snapshot of source.equitySnapshots ?? []) {
    if (typeof snapshot?.ts === "string") snapshot.ts = new Date(snapshot.ts);
  }
  if (typeof source.reportTime === "string") {
    source.reportTime = new Date(source.reportTime);
  }
  if (source.accountReportResult) {
    const reportDate = source.accountReportResult.sourceReportDate;
    if (typeof reportDate === "string") {
      source.accountReportResult.sourceReportDate = new Date(reportDate);
    }
  }
  return source;
}

function retainSource(sourceId: string, sourceJson: string) {
  sources.delete(sourceId);
  sources.set(sourceId, {
    source: reviveDates(JSON.parse(sourceJson)),
    precomputed: null,
  });
  while (sources.size > SOURCE_CACHE_MAX_ENTRIES) {
    const oldest = sources.keys().next().value;
    if (oldest === undefined) break;
    sources.delete(oldest);
  }
}

parentPort?.on("message", (request: BuildRequest) => {
  try {
    let source: unknown;
    let session: { source: unknown; precomputed: TimeframeInvariantPrecomputed | null };
    if ("sourceId" in request) {
      if ("sourceJson" in request) {
        retainSource(request.sourceId, request.sourceJson);
      }
      session = sources.get(request.sourceId)!;
      if (!session) {
        throw new Error(`unknown sourceId ${request.sourceId} — resend the source`);
      }
      source = session.source;
    } else {
      source = reviveDates(JSON.parse(request.sourceJson));
      session = { source, precomputed: null };
    }

    // Timeframe-invariant precompute runs once per source version and is
    // shared by every timeframe build of that version.
    session.precomputed ??= buildTimeframePrecomputed(
      source as Parameters<typeof buildTimeframePrecomputed>[0],
    );

    const views: Record<string, unknown> = {};
    for (const timeframe of request.timeframes) {
      views[timeframe] = buildTimeframeView({
        ...(source as Record<string, unknown>),
        timeframe,
        precomputed: session.precomputed,
      } as Parameters<typeof buildTimeframeView>[0]);
    }
    parentPort?.postMessage({ id: request.id, views });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
