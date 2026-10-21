// "Re-run in your browser": compare the digests the WASM engine produces with
// the digests of the traces shipped with the site (spec §7.6).
import type { Level } from "./types";
import { LEVELS } from "./levels";

export interface DigestRow {
  level: Level;
  published: string;
  browser: string | null;
  same: boolean;
}

export interface DigestComparison {
  identical: boolean;
  rows: DigestRow[];
}

/** `browser` is null for a level the engine did not return; that is a mismatch, never a pass. */
export function compareDigests(published: Record<Level, string>, browser: Partial<Record<Level, string>>): DigestComparison {
  const rows = LEVELS.map((level) => {
    const b = browser[level] ?? null;
    return { level, published: published[level], browser: b, same: b !== null && b === published[level] };
  });
  return { identical: rows.every((r) => r.same), rows };
}
