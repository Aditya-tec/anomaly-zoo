// Build-time loaders. Server components call these while Next renders the
// static export; nothing here may be imported by a client component (it uses
// node:fs). Every trace file is checked against the sha256 recorded in
// manifest.json, so a stale file fails the build.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Level, Manifest, ManifestScenario, Trace } from "./types";
import { LEVELS } from "./levels";
import { parseManifest, parseTrace } from "./parse";
import { orderScenarios } from "./home";
import { parseConformance, type Conformance } from "./conformance";

const PUBLIC = join(process.cwd(), "public");

// Re-exported for existing imports; the value lives in lib/site.ts.
export { SITE_URL } from "./site";

let manifestCache: Manifest | null = null;

export function loadManifest(): Manifest {
  if (!manifestCache) {
    manifestCache = parseManifest(JSON.parse(readFileSync(join(PUBLIC, "traces", "manifest.json"), "utf8")));
  }
  return manifestCache;
}

export function loadScenario(slug: string): ManifestScenario {
  const s = loadManifest().scenarios.find((x) => x.id === slug);
  if (!s) throw new Error(`unknown scenario ${slug}`);
  return s;
}

export function loadTrace(slug: string, level: Level): Trace {
  const entry = loadScenario(slug).traces[level];
  const bytes = readFileSync(join(PUBLIC, "traces", entry.file));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== entry.sha256) throw new Error(`${entry.file} does not match manifest.json (stale trace? run \`go run ./cmd/azoo traces --out web/public/traces\`)`);
  const trace = parseTrace(JSON.parse(bytes.toString("utf8")), level);
  if (trace.digest !== entry.digest) throw new Error(`${entry.file}: digest differs from manifest.json`);
  return trace;
}

export function loadAllTraces(slug: string): Record<Level, Trace> {
  const out = {} as Record<Level, Trace>;
  for (const lv of LEVELS) out[lv] = loadTrace(slug, lv);
  return out;
}

export interface EngineInfo {
  engineVersion: string;
  goVersion: string;
  wasm: string;
  wasmSha256: string;
}

export function loadEngineInfo(): EngineInfo {
  return JSON.parse(readFileSync(join(PUBLIC, "engine", "engine.json"), "utf8")) as EngineInfo;
}

/** The .azs source of a canned scenario, kept inside web/ (content/scenarios) so a deploy with web/ as its root needs nothing outside it. */
export function loadSource(slug: string): string {
  loadScenario(slug); // rejects anything that is not in the manifest (no path tricks)
  return readFileSync(join(process.cwd(), "content", "scenarios", `${slug}.azs`), "utf8");
}

export interface Example {
  id: string;
  title: string;
  source: string;
}

export function loadExamples(): Example[] {
  return orderScenarios(loadManifest().scenarios).map((s) => ({ id: s.id, title: s.title, source: loadSource(s.id) }));
}

let conformanceCache: Conformance | null = null;

/**
 * The PostgreSQL conformance report. A missing, malformed or stale file fails
 * the build: the report must describe the engine that is being shipped.
 */
export function loadConformance(): Conformance {
  if (!conformanceCache) {
    const conf = parseConformance(JSON.parse(readFileSync(join(PUBLIC, "conformance.json"), "utf8")));
    const engine = loadEngineInfo();
    if (conf.engineVersion !== engine.engineVersion) {
      throw new Error(`conformance.json is for engine ${conf.engineVersion}, but the shipped engine is ${engine.engineVersion}: re-run the conformance harness`);
    }
    conformanceCache = conf;
  }
  return conformanceCache;
}
