// Browser-side access to the engine (WASM in a Web Worker). Nothing here runs
// at import time: the module and the worker are fetched only when a function
// below is first called, which only happens after a user action (spec §7.6,
// §7.10, AC7.2). Pages that never call it never request the engine.
import type { Level, Trace } from "./types";
import { LEVELS } from "./levels";
import { parseTrace } from "./parse";

export interface EngineError {
  line: number;
  col: number;
  message: string;
}

export type RunAllResult = { ok: true; traces: Record<Level, Trace> } | { ok: false; errors: EngineError[] };

interface RawClient {
  runAll(source: string): Promise<unknown>;
  terminate(): void;
}

const CLIENT_URL = "/engine/client.mjs";
const WORKER_URL = "/engine/worker.js";
export const ENGINE_TIMEOUT_MS = 2000;

let clientPromise: Promise<RawClient> | null = null;

/** Starts loading the engine without waiting for it (call on user intent, e.g. focusing the editor). */
export function prewarmEngine(): void {
  loadClient().catch(() => undefined);
}

function loadClient(): Promise<RawClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      // A runtime import of a same-origin file: the bundler must leave it alone.
      const mod = (await import(/* webpackIgnore: true */ CLIENT_URL)) as {
        createEngine: (o: { spawn: () => Worker; timeoutMs: number }) => RawClient;
      };
      return mod.createEngine({ spawn: () => new Worker(WORKER_URL), timeoutMs: ENGINE_TIMEOUT_MS });
    })();
    clientPromise.catch(() => {
      clientPromise = null; // allow a retry after a failed load
    });
  }
  return clientPromise;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Validates what the worker returned; anything unexpected is an error, never rendered. */
export function checkRunAll(x: unknown): RunAllResult {
  if (!isObj(x)) throw new Error("unexpected engine response");
  if (x.ok === false) {
    const errs = Array.isArray(x.errors) ? x.errors : [];
    const errors: EngineError[] = errs
      .filter(isObj)
      .map((e) => ({ line: Number(e.line) || 1, col: Number(e.col) || 1, message: String(e.message ?? "error").slice(0, 300) }));
    return { ok: false, errors: errors.length > 0 ? errors : [{ line: 1, col: 1, message: "The engine rejected the scenario." }] };
  }
  if (x.ok !== true || !isObj(x.traces)) throw new Error("unexpected engine response");
  const traces = {} as Record<Level, Trace>;
  for (const lv of LEVELS) traces[lv] = parseTrace(x.traces[lv], lv);
  return { ok: true, traces };
}

/** Runs the scenario at all four levels in one worker request. */
export async function runAll(source: string): Promise<RunAllResult> {
  const client = await loadClient();
  return checkRunAll(await client.runAll(source));
}

export type EngineProblem = { kind: "timeout" | "load" | "other"; message: string };

export function classifyEngineError(e: unknown): EngineProblem {
  const text = e instanceof Error ? e.message : String(e);
  if (/timed out/i.test(text)) {
    return { kind: "timeout", message: "The engine did not answer within 2 seconds, so it was restarted. Try a smaller schedule." };
  }
  if (/failed to load|Failed to fetch|import|NetworkError|Load failed/i.test(text)) {
    return { kind: "load", message: "The engine could not be loaded. Check your connection and try again." };
  }
  return { kind: "other", message: "Something went wrong while running the scenario. Nothing was changed." };
}
