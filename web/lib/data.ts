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

const PUBLIC = join(process.cwd(), "public");

export const SITE_URL = "https://anomaly-zoo.vercel.app";

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