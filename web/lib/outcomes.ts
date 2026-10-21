// The ONLY module allowed to produce the outcome words ("Occurs",
// "Prevented"). Everything here is a pure function of engine data (manifest
// cells and traces), so no outcome is ever authored by hand (spec §9.2). The
// ESLint config bans these words everywhere else.
import type { Level, ManifestScenario, ManifestTrace, Trace } from "./types";
import { LEVELS, LEVEL_NAMES } from "./levels";

export type Outcome = "occurs" | "prevented" | "not-evaluated";

export function outcomeFromInvariant(status: string): Outcome {
  if (status === "violated") return "occurs";
  if (status === "holds") return "prevented";
  return "not-evaluated";
}

/** Styling hook for components, so they never compare against the outcome words themselves. */
export type Tone = "bad" | "good" | "neutral";
export function outcomeTone(o: Outcome): Tone {
  return o === "occurs" ? "bad" : o === "prevented" ? "good" : "neutral";
}

export interface OutcomeLabel {
  glyph: string;
  text: string;
}

/** Glyph + word, so the outcome is never conveyed by colour alone. */
export function outcomeLabel(o: Outcome): OutcomeLabel {
  switch (o) {
    case "occurs":
      return { glyph: "✗", text: "Occurs" };
    case "prevented":
      return { glyph: "✓", text: "Prevented" };
    default:
      return { glyph: "–", text: "Not evaluated" };
  }
}

/** "Write Skew: the hospital with no doctor on call" -> "Write Skew". */
export function anomalyName(title: string): string {
  const head = title.split(":")[0];
  return (head ?? title).trim();
}

const ABORT_SUMMARY: Record<string, string> = {
  abort_concurrent_update: "could not serialize access due to a concurrent update (first updater wins)",
  abort_dependencies: "could not serialize access due to read/write dependencies among transactions",
  abort_deadlock: "deadlock detected",
  abort_runtime_error: "arithmetic out of range",
  blocked_at_end: "still waiting when the schedule ended; rolled back",
};

export function abortSummary(code: string): string {
  return ABORT_SUMMARY[code] ?? code;
}

/** Engine-initiated aborts (a user ABORT step is not an engine decision). */
export function engineAborts(trace: Trace): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of trace.txns) {
    if (t.abortReason && t.abortReason !== "abort_user") out[t.id] = t.abortReason;
  }
  return out;
}

export function invariantOutcome(trace: Trace): Outcome {
  let holds = 0;
  for (const inv of trace.invariants) {
    if (inv.status === "violated") return "occurs";
    if (inv.status === "holds") holds++;
  }
  return holds > 0 ? "prevented" : "not-evaluated";
}

/** Mirrors engine/matrix CellOf: first engine abort reason, else "visibility" when the invariant holds. */
export function mechanismOf(trace: Trace): string {
  const aborts = engineAborts(trace);
  const ids = Object.keys(aborts).sort();
  const first = ids[0];
  if (first !== undefined) return aborts[first] ?? "none";
  return invariantOutcome(trace) === "prevented" ? "visibility" : "none";
}

export function mechanismLabel(mechanism: string, aborts: Record<string, string>): string {
  const ids = Object.keys(aborts).sort();
  if (ids.length > 0) return ids.map((id) => `${id} aborted: ${abortSummary(aborts[id] ?? "")}`).join("; ");
  if (mechanism === "visibility") return "The visibility rules kept the conflicting write out of sight.";
  return "No protection at this level.";
}

export interface CellView {
  level: Level;
  outcome: Outcome;
  label: OutcomeLabel;
  mechanism: string;
}

export function cellView(level: Level, cell: ManifestTrace): CellView {
  const outcome = outcomeFromInvariant(cell.invariant);
  return { level, outcome, label: outcomeLabel(outcome), mechanism: mechanismLabel(cell.mechanism, cell.aborts) };
}

export type SummaryKind = Outcome | "serializable" | "not-serializable";

export interface Summary {
  kind: SummaryKind;
  tone: Tone;
  label: OutcomeLabel;
}

/**
 * One-glance result of a trace. With invariants (the canned scenarios) it is
 * the invariant outcome; without any (a playground scenario, spec §5.4) it is
 * the serializability oracle's verdict, which is all there is to show.
 */
export function summaryFor(trace: Trace): Summary {
  if (trace.invariants.length > 0) {
    const o = invariantOutcome(trace);
    return { kind: o, tone: outcomeTone(o), label: outcomeLabel(o) };
  }
  return trace.serializable.verdict
    ? { kind: "serializable", tone: "good", label: { glyph: "✓", text: "Serializable" } }
    : { kind: "not-serializable", tone: "bad", label: { glyph: "✗", text: "Not serializable" } };
}

export interface Banner {
  kind: SummaryKind;
  tone: Tone;
  label: OutcomeLabel;
  headline: string;
  lines: string[];
}

export function bannerFromTrace(trace: Trace): Banner {
  const level = LEVEL_NAMES[trace.level];
  const sum = summaryFor(trace);
  const lines: string[] = [];
  const aborts = engineAborts(trace);

  if (trace.invariants.length === 0) {
    lines.push(verdictText(trace));
    for (const id of Object.keys(aborts).sort()) lines.push(`${id} aborted: ${abortSummary(aborts[id] ?? "")}.`);
    const headline = trace.serializable.verdict
      ? `At ${level}, the committed transactions match a serial order.`
      : `At ${level}, the committed transactions match no serial order.`;
    return { ...sum, headline, lines };
  }

  const name = anomalyName(trace.scenario.title) || "This schedule";
  const verb = sum.kind === "occurs" ? "occurs" : sum.kind === "prevented" ? "is prevented" : "was not evaluated";
  for (const inv of trace.invariants) {
    lines.push(`Invariant "${inv.name}": ${inv.status}${inv.detail ? ` (${inv.detail})` : ""}.`);
  }
  for (const id of Object.keys(aborts).sort()) lines.push(`${id} aborted: ${abortSummary(aborts[id] ?? "")}.`);
  if (sum.kind === "prevented" && Object.keys(aborts).length === 0) lines.push(mechanismLabel(mechanismOf(trace), aborts));
  return { ...sum, headline: `${name} ${verb} at ${level}.`, lines };
}
/** Spec §7.6 wording for a history no serial order explains. */
export function verdictText(trace: Trace): string {
  if (!trace.serializable.verdict) {
    return "No serial order of the committed transactions produces these reads and this final state.";
  }
  const w = trace.serializable.witnessOrder ?? [];
  return w.length > 0
    ? `Equivalent to running the committed transactions one at a time in this order: ${w.join(" → ")}.`
    : "No transactions committed.";
}

/** The highest level at which the scenario's invariant is still violated (RU if none is). */
export function defaultLevelFor(s: ManifestScenario): Level {
  let pick: Level = "RU";
  for (const lv of LEVELS) if (s.traces[lv].invariant === "violated") pick = lv;
  return pick;
}

/** Default level for a set of fresh traces (the playground): the highest level at which the run still goes wrong. */
export function defaultLevelFromTraces(traces: Record<Level, Trace>): Level {
  let pick: Level | null = null;
  for (const lv of LEVELS) {
    const k = summaryFor(traces[lv]).kind;
    if (k === "occurs" || k === "not-serializable") pick = lv;
  }
  if (pick) return pick;
  return traces.RU.invariants.length > 0 ? "RU" : "SER";
}