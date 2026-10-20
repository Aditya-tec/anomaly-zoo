import type { Level } from "./types";

export const LEVELS: readonly Level[] = ["RU", "RC", "SI", "SER"];

export const LEVEL_NAMES: Record<Level, string> = {
  RU: "Read Uncommitted",
  RC: "Read Committed",
  SI: "Snapshot Isolation",
  SER: "Serializable",
};

// One-line definitions, verbatim from spec §8.2.
export const LEVEL_DEFINITIONS: Record<Level, string> = {
  RU: "Reads whatever is newest, even if its writer has not committed. Included to show dirty reads; most databases do not offer it.",
  RC: "Each statement sees what was committed when that statement started.",
  SI: "The whole transaction sees the database as of its first read or write. If two transactions write the same row, the first to get there wins and the other aborts.",
  SER: "Snapshot isolation plus detection of dangerous read→write patterns. Some transactions abort so the result always matches running them one at a time.",
};

export function isLevel(x: unknown): x is Level {
  return x === "RU" || x === "RC" || x === "SI" || x === "SER";
}
