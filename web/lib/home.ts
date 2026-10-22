// Builds the Habitat Map from manifest.json. Rows, columns, outcomes and
// mechanisms all come from the engine's own results (spec §7.3).
import type { Level, Manifest } from "./types";
import { LEVELS } from "./levels";
import { anomalyName, cellView, defaultLevelFor, outcomeTone, type CellView } from "./outcomes";

export interface MapRow {
  id: string;
  title: string;
  name: string;
  cells: (CellView & { href: string })[];
  defaultLevel: Level;
}

export interface HomeData {
  rows: MapRow[];
}

export const catalogOrder = ["dirty-read", "non-repeatable-read", "phantom", "lost-update", "read-skew", "write-skew", "read-only-anomaly", "deadlock"];

export function orderScenarios<T extends { id: string }>(list: T[]): T[] {
  const rank = (id: string) => {
    const i = catalogOrder.indexOf(id);
    return i < 0 ? catalogOrder.length : i;
  };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export function buildHomeData(manifest: Manifest): HomeData {
  return {
    rows: orderScenarios(manifest.scenarios).map((s) => ({
      id: s.id,
      title: s.title,
      name: anomalyName(s.title),
      defaultLevel: defaultLevelFor(s),
      cells: LEVELS.map((lv) => ({ ...cellView(lv, s.traces[lv]), href: `/anomalies/${s.id}?level=${lv}` })),
    })),
  };
}

export interface LevelTotal {
  level: Level;
  /** Anomalies whose invariant holds at this level. */
  safe: number;
  total: number;
}

/** How many of the catalogue's anomalies each level stops, counted from the same cells the map shows. */
export function levelTotals(data: HomeData): LevelTotal[] {
  return LEVELS.map((level) => ({
    level,
    safe: data.rows.filter((r) => r.cells.some((c) => c.level === level && outcomeTone(c.outcome) === "good")).length,
    total: data.rows.length,
  }));
}
