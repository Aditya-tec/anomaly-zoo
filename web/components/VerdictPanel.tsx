import type { Trace } from "@/lib/types";
import { invariantOutcome, outcomeLabel, outcomeTone, verdictText } from "@/lib/outcomes";

export function VerdictPanel({ trace }: { trace: Trace }) {
  const o = invariantOutcome(trace);
  const label = outcomeLabel(o);
  return (
    <section className="card p-3" aria-labelledby="verdict-h" data-testid="verdict-panel">
      <h2 id="verdict-h" className="m-0 mb-2 text-base font-semibold">
        Invariant and verdict
      </h2>
      <p className={`m-0 tone-${outcomeTone(o)}`} data-testid="invariant-badge">
        <span className="tone-text">
          <span aria-hidden="true">{label.glyph} </span>
          {label.text}
        </span>
        {trace.invariants.map((inv) => (
          <span key={inv.name} className="ml-2 text-sm">
            Invariant “{inv.name}”: {inv.status}
            {inv.detail ? ` (${inv.detail})` : ""}.
          </span>
        ))}
      </p>
      <p className="mt-2 mb-0 text-sm" data-testid="serializability">
        <strong>{trace.serializable.verdict ? "Serializable history: yes." : "Serializable history: no."}</strong> {verdictText(trace)}
      </p>
    </section>
  );
}
