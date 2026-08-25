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
  | { id: number; views: Record<string, CachedTimeframeViews> }
  | { id: number; error: string }
  | { id: number; patched: boolean };

let worker: Worker | null = null;
let workerBroken = false;
// A one-off thread error (OOM on a huge build, transient crash) respawns the
// worker on the next build; only repeated consecutive failures fall back
// permanently to inline builds, so a single blip doesn't silently convert
// every view request into seconds of synchronous event-loop CPU.
let consecutiveWorkerErrors = 0;
const MAX_CONSECUTIVE_WORKER_ERRORS = 3;
let nextRequestId = 1;
const pending = new Map<
  number,
  {
    resolve: (views: Partial<Record<Timeframe, CachedTimeframeViews>>) => void;
    reject: (error: Error) => void;
  }
>();

// Equity-patch acknowledgements ride a separate pending map: their resolve
// takes a boolean, not views, so they must not share the build entry shape.
const patchPending = new Map<
  number,
  {
    fromSourceId: string;
    toSourceId: string;
    resolve: (patched: boolean) => void;
  }
>();

// Which source versions this worker instance has already received. The worker
// retains the parsed source per sourceId, so repeat builds for the same
// version transfer only {id, sourceId, timeframes} — the multi-MB
// JSON.stringify of the source is paid once per version, not per timeframe.
// Reset whenever the worker is (re)spawned: a fresh thread has empty state.
let sentSourceIds: Set<string> = new Set();

function getWorkerPath() {
  return path.join(process.cwd(), "dist", "view-build-worker.js");
}

function getOrCreateWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  sentSourceIds = new Set();
  try {
    worker = new Worker(getWorkerPath(), {
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    worker.on("message", (response: BuildResponse) => {
      consecutiveWorkerErrors = 0;
      if ("patched" in response) {
        const entry = patchPending.get(response.id);
        if (!entry) return;
        patchPending.delete(response.id);
        if (response.patched) {
          sentSourceIds.delete(entry.fromSourceId);
          sentSourceIds.add(entry.toSourceId);
        }
        entry.resolve(response.patched);
        return;
      }
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      if ("error" in response) {
        entry.reject(new Error(`view-build-worker: ${response.error}`));
        return;
      }
      entry.resolve(response.views as Partial<Record<Timeframe, CachedTimeframeViews>>);
    });
    worker.on("error", (error) => {
      consecutiveWorkerErrors += 1;
      const permanent = consecutiveWorkerErrors >= MAX_CONSECUTIVE_WORKER_ERRORS;
      console.error(
        `[view-build-worker] thread error (${consecutiveWorkerErrors}/${MAX_CONSECUTIVE_WORKER_ERRORS}) — ${
          permanent ? "falling back to inline builds permanently" : "respawning on next build"
        }:`,
        error,
      );
      failAllPending(error);
      if (permanent) {
        disableWorker();
      } else {
        worker = null;
      }
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
  // Patches are best-effort — failing them to false makes the caller's next
  // build send the full source, which is always safe.
  for (const entry of patchPending.values()) entry.resolve(false);
  patchPending.clear();
}

function disableWorker() {
  workerBroken = true;
  worker = null;
}

/**
 * Terminate the worker thread so the process can exit (a live Worker keeps
 * the event loop spinning). In-flight builds reject; the next
 * buildTimeframeViews call respawns the thread.
 */
export function shutdownViewBuildWorker() {
  const current = worker;
  worker = null;
  sentSourceIds = new Set();
  if (current) {
    void current.terminate();
  }
}

/**
 * Re-key a worker source session for an equity-only change: the session's
 * equitySnapshots are replaced in place and the session moves to the new
 * sourceId, keeping the parsed source AND the timeframe-invariant precompute
 * (equity never feeds it). This is what keeps a ~60s equity tick from
 * re-paying the multi-MB source JSON.stringify + worker re-parse + precompute
 * on every account, every minute.
 *
 * Resolves false when there is no worker or the from-session was evicted —
 * callers then simply let the next build send the full source (the
 * pre-protocol behavior), so this can never lose correctness.
 */
export function patchWorkerEquitySource(
  fromSourceId: string,
  toSourceId: string,
  equitySnapshots: unknown[],
): Promise<boolean> {
  const activeWorker = getOrCreateWorker();
  if (!activeWorker || workerBroken) return Promise.resolve(false);

  const id = nextRequestId++;
  return new Promise((resolve) => {
    patchPending.set(id, { fromSourceId, toSourceId, resolve });
    activeWorker.postMessage({
      id,
      patch: { fromSourceId, toSourceId, equitySnapshots },
    });
  });
}

/**
 * Build one or more timeframe views for the same source. Uses the worker
 * thread when available; otherwise builds inline (synchronous, on the
 * event loop — the pre-worker behavior). One source transfer covers all
 * requested timeframes; passing the same sourceId again skips the source
 * payload entirely (the worker caches it per version).
 */
export async function buildTimeframeViews(
  source: Parameters<typeof buildTimeframeView>[0] extends infer S & {
    timeframe: Timeframe;
  }
    ? Omit<S, "timeframe">
    : never,
  timeframes: Timeframe[],
  sourceId?: string,
): Promise<Partial<Record<Timeframe, CachedTimeframeViews>>> {
  const activeWorker = getOrCreateWorker();
  if (!activeWorker) {
    const views = {} as Record<Timeframe, CachedTimeframeViews>;
    for (const timeframe of timeframes) {
      views[timeframe] = buildTimeframeView({ ...source, timeframe });
    }
    return views;
  }

  try {
    return await postBuildRequest(activeWorker, source, timeframes, sourceId);
  } catch (error) {
    // The worker's session LRU (8 entries) can evict a sourceId this process
    // still marks as sent (equity ticks churn sourceIds fast). Resend the
    // full source once instead of failing the request path.
    const message = error instanceof Error ? error.message : String(error);
    if (sourceId && message.includes("unknown sourceId")) {
      sentSourceIds.delete(sourceId);
      return postBuildRequest(activeWorker, source, timeframes, sourceId);
    }
    throw error;
  }
}

function postBuildRequest(
  activeWorker: Worker,
  source: Parameters<typeof buildTimeframeView>[0] extends infer S & {
    timeframe: Timeframe;
  }
    ? Omit<S, "timeframe">
    : never,
  timeframes: Timeframe[],
  sourceId?: string,
): Promise<Partial<Record<Timeframe, CachedTimeframeViews>>> {
  const includeSource = !(sourceId && sentSourceIds.has(sourceId));
  if (sourceId && includeSource) {
    sentSourceIds.add(sourceId);
  }

  const id = nextRequestId++;
  const request = {
    id,
    timeframes,
    ...(sourceId
      ? {
          sourceId,
          ...(includeSource ? { sourceJson: JSON.stringify(source) } : {}),
        }
      : { sourceJson: JSON.stringify(source) }),
  };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage(request);
  });
}
