import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PG_LEVELS, parseConformance, percent, pgBadgeFor, pgBadgesForScenario, type Conformance } from "@/lib/conformance";
import { outcomeFromInvariant, outcomeLabel, pgBadgeView } from "@/lib/outcomes";
import { PgBadge } from "@/components/PgBadge";
import { ConformanceSection } from "@/components/ConformanceSection";

// Fixture data on purpose: these tests prove the UI shows what the file says,
// whatever the file says. The fixture's numbers and versions are not real.
const raw = JSON.parse(readFileSync(join(process.cwd(), "tests", "data", "conformance.fixture.json"), "utf8"));
const fixture = (): Conformance => parseConformance(structuredClone(raw));

function mutate(f: (o: any) => void): unknown { // eslint-disable-line @typescript-eslint/no-explicit-any
  const o = structuredClone(raw);
  f(o);
  return o;
}

describe("parseConformance", () => {
  it("accepts the fixture and keeps its values", () => {
    const c = fixture();
    expect(c.engineVersion).toBe("9.9.9");
    expect(c.postgresVersion).toBe("99.1");
    expect(c.canned.map((x) => x.scenario)).toEqual(["dirty-read", "write-skew"]);
    expect(c.random.SER.abortSetsIdentical).toBe(33);
    expect(c.knownDivergences[0]?.causeEstablished).toBe(false);
  });

  it("rejects a malformed file (it must fail the build, never render partial data)", () => {
    expect(() => parseConformance(null)).toThrow();
    expect(() => parseConformance(mutate((o) => (o.schemaVersion = 2)))).toThrow(/schemaVersion/);
    expect(() => parseConformance(mutate((o) => delete o.engineVersion))).toThrow(/engineVersion/);
    expect(() => parseConformance(mutate((o) => (o.postgresVersion = "")))).toThrow(/postgresVersion/);
    expect(() => parseConformance(mutate((o) => delete o.random.SER))).toThrow();
    expect(() => parseConformance(mutate((o) => (o.random.RC.identical = -1)))).toThrow(/identical/);
    expect(() => parseConformance(mutate((o) => (o.random.RC.identical = 1.5)))).toThrow(/identical/);
    expect(() => parseConformance(mutate((o) => (o.random.RC.level = "SI")))).toThrow(/level/);
    expect(() => parseConformance(mutate((o) => (o.canned[0].levels.RC.classMatch = "yes")))).toThrow(/classMatch/);
    expect(() => parseConformance(mutate((o) => (o.canned[1].levels.SI.postgres.aborts.T2 = 3)))).toThrow(/aborts/);
    expect(() => parseConformance(mutate((o) => delete o.readUncommitted.dirtyReadObserved))).toThrow(/dirtyReadObserved/);
    expect(() => parseConformance(mutate((o) => delete o.knownDivergences[0].schedule))).toThrow(/schedule/);
  });
});

describe("badge data selectors", () => {
  it("returns the measured PostgreSQL result for a scenario and level", () => {
    const c = fixture();
    const d = pgBadgeFor(c, "write-skew", "SI");
    expect(d).toMatchObject({ kind: "measured", postgresVersion: "99.1", invariant: "holds", classMatch: false, identical: false });
    expect(d?.kind === "measured" && d.aborts).toEqual({ T2: "abort_dependencies" });
  });

  it("has nothing for a scenario the file does not cover", () => {
    expect(pgBadgeFor(fixture(), "phantom", "RC")).toBeUndefined();
    expect(pgBadgesForScenario(fixture(), "phantom")).toEqual({ RU: { kind: "no-read-uncommitted" } });
  });

  it("says PostgreSQL has no read-uncommitted only when the probe saw no dirty read", () => {
    const c = fixture();
    expect(pgBadgeFor(c, "dirty-read", "RU")).toEqual({ kind: "no-read-uncommitted" });
    c.readUncommitted.dirtyReadObserved = true;
    expect(pgBadgeFor(c, "dirty-read", "RU")).toBeUndefined();
  });

  it("covers RU, RC, SI and SER for a canned scenario", () => {
    expect(Object.keys(pgBadgesForScenario(fixture(), "dirty-read")).sort()).toEqual(["RC", "RU", "SER", "SI"]);
  });
});

describe("pgBadgeView and PgBadge", () => {
  it("takes the outcome from the measured invariant, with glyph and word", () => {
    const c = fixture();
    for (const lv of PG_LEVELS) {
      const cell = c.canned[1]!.levels[lv]!;
      const d = pgBadgeFor(c, "write-skew", lv)!;
      const v = pgBadgeView(lv, d);
      expect(v.label).toEqual(outcomeLabel(outcomeFromInvariant(cell.postgres.invariant)));
      const html = renderToStaticMarkup(<PgBadge level={lv} data={d} />);
      expect(html).toContain(v.label!.text);
      expect(html).toContain(v.label!.glyph);
      expect(html).toContain("99.1");
    }
  });

  it("says when PostgreSQL's outcome differs from the engine's, and names the abort", () => {
    const html = renderToStaticMarkup(<PgBadge level="SI" data={pgBadgeFor(fixture(), "write-skew", "SI")} />);
    expect(html).toContain("differs from the engine");
    expect(html).toContain("PostgreSQL aborted T2");
    expect(html).toContain("read/write dependencies");
    const same = renderToStaticMarkup(<PgBadge level="SER" data={pgBadgeFor(fixture(), "write-skew", "SER")} />);
    expect(same).toContain("Same outcome as this engine");
  });

  it("renders the Read Uncommitted note as exactly that sentence, with no outcome", () => {
    const html = renderToStaticMarkup(<PgBadge level="RU" data={{ kind: "no-read-uncommitted" }} />);
    expect(html).toContain("PostgreSQL has no read-uncommitted");
    expect(html).toContain('data-pg-outcome="none"');
    expect(html).not.toMatch(/✓|✗/);
  });

  it("renders nothing without data", () => {
    expect(renderToStaticMarkup(<PgBadge level="SER" />)).toBe("");
  });
});

describe("percent", () => {
  it("formats and guards the empty denominator", () => {
    expect(percent(1, 3)).toBe("33.3%");
    expect(percent(1, 8, 2)).toBe("12.50%");
    expect(percent(0, 0)).toBe("n/a");
  });
});

describe("ConformanceSection shows the file and nothing else", () => {
  const c = fixture();
  const html = renderToStaticMarkup(<ConformanceSection conf={c} />);

  it("states both versions and the corpus size from the file", () => {
    expect(html).toContain(`>${c.engineVersion}<`);
    expect(html).toContain(`>${c.postgresVersion}<`);
    expect(html).toContain(`>${c.corpus.randomPerLevel}<`);
  });

  it("prints every per-level total and percentage computed from the file", () => {
    for (const lv of PG_LEVELS) {
      const t = c.random[lv];
      const row = html.slice(html.indexOf(`<tr data-level="${lv}">`)).split("</tr>")[0]!;
      expect(row).toContain(`${t.schedules}</td>`);
      expect(row).toContain(`${t.identical} (${percent(t.identical, t.compared)})`);
      expect(row).toContain(`${t.noRaceIdentical} of ${t.noRaceCompared} (${percent(t.noRaceIdentical, t.noRaceCompared)})`);
      expect(row).toContain(`${t.deadlockClassAgreed} of ${t.deadlockSchedules}`);
    }
  });

  it("prints the Serializable statistics from the file", () => {
    const s = c.random.SER;
    expect(html).toContain(`data-field="engine-ser">${s.engineSerializable}<`);
    expect(html).toContain(`data-field="pg-ser">${s.postgresSerializable}<`);
    expect(html).toContain(`data-field="abort-identical">${s.abortSetsIdentical}<`);
    expect(html).toContain(`data-field="engine-more">${s.engineAbortsMore}<`);
    expect(html).toContain(`data-field="engine-fewer">${s.engineAbortsFewer}<`);
  });

  it("marks each canned cell with the invariant the file recorded for both sides", () => {
    for (const s of c.canned) {
      for (const lv of PG_LEVELS) {
        const cell = s.levels[lv]!;
        const td = html.slice(html.indexOf(`<tr data-scenario="${s.scenario}">`)).split("</tr>")[0]!;
        expect(td).toContain(`data-pg-invariant="${cell.postgres.invariant}"`);
        expect(td).toContain(`data-engine-invariant="${cell.engine.invariant}"`);
      }
    }
    expect(html).toContain("(differs)");
  });

  it("prints a divergence's cause and schedule as inert text", () => {
    const hostile = fixture();
    hostile.knownDivergences[0]!.cause = '<img src=x onerror="alert(1)"> cause not yet established';
    hostile.knownDivergences[0]!.schedule = "<script>alert(1)</script>\nT1 BEGIN";
    const out = renderToStaticMarkup(<ConformanceSection conf={hostile} />);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
    expect(out).toContain("cause not yet established");
  });

  it("states the Read Uncommitted result only as measured", () => {
    expect(html).toContain("PostgreSQL has no read-uncommitted");
    const dirty = fixture();
    dirty.readUncommitted.dirtyReadObserved = true;
    const out = renderToStaticMarkup(<ConformanceSection conf={dirty} />);
    expect(out).not.toContain("has no read-uncommitted");
    expect(out).toContain("showed a dirty read");
  });

  it("reports the harness self-check from the file", () => {
    expect(html).toContain(`${c.harness.stabilityUnstable} of ${c.harness.stabilityPairs} cases`);
    expect(html).toContain(`${c.harness.evaluations} comparisons`);
  });
});

describe("the committed report", () => {
  it("parses, and matches the shipped engine version", () => {
    const c = parseConformance(JSON.parse(readFileSync(join(process.cwd(), "public", "conformance.json"), "utf8")));
    const e = JSON.parse(readFileSync(join(process.cwd(), "public", "engine", "engine.json"), "utf8")) as { engineVersion: string };
    expect(c.engineVersion).toBe(e.engineVersion);
    for (const lv of PG_LEVELS) expect(c.random[lv].schedules).toBe(c.corpus.randomPerLevel);
  });
});
