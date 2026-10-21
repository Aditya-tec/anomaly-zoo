import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRunAll, classifyEngineError } from "@/lib/engine";
import { compareDigests } from "@/lib/rerun";
import { LEVELS } from "@/lib/levels";
import { defaultLevelFromTraces, bannerFromTrace, summaryFor, verdictText } from "@/lib/outcomes";
import { allTraces, examples, manifest } from "./fixtures";
import type { Level, Trace } from "@/lib/types";

const goodResponse = (id: string) => {
  const traces = {} as Record<Level, Trace>;
  for (const lv of LEVELS) traces[lv] = allTraces.find((t) => t.id === id && t.level === lv)!.trace;
  return { ok: true, traces };
};

describe("worker response validation", () => {
  it("accepts a well-formed runAll response", () => {
    const r = checkRunAll(goodResponse("write-skew"));
    expect(r.ok).toBe(true);
  });

  it("turns engine errors into data with line and column", () => {
    const r = checkRunAll({ ok: false, errors: [{ line: 4, col: 7, message: "unknown operation" }] });
    expect(r).toEqual({ ok: false, errors: [{ line: 4, col: 7, message: "unknown operation" }] });
  });

  it("never passes malformed input on to the UI", () => {
    for (const bad of [null, undefined, 7, "x", [], {}, { ok: true }, { ok: true, traces: {} }, { ok: true, traces: { RU: {}, RC: {}, SI: {}, SER: {} } }]) {
      expect(() => checkRunAll(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("a trace under the wrong level key is rejected", () => {
    const g = goodResponse("write-skew") as { traces: Record<string, unknown> };
    const swapped = { ok: true, traces: { ...g.traces, RU: g.traces.SER } };
    expect(() => checkRunAll(swapped)).toThrow();
  });

  it("clips and defaults hostile error fields", () => {
    const r = checkRunAll({ ok: false, errors: [{ line: "x", col: null, message: "m".repeat(10_000) }, 5, null] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.message.length).toBe(300);
      expect(r.errors[0]!.line).toBe(1);
      expect(r.errors).toHaveLength(1);
    }
    expect(checkRunAll({ ok: false, errors: [] })).toMatchObject({ ok: false });
  });

  it("classifies failures into the messages the UI shows", () => {
    expect(classifyEngineError(new Error('engine call "runAll" timed out after 2000 ms; worker restarted')).kind).toBe("timeout");
    expect(classifyEngineError(new Error("engine failed to load: TypeError: Failed to fetch")).kind).toBe("load");
    expect(classifyEngineError(new Error("boom")).kind).toBe("other");
    expect(classifyEngineError("a string").kind).toBe("other");
    expect(classifyEngineError(new Error("timed out")).message).toBe("The engine did not answer within 2 seconds, so it was restarted. Try a smaller schedule.");
  });
});

describe("digest comparison for 'Re-run in your browser'", () => {
  const published = (id: string) => Object.fromEntries(LEVELS.map((lv) => [lv, manifest.scenarios.find((s) => s.id === id)!.traces[lv].digest])) as Record<Level, string>;

  it("identical only when every level matches", () => {
    const pub = published("write-skew");
    expect(compareDigests(pub, pub).identical).toBe(true);
  });

  it("one differing digest is a mismatch and names both digests", () => {
    const pub = published("write-skew");
    const c = compareDigests(pub, { ...pub, SI: "0".repeat(64) });
    expect(c.identical).toBe(false);
    const row = c.rows.find((r) => r.level === "SI")!;
    expect(row).toEqual({ level: "SI", published: pub.SI, browser: "0".repeat(64), same: false });
    expect(c.rows.filter((r) => r.same)).toHaveLength(3);
  });

  it("a level the engine did not return is a mismatch, never a pass", () => {
    const pub = published("phantom");
    const c = compareDigests(pub, { RU: pub.RU, RC: pub.RC, SI: pub.SI });
    expect(c.identical).toBe(false);
    expect(c.rows.find((r) => r.level === "SER")!.browser).toBeNull();
  });
});

describe("oracle-only results (playground scenarios without invariants)", () => {
  // Strip the invariants from a canned trace, which is what a playground scenario looks like.
  const bare = (id: string, level: Level): Trace => {
    const t = structuredClone(allTraces.find((x) => x.id === id && x.level === level)!.trace);
    t.invariants = [];
    t.scenario.invariants = [];
    return t;
  };

  it("not serializable: the spec sentence, a bad tone, and no outcome words", () => {
    const t = bare("write-skew", "SI");
    const s = summaryFor(t);
    expect(s.kind).toBe("not-serializable");
    expect(s.tone).toBe("bad");
    expect(s.label).toEqual({ glyph: "✗", text: "Not serializable" });
    expect(verdictText(t)).toBe("No serial order of the committed transactions produces these reads and this final state.");
    const b = bannerFromTrace(t);
    expect(b.lines).toContain("No serial order of the committed transactions produces these reads and this final state.");
    expect(b.headline).toBe("At Snapshot Isolation, the committed transactions match no serial order.");
    expect(b.kind).toBe("not-serializable");
  });

  it("serializable: a good tone and the witness order", () => {
    const t = bare("write-skew", "SER");
    expect(summaryFor(t).kind).toBe("serializable");
    expect(bannerFromTrace(t).lines.join(" ")).toContain("one at a time in this order");
    expect(bannerFromTrace(t).tone).toBe("good");
  });

  it("canned traces with invariants still use the invariant outcome", () => {
    expect(summaryFor(allTraces.find((x) => x.id === "write-skew" && x.level === "SI")!.trace).kind).toBe("occurs");
  });

  it("default level: highest level where the run still goes wrong", () => {
    const set = (id: string, strip: boolean) =>
      Object.fromEntries(LEVELS.map((lv) => [lv, strip ? bare(id, lv) : allTraces.find((x) => x.id === id && x.level === lv)!.trace])) as Record<Level, Trace>;
    expect(defaultLevelFromTraces(set("write-skew", true))).toBe("SI");
    expect(defaultLevelFromTraces(set("write-skew", false))).toBe("SI");
    expect(defaultLevelFromTraces(set("dirty-read", true))).toBe("RU");
  });
});

describe("scenario sources shipped inside web/", () => {
  it("content/scenarios equals the repository's scenarios/ byte for byte", () => {
    const names = readdirSync(join(process.cwd(), "..", "scenarios")).filter((f) => f.endsWith(".azs")).sort();
    expect(names).toHaveLength(8);
    expect(readdirSync(join(process.cwd(), "content", "scenarios")).sort()).toEqual(names);
    for (const n of names) {
      expect(readFileSync(join(process.cwd(), "content", "scenarios", n), "utf8"), n).toBe(readFileSync(join(process.cwd(), "..", "scenarios", n), "utf8"));
    }
  });

  it("every manifest scenario has a source and the examples follow the catalogue order", () => {
    expect(examples.map((e) => e.id)).toEqual(manifest.scenarios.map((s) => s.id).sort((a, b) => examples.findIndex((e) => e.id === a) - examples.findIndex((e) => e.id === b)));
    for (const e of examples) expect(e.source.startsWith(`scenario ${e.id}\n`), e.id).toBe(true);
  });
});
