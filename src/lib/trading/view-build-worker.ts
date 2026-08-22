// Main-side client for the view-build worker thread. Lazily spawns ONE
// worker (cwd-absolute path so it works both in dev and in the Next.js
// standalone layout — standalone server.js chdirs into .next/standalone
// and scripts/sync-standalone.mjs copies the esbuild bundle to
// dist/view-build-worker.js inside it).
//
// If the bundle is missing or the thread fails, callers fall back to the
// inline synchronous build (see preaggregated-cache.ts), so deploys and
// fresh clones stay safe.
import { Worker } from "node:worker_threads";
import path from "node:path";
import { buildTimeframeView } from "./preaggregated-cache";
import type { Timeframe } from "@/lib/trading/types";
import type { CachedTimeframeViews } from "./preaggregated-cache";

type BuildResponse =
  | { id: number; viewsJson: Record<string, string> }
  | { id: number; error: string };

let worker: Worker | null = null;
let workerBroken = false;
let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve: (views: Record<Timeframe, CachedTimeframeViews>) => void;
    reject: (error: Error) => void;
  }
>();

function getWorkerPath() {
  return path.join(process.cwd(), "dist", "view-build-worker.js");
}

function getOrCreateWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(getWorkerPath(), {
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    worker.on("message", (response: BuildResponse) => {
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      if ("error" in response) {
        entry.reject(new Error(`view-build-worker: ${response.error}`));
        return;
      }
      const views = Object.fromEntries(
        Object.entries(response.viewsJson).map(([tf, json]) => [
          tf,
          JSON.parse(json),
        ]),
      ) as Record<Timeframe, CachedTimeframeViews>;
      entry.resolve(views);
    });
    worker.on("error", (error) => {
      console.error(
        "[view-build-worker] thread error — falling back to inline builds:",
        error,
      );
      failAllPending(error);
      disableWorker();
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `[view-build-worker] exited with code ${code} — falling back to inline builds`,
        );
      }
      failAllPending(new Error("view-build-worker exited"));
      worker = null;
    });
    return worker;
  } catch (error) {
    // Bundle missing (dev without build:view-worker, or a tracing gap) —
    // fall back permanently for this process.
    console.error(
      "[view-build-worker] unavailable, using inline builds:",
      error instanceof Error ? error.message : error,
    );
    disableWorker();
    return null;
  }
}

function failAllPending(error: Error) {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function disableWorker() {
  workerBroken = true;
  worker = null;
}

/**
 * Build one or more timeframe views for the same source. Uses the worker
 * thread when available; otherwise builds inline (synchronous, on the
 * event loop — the pre-worker behavior). One source transfer covers all
 * requested timeframes.
 */
export async function buildTimeframeViews(
  source: Parameters<typeof buildTimeframeView>[0] extends infer S & {
    timeframe: Timeframe;
  }
    ? Omit<S, "timeframe">
    : never,
  timeframes: Timeframe[],
): Promise<Record<Timeframe, CachedTimeframeViews>> {
  const activeWorker = getOrCreateWorker();
  if (!activeWorker) {
    const views = {} as Record<Timeframe, CachedTimeframeViews>;
    for (const timeframe of timeframes) {
      views[timeframe] = buildTimeframeView({ ...source, timeframe });
    }
    return views;
  }

  const id = nextRequestId++;
  const request = { id, sourceJson: JSON.stringify(source), timeframes };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage(request);
  });
}
