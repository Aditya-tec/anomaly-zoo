import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { allTraces, expected, manifest } from "./fixtures";
import {
  anomalyName, bannerFromTrace, cellView, defaultLevelFor, invariantOutcome, mechanismLabel, mechanismOf,
  outcomeFromInvariant, outcomeLabel, outcomeTone, verdictText,
} from "@/lib/outcomes";
import { buildHomeData } from "@/lib/home";
import { LEVELS } from "@/lib/levels";
import type { Manifest } from "@/lib/types";

describe("outcomes are derived from data", () => {
  it("all 32 manifest cells equal the Go engine's expected.json", () => {
    expect(manifest.scenarios).toHaveLength(8);
    for (const s of manifest.scenarios) {
      for (const lv of LEVELS) {
        const want = expected[s.id]?.[lv];
        const got = s.traces[lv];
        expect(want, `${s.id}@${lv}`).toBeDefined();
        expect(got.invariant, `${s.id}@${lv} invariant`).toBe(want?.invariant);
        expect(got.serializable, `${s.id}@${lv} serializable`).toBe(want?.serializable);
        expect(got.aborts, `${s.id}@${lv} aborts`).toEqual(want?.aborts);
        expect(got.mechanism, `${s.id}@${lv} mechanism`).toBe(want?.mechanism);
      }
    }
  });

  it("the UI's own derivation from each trace agrees with the manifest", () => {
    for (const { id, level, trace } of allTraces) {
      const cell = manifest.scenarios.find((s) => s.id === id)!.traces[level];
      expect(outcomeFromInvariant(cell.invariant)).toBe(invariantOutcome(trace));
      expect(mechanismOf(trace), `${id}@${level}`).toBe(cell.mechanism);
    }
  });

  it("map labels come from the data: flipping a manifest cell flips the label", () => {
    const flipped: Manifest = structuredClone(manifest);
    const cell = flipped.scenarios[0]!.traces.RC;
    const before = buildHomeData(manifest).rows.find((r) => r.id === flipped.scenarios[0]!.id)!.cells[1]!;
    cell.invariant = cell.invariant === "holds" ? "violated" : "holds";
    const after = buildHomeData(flipped).rows.find((r) => r.id === flipped.scenarios[0]!.id)!.cells[1]!;
    expect(after.outcome).not.toBe(before.outcome);
    expect(after.label.text).not.toBe(before.label.text);
    expect(after.label.glyph).not.toBe(before.label.glyph);
    // And unrelated cells are untouched.
    expect(buildHomeData(flipped).rows[0]!.cells[0]).toEqual(buildHomeData(manifest).rows[0]!.cells[0]);
  });

  it("each cell carries a glyph and a word, so colour is never the only signal", () => {
    for (const row of buildHomeData(manifest).rows) {
      for (const c of row.cells) {
        expect(c.label.glyph.length).toBeGreaterThan(0);
        expect(c.label.text.length).toBeGreaterThan(0);
        expect(c.href).toBe(`/anomalies/${row.id}?level=${c.level}`);
      }
    }
    expect(outcomeLabel("not-evaluated").text).toBe("Not evaluated");
    expect(outcomeTone("occurs")).toBe("bad");
    expect(outcomeTone("prevented")).toBe("good");
  });

  it("every row has a matching expected.json row and the same outcome in each column", () => {
    for (const row of buildHomeData(manifest).rows) {
      for (const c of row.cells) {
        const want = expected[row.id]![c.level].invariant === "violated" ? "occurs" : "prevented";
        expect(c.outcome, `${row.id}@${c.level}`).toBe(want);
      }
    }
  });

  it("default level is the highest level at which the bug still happens", () => {
    const pick = (id: string) => defaultLevelFor(manifest.scenarios.find((s) => s.id === id)!);
    expect(pick("dirty-read")).toBe("RU");
    expect(pick("lost-update")).toBe("RC");
    expect(pick("write-skew")).toBe("SI");
    expect(pick("deadlock")).toBe("SER");
  });
});

describe("banner and verdict text are generated from traces", () => {
  const trace = (id: string, level: string) => allTraces.find((t) => t.id === id && t.level === level)!.trace;

  it("write skew at SI: bug, with the invariant detail from the engine", () => {
    const b = bannerFromTrace(trace("write-skew", "SI"));
    expect(b.kind).toBe("occurs");
    expect(b.headline).toBe("Write Skew occurs at Snapshot Isolation.");
    expect(b.lines.join(" ")).toContain("lhs=0 rhs=1");
  });

  it("write skew at SER: prevented, naming the aborted transaction and its reason", () => {
    const b = bannerFromTrace(trace("write-skew", "SER"));
    expect(b.kind).toBe("prevented");
    expect(b.headline).toBe("Write Skew is prevented at Serializable.");
    expect(b.lines.join(" ")).toContain("T2 aborted: could not serialize access due to read/write dependencies among transactions.");
  });

  it("deadlock occurs at every level and the abort is reported", () => {
    for (const lv of LEVELS) {
      const b = bannerFromTrace(trace("deadlock", lv));
      expect(b.kind).toBe("occurs");
      expect(b.lines.join(" ")).toContain("T2 aborted: deadlock detected.");
    }
  });

  it("visibility-only prevention gets the visibility sentence", () => {
    const b = bannerFromTrace(trace("non-repeatable-read", "SI"));
    expect(b.kind).toBe("prevented");
    expect(b.lines.at(-1)).toBe(mechanismLabel("visibility", {}));
  });

  it("verdict text: spec sentence when no serial order exists, witness order otherwise", () => {
    expect(verdictText(trace("write-skew", "SI"))).toBe("No serial order of the committed transactions produces these reads and this final state.");
    expect(verdictText(trace("write-skew", "SER"))).toContain("T1");
    expect(verdictText(trace("read-only-anomaly", "SER"))).toContain("T3 → T1");
  });

  it("anomalyName takes the part of the title before the colon", () => {
    expect(anomalyName("Write Skew: the hospital with no doctor on call")).toBe("Write Skew");
    expect(anomalyName("No colon here")).toBe("No colon here");
    for (const s of manifest.scenarios) expect(cellView("SI", s.traces.SI).label.text.length).toBeGreaterThan(0);
  });
});

// Spec §9.2: no hard-coded outcomes in web/. The ESLint rule enforces this on
// string literals and JSX text; this test also scans the source text so the
// guarantee does not depend on the linter being configured correctly.
describe("no outcome words authored outside lib/outcomes.ts", () => {
  function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) yield* sources(p);
      else if (/\.(ts|tsx)$/.test(name)) yield p;
    }
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("app/, components/ and lib/ contain the words only in outcomes.ts", () => {
    const offenders: string[] = [];
    for (const root of ["app", "components", "lib"]) {
      for (const file of sources(join(process.cwd(), root))) {
        const rel = relative(process.cwd(), file).replace(/\\/g, "/");
        if (rel === "lib/outcomes.ts" || /\.test\.tsx?$/.test(rel)) continue;
        if (/\b(occurs?|prevented)\b/i.test(strip(readFileSync(file, "utf8")))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan itself catches a hard-coded outcome", () => {
    expect(/\b(occurs?|prevented)\b/i.test(strip('const label = "Prevented";'))).toBe(true);
    expect(/\b(occurs?|prevented)\b/i.test(strip("<span>Occurs</span>"))).toBe(true);
    expect(/\b(occurs?|prevented)\b/i.test(strip("// only a comment about it occurs"))).toBe(false);
  });
});
