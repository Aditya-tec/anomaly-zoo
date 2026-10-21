// Types, validation and selectors for public/conformance.json, the report the
// Go harness (conformance/) writes after comparing the engine with PostgreSQL.
// Nothing about PostgreSQL is authored by hand in the UI: every number and
// every outcome shown comes from this file. A malformed file fails the build.
import type { Level } from "./types";

export const PG_LEVELS = ["RC", "SI", "SER"] as const;
export type PgLevel = (typeof PG_LEVELS)[number];

export interface ConfCell {
  invariant: string;
  serializable: boolean;
  aborts: Record<string, string>;
  mechanism: string;
}

export interface ConfCannedLevel {
  engine: ConfCell;
  postgres: ConfCell;
  classMatch: boolean;
  identical: boolean;
  diffs: string[];
}

export interface ConfCanned {
  scenario: string;
  title: string;
  levels: Partial<Record<PgLevel, ConfCannedLevel>>;
}

export interface ConfTotals {
  level: PgLevel;
  schedules: number;
  deadlockSchedules: number;
  deadlockClassAgreed: number;
  compared: number;
  identical: number;
  raceSchedules: number;
  noRaceCompared: number;
  noRaceIdentical: number;
  raceEngineSeen: number;
  raceVariants: number;
  mismatches: number;
  mismatchesRace: number;
  reproducing: number;
  unstableRace: number;
  unstableOther: number;
  explained: number;
  unexplained: number;
  engineSerializable: number;
  postgresSerializable: number;
  abortSetsIdentical: number;
  engineAbortsMore: number;
  engineAbortsFewer: number;
  abortSetsDifferSameCount: number;
  engineAbortsFewerNotSerializable: number;
}

export interface ConfDivergence {
  id: string;
  title: string;
  levels: string[];
  cause: string;
  causeEstablished: boolean;
  notes: string;
  regression: string;
  schedule: string;
  occurrences: Record<string, number>;
}

export interface ConfReadUncommitted {
  scenario: string;
  requested: string;
  engineRU: string;
  postgresInvariant: string;
  dirtyReadObserved: boolean;
  sameHistoryAsReadCommitted: boolean;
}

export interface Conformance {
  schemaVersion: number;
  engineVersion: string;
  postgresVersion: string;
  corpus: { seedBase: number; randomPerLevel: number; noDelete: boolean };
  harness: { reruns: number; blockedAfterMs: number; unblockWaitMs: number; stabilityPairs: number; stabilityUnstable: number; stabilityRepeats: number; evaluations: number; rerunMismatches: number; unstableReruns: number };
  canned: ConfCanned[];
  readUncommitted: ConfReadUncommitted;
  random: Record<PgLevel, ConfTotals>;
  knownDivergences: ConfDivergence[];
}

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`conformance.json: ${what} must be an object`);
  return v as Obj;
}
function str(o: Obj, k: string, what: string): string {
  const v = o[k];
  if (typeof v !== "string" || v === "") throw new Error(`conformance.json: ${what}.${k} must be a non-empty string`);
  return v;
}
function num(o: Obj, k: string, what: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`conformance.json: ${what}.${k} must be a non-negative integer`);
  return v;
}
function bool(o: Obj, k: string, what: string): boolean {
  const v = o[k];
  if (typeof v !== "boolean") throw new Error(`conformance.json: ${what}.${k} must be a boolean`);
  return v;
}
function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`conformance.json: ${what} must be an array`);
  return v;
}

function cell(v: unknown, what: string): ConfCell {
  const o = obj(v, what);
  const aborts = obj(o["aborts"], `${what}.aborts`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(aborts)) {
    if (typeof val !== "string") throw new Error(`conformance.json: ${what}.aborts.${k} must be a string`);
    out[k] = val;
  }
  return { invariant: str(o, "invariant", what), serializable: bool(o, "serializable", what), aborts: out, mechanism: str(o, "mechanism", what) };
}

const TOTAL_KEYS: (keyof ConfTotals)[] = [
  "schedules", "deadlockSchedules", "deadlockClassAgreed", "compared", "identical", "raceSchedules", "noRaceCompared", "noRaceIdentical",
  "raceEngineSeen", "raceVariants", "mismatches", "mismatchesRace", "reproducing", "unstableRace", "unstableOther", "explained", "unexplained",
  "engineSerializable", "postgresSerializable", "abortSetsIdentical", "engineAbortsMore", "engineAbortsFewer", "abortSetsDifferSameCount",
  "engineAbortsFewerNotSerializable",
];

function totals(v: unknown, level: PgLevel): ConfTotals {
  const o = obj(v, `random.${level}`);
  if (o["level"] !== level) throw new Error(`conformance.json: random.${level}.level must be ${level}`);
  const t: Partial<Record<keyof ConfTotals, number>> = {};
  for (const k of TOTAL_KEYS) t[k] = num(o, k as string, `random.${level}`);
  return { level, ...(t as Omit<ConfTotals, "level">) };
}

export function parseConformance(raw: unknown): Conformance {
  const o = obj(raw, "root");
  if (o["schemaVersion"] !== 1) throw new Error("conformance.json: unsupported schemaVersion");
  const corpus = obj(o["corpus"], "corpus");
  const h = obj(o["harness"], "harness");
  const canned = arr(o["canned"], "canned").map((c, i) => {
    const co = obj(c, `canned[${i}]`);
    const lv = obj(co["levels"], `canned[${i}].levels`);
    const levels: Partial<Record<PgLevel, ConfCannedLevel>> = {};
    for (const l of PG_LEVELS) {
      if (lv[l] === undefined) continue;
      const w = obj(lv[l], `canned[${i}].levels.${l}`);
      levels[l] = {
        engine: cell(w["engine"], `canned[${i}].${l}.engine`),
        postgres: cell(w["postgres"], `canned[${i}].${l}.postgres`),
        classMatch: bool(w, "classMatch", `canned[${i}].${l}`),
        identical: bool(w, "identical", `canned[${i}].${l}`),
        diffs: arr(w["diffs"], `canned[${i}].${l}.diffs`).map(String),
      };
    }
    return { scenario: str(co, "scenario", `canned[${i}]`), title: str(co, "title", `canned[${i}]`), levels };
  });
  const ru = obj(o["readUncommitted"], "readUncommitted");
  const random = obj(o["random"], "random");
  const divs = arr(o["knownDivergences"], "knownDivergences").map((d, i) => {
    const w = obj(d, `knownDivergences[${i}]`);
    const occ = obj(w["occurrences"] ?? {}, `knownDivergences[${i}].occurrences`);
    const occurrences: Record<string, number> = {};
    for (const [k, val] of Object.entries(occ)) {
      if (typeof val !== "number") throw new Error(`conformance.json: knownDivergences[${i}].occurrences.${k} must be a number`);
      occurrences[k] = val;
    }
    return {
      id: str(w, "id", `knownDivergences[${i}]`),
      title: str(w, "title", `knownDivergences[${i}]`),
      levels: arr(w["levels"], `knownDivergences[${i}].levels`).map(String),
      cause: str(w, "cause", `knownDivergences[${i}]`),
      causeEstablished: bool(w, "causeEstablished", `knownDivergences[${i}]`),
      notes: typeof w["notes"] === "string" ? w["notes"] : "",
      regression: str(w, "regression", `knownDivergences[${i}]`),
      schedule: str(w, "schedule", `knownDivergences[${i}]`),
      occurrences,
    };
  });
  return {
    schemaVersion: 1,
    engineVersion: str(o, "engineVersion", "root"),
    postgresVersion: str(o, "postgresVersion", "root"),
    corpus: { seedBase: num(corpus, "seedBase", "corpus"), randomPerLevel: num(corpus, "randomPerLevel", "corpus"), noDelete: bool(corpus, "noDelete", "corpus") },
    harness: {
      reruns: num(h, "reruns", "harness"), blockedAfterMs: num(h, "blockedAfterMs", "harness"), unblockWaitMs: num(h, "unblockWaitMs", "harness"),
      stabilityPairs: num(h, "stabilityPairs", "harness"), stabilityUnstable: num(h, "stabilityUnstable", "harness"), stabilityRepeats: num(h, "stabilityRepeats", "harness"),
      evaluations: num(h, "evaluations", "harness"), rerunMismatches: num(h, "rerunMismatches", "harness"), unstableReruns: num(h, "unstableReruns", "harness"),
    },
    canned,
    readUncommitted: {
      scenario: str(ru, "scenario", "readUncommitted"), requested: str(ru, "requested", "readUncommitted"), engineRU: str(ru, "engineRU", "readUncommitted"),
      postgresInvariant: str(ru, "postgresInvariant", "readUncommitted"), dirtyReadObserved: bool(ru, "dirtyReadObserved", "readUncommitted"),
      sameHistoryAsReadCommitted: bool(ru, "sameHistoryAsReadCommitted", "readUncommitted"),
    },
    random: { RC: totals(random["RC"], "RC"), SI: totals(random["SI"], "SI"), SER: totals(random["SER"], "SER") },
    knownDivergences: divs,
  };
}

/** What the badge of one (scenario, level) shows, as plain data. */
export type PgBadgeData =
  | { kind: "measured"; postgresVersion: string; invariant: string; classMatch: boolean; identical: boolean; aborts: Record<string, string>; serializable: boolean }
  | { kind: "no-read-uncommitted" };

/** The measured PostgreSQL result of a canned scenario at a level, or undefined when none exists (RU is handled by the caller). */
export function pgBadgeFor(conf: Conformance, scenario: string, level: Level): PgBadgeData | undefined {
  if (level === "RU") {
    // Only said once the probe measured it: asking for READ UNCOMMITTED on PostgreSQL gave no dirty read.
    return conf.readUncommitted.dirtyReadObserved ? undefined : { kind: "no-read-uncommitted" };
  }
  const entry = conf.canned.find((c) => c.scenario === scenario);
  const l = entry?.levels[level];
  if (!l) return undefined;
  return {
    kind: "measured",
    postgresVersion: conf.postgresVersion,
    invariant: l.postgres.invariant,
    classMatch: l.classMatch,
    identical: l.identical,
    aborts: l.postgres.aborts,
    serializable: l.postgres.serializable,
  };
}

/** The per-scenario slice handed to a client component. */
export function pgBadgesForScenario(conf: Conformance, scenario: string): Partial<Record<Level, PgBadgeData>> {
  const out: Partial<Record<Level, PgBadgeData>> = {};
  for (const lv of ["RU", "RC", "SI", "SER"] as const) {
    const b = pgBadgeFor(conf, scenario, lv);
    if (b) out[lv] = b;
  }
  return out;
}

/** "96.30%" style, or "n/a" when the denominator is zero. */
export function percent(n: number, d: number, digits = 1): string {
  if (d === 0) return "n/a";
  return `${((100 * n) / d).toFixed(digits)}%`;
}
