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
//   req:  { id, patch: { fromSourceId, toSourceId,   // equity-only re-key: the
//       equitySnapshots } }                          // session moves to a new
//                                                    // sourceId with patched
//                                                    // snapshots, KEEPING the
//                                                    // parsed source and the
//                                                    // timeframe-invariant
//                                                    // precompute (equity never
//                                                    // feeds it)
//   resp: { id, views: Record<timeframe, view> }     // postMessage structured
//                                                    // clone — plain data and
//                                                    // Dates cross natively
//   resp: { id, patched: boolean }                   // patch acknowledgement
// The parsed source is retained per sourceId (small LRU), so one transfer
// amortizes serialization across every timeframe build of that version.
// Prisma.Decimal cannot cross postMessage (structuredClone DataCloneError),
// but has toJSON — so the source still moves as a JSON string. Equity rows
// are plain {ts,equity,margin,...} objects — they structured-clone natively,
// so an equity tick never re-pays the multi-MB JSON round trip.
import { parentPort } from "node:worker_threads";
import { buildTimeframeView } from "./preaggregated-cache";
import {
  buildTimeframePrecomputed,
  type TimeframeInvariantPrecomputed,
} from "@/lib/trading/view-precompute";
import type { Timeframe } from "@/lib/trading/types";

type BuildRequest =
  | {
      id: number;
      timeframes: Timeframe[];
    } & ({ sourceId: string; sourceJson: string } | { sourceId: string } | { sourceJson: string })
  | {
      id: number;
      patch: {
        fromSourceId: string;
        toSourceId: string;
        equitySnapshots: unknown[];
      };
    };

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
    if ("patch" in request) {
      const session = sources.get(request.patch.fromSourceId);
      if (!session) {
        // Evicted (or worker respawned) — caller falls back to a full
        // source send on its next build.
        parentPort?.postMessage({ id: request.id, patched: false });
        return;
      }
      (session.source as { equitySnapshots?: unknown[] }).equitySnapshots =
        request.patch.equitySnapshots;
      // Re-key the session under the new sourceId, KEEPING precomputed —
      // equity snapshots never feed the timeframe-invariant precompute.
      sources.delete(request.patch.fromSourceId);
      sources.delete(request.patch.toSourceId);
      sources.set(request.patch.toSourceId, session);
      while (sources.size > SOURCE_CACHE_MAX_ENTRIES) {
        const oldest = sources.keys().next().value;
        if (oldest === undefined) break;
        sources.delete(oldest);
      }
      parentPort?.postMessage({ id: request.id, patched: true });
      return;
    }

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
