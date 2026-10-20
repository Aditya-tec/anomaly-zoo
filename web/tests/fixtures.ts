import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllTraces, loadManifest } from "@/lib/data";
import { LEVELS } from "@/lib/levels";
import type { Level, Trace } from "@/lib/types";

export const manifest = loadManifest();

export const allTraces: { id: string; level: Level; trace: Trace }[] = manifest.scenarios.flatMap((s) => {
  const t = loadAllTraces(s.id);
  return LEVELS.map((level) => ({ id: s.id, level, trace: t[level] }));
});

export interface ExpectedCell {
  invariant: "holds" | "violated";
  serializable: boolean;
  aborts: Record<string, string>;
  mechanism: string;
}

/** The Go engine's expected matrix (scenarios/expected.json), an independent source of truth. */
export const expected: Record<string, Record<Level, ExpectedCell>> = JSON.parse(
  readFileSync(join(process.cwd(), "..", "scenarios", "expected.json"), "utf8"),
).cells;
