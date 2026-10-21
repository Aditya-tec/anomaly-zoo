import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ogInputsHash, ogSlugs } from "../scripts/og-inputs.mjs";
import { manifest } from "./fixtures";

const root = process.cwd();
const dir = join(root, "public", "og");
const inputs: Record<string, string> = existsSync(join(dir, "inputs.json")) ? JSON.parse(readFileSync(join(dir, "inputs.json"), "utf8")) : {};

function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  expect(b.subarray(0, 8).toString("hex"), `${file}: PNG signature`).toBe("89504e470d0a1a0a");
  expect(b.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe("share images (public/og/<slug>.png)", () => {
  const slugs = ogSlugs(manifest);

  it("there is one for each of the 8 anomalies plus the site default", () => {
    expect(slugs).toHaveLength(9);
    for (const s of slugs) expect(existsSync(join(dir, `${s}.png`)), `${s}.png missing (run npm run build && npm run og)`).toBe(true);
  });

  it("each is a 1200 x 630 PNG of at most 100 KB", () => {
    for (const s of slugs) {
      const f = join(dir, `${s}.png`);
      expect(pngSize(f), s).toEqual({ width: 1200, height: 630 });
      expect(statSync(f).size, `${s}.png size`).toBeLessThanOrEqual(100 * 1024);
    }
  });

  it("none is stale: the manifest data and the card design still hash to what the images were made from", () => {
    for (const s of slugs) {
      expect(inputs[s], `${s}: no recorded inputs`).toBeDefined();
      expect(ogInputsHash(root, manifest, s), `${s}.png is stale; run npm run build && npm run og`).toBe(inputs[s]);
    }
  });
});
