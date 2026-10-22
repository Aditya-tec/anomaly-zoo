import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

/** Text of the first `{ ... }` block that follows `selector`. */
function blockAfter(selector: string): string {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === "{") depth++;
    if (css[j] === "}" && --depth === 0) return css.slice(open + 1, j);
  }
  throw new Error("unbalanced braces");
}

// One theme: black, white at varying opacity, over a dark looping video.
const dark = vars(blockAfter(":root {"));

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const themes = { dark };
const surfaces = ["bg", "surface", "surface-2"];

describe("theme tokens", () => {
  it("there is a single dark theme: no light variant and no prefers-color-scheme override", () => {
    expect(Object.keys(dark).length).toBeGreaterThan(15);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/data-theme/);
  });

  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      it("body and muted text reach 4.5:1 on every surface", () => {
        for (const s of surfaces) {
          for (const fg of ["fg", "fg-muted", "accent", "good", "bad", "warn"]) {
            expect(ratio(t[fg]!, t[s]!), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it("the six transaction colours reach 4.5:1 on every surface", () => {
        for (const s of surfaces) {
          for (let i = 1; i <= 6; i++) expect(ratio(t[`txn-${i}`]!, t[s]!), `txn-${i} on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("primary button text on the accent reaches 4.5:1", () => {
        expect(ratio(t["accent-fg"]!, t["accent"]!)).toBeGreaterThanOrEqual(4.5);
      });

      it("focus ring and borders reach 3:1 (WCAG 1.4.11) against the page and cards", () => {
        for (const s of ["bg", "surface"]) {
          expect(ratio(t["focus"]!, t[s]!), `focus on ${s}`).toBeGreaterThanOrEqual(3);
          expect(ratio(t["border"]!, t[s]!), `border on ${s}`).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }

  it("the six transaction colours are distinct from each other in both themes", () => {
    for (const t of Object.values(themes)) {
      const set = new Set([1, 2, 3, 4, 5, 6].map((i) => t[`txn-${i}`]));
      expect(set.size).toBe(6);
    }
  });
});
