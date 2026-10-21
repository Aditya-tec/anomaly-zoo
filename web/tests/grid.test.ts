import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_COLS, MAX_ROWS, colClass, colsClass, laneClass, rowClass } from "@/lib/grid";
import { MAX_STEPS, MAX_TXNS } from "@/lib/limits";

const css = readFileSync(join(process.cwd(), "app", "grid-classes.css"), "utf8");

describe("timeline grid classes (no inline styles, so the CSP can drop style-src 'unsafe-inline')", () => {
  it("the committed CSS is what the generator writes", () => {
    expect(() => execFileSync(process.execPath, ["scripts/gen-grid-css.mjs", "--check"], { cwd: process.cwd(), stdio: "pipe" })).not.toThrow();
  });

  it("covers the worst case: two timeline entries per scheduled step, six transactions", () => {
    expect(MAX_COLS).toBe(MAX_TXNS);
    expect(MAX_ROWS).toBeGreaterThanOrEqual(2 * MAX_STEPS);
  });

  it("defines every class the helpers can return", () => {
    for (let c = 1; c <= MAX_COLS; c++) {
      expect(css).toContain(`.gc-${c} { grid-column: ${c}; }`);
      expect(css).toContain(`.gcols-${c} { grid-template-columns: repeat(${c}, minmax(0, 1fr)); }`);
      expect(colClass(c)).toBe(`gc-${c}`);
      expect(colsClass(c)).toBe(`gcols-${c}`);
    }
    for (const r of [1, 2, 200, 400, MAX_ROWS]) {
      expect(css).toContain(`.gr-${r} { grid-row: ${r}; }`);
      expect(rowClass(r)).toBe(`gr-${r}`);
      expect(css).toContain(`.glane-${r + 2} { grid-row: 1 / ${r + 2}; }`);
      expect(laneClass(r)).toBe(`glane-${r + 2}`);
    }
    for (let t = 1; t <= 6; t++) expect(css).toContain(`[data-txn="T${t}"] { --txn: var(--txn-${t}); }`);
  });

  it("falls back to automatic placement instead of emitting a class that does not exist", () => {
    expect(rowClass(0)).toBe("");
    expect(rowClass(MAX_ROWS + 1)).toBe("");
    expect(colClass(MAX_COLS + 1)).toBe("");
    expect(laneClass(MAX_ROWS + 1)).toBe("");
    expect(rowClass(1.5)).toBe("");
  });
});
