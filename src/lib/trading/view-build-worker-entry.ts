// Worker-thread entry for timeframe view builds. Loaded as a plain CJS
// bundle (dist/view-build-worker.js, built by esbuild — see the
// build:view-worker npm script). The heavy synchronous build
// (buildTimeframeView: seconds of CPU per view on large accounts) runs
// here so the web event loop never freezes.
//
// Protocol (JSON-string RPC — load-bearing, see view-build-worker.ts):
//   req:  { id, sourceJson, timeframes }
//   resp: { id, viewsJson: Record<timeframe, string> }
// One source transfer amortizes serialization across N timeframe builds.
// Prisma.Decimal cannot cross postMessage (structuredClone DataCloneError),
// but has toJSON — so everything moves as JSON strings.
import { parentPort } from "node:worker_threads";
import { buildTimeframeView } from "./preaggregated-cache";
import type { Timeframe } from "@/lib/trading/types";

type BuildRequest = {
  id: number;
  sourceJson: string;
  timeframes: Timeframe[];
};

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

parentPort?.on("message", (request: BuildRequest) => {
  try {
    const source = reviveDates(JSON.parse(request.sourceJson));
    const viewsJson: Record<string, string> = {};
    for (const timeframe of request.timeframes) {
      viewsJson[timeframe] = JSON.stringify(
        buildTimeframeView({ ...source, timeframe }),
      );
    }
    parentPort?.postMessage({ id: request.id, viewsJson });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
