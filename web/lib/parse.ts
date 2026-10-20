// Runtime checks for the JSON the site reads at build time. They guard the
// fields the UI relies on, so a stale or malformed file fails the build
// instead of rendering nonsense.
import type { Level, Manifest, Trace } from "./types";
import { LEVELS } from "./levels";

function fail(what: string): never {
  throw new Error(`invalid ${what}`);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function parseManifest(x: unknown): Manifest {
  if (!isObj(x) || x.schemaVersion !== 1 || !Array.isArray(x.scenarios) || !Array.isArray(x.levels)) fail("manifest");
  for (const s of x.scenarios as unknown[]) {
    if (!isObj(s) || typeof s.id !== "string" || typeof s.title !== "string" || typeof s.story !== "string" || !isObj(s.traces)) fail("manifest scenario");
    for (const lv of LEVELS) {
      const t = (s.traces as Record<string, unknown>)[lv];
      if (!isObj(t) || typeof t.file !== "string" || typeof t.digest !== "string" || typeof t.sha256 !== "string" || typeof t.bytes !== "number" ||
        !["holds", "violated", "n/a"].includes(String(t.invariant)) || typeof t.mechanism !== "string" || !isObj(t.aborts)) {
        fail(`manifest trace ${String(s.id)}@${lv}`);
      }
    }
  }
  return x as unknown as Manifest;
}

export function parseTrace(x: unknown, expectLevel?: Level): Trace {
  if (!isObj(x) || x.schemaVersion !== 1 || typeof x.digest !== "string" || !Array.isArray(x.steps) || !Array.isArray(x.txns) ||
    !Array.isArray(x.invariants) || !Array.isArray(x.setup) || !isObj(x.serializable) || !isObj(x.scenario)) {
    fail("trace");
  }
  if (expectLevel && x.level !== expectLevel) fail(`trace level (want ${expectLevel}, got ${String(x.level)})`);
  for (const e of x.steps as unknown[]) {
    if (!isObj(e) || typeof e.index !== "number" || typeof e.txn !== "string" || typeof e.op !== "string" || typeof e.status !== "string" ||
      !Array.isArray(e.reads) || !Array.isArray(e.effects) || !Array.isArray(e.storeAfter)) {
      fail("trace event");
    }
  }
  return x as unknown as Trace;
}
