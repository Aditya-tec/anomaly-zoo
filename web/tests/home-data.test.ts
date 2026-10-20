import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { join } from "node:path";
import { manifest } from "./fixtures";
import { buildHomeData } from "@/lib/home";

describe("home page data budget (spec §7.10: <= 10 KB)", () => {
  it("the serialized map data is well under 10 KB", () => {
    const bytes = Buffer.byteLength(JSON.stringify(buildHomeData(manifest)), "utf8");
    expect(bytes).toBeLessThanOrEqual(10 * 1024);
  });

  it("matrix.json (the compact summary) is under 10 KB", () => {
    expect(statSync(join(process.cwd(), "public", "traces", "matrix.json")).size).toBeLessThanOrEqual(10 * 1024);
  });

  it("every trace file is within the 20 KB budget", () => {
    for (const s of manifest.scenarios) for (const t of Object.values(s.traces)) expect(t.bytes).toBeLessThanOrEqual(20 * 1024);
  });

  it("the map lists the catalogue in teaching order", () => {
    expect(buildHomeData(manifest).rows.map((r) => r.id)).toEqual([
      "dirty-read", "non-repeatable-read", "phantom", "lost-update", "read-skew", "write-skew", "read-only-anomaly", "deadlock",
    ]);
  });
});
