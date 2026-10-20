import type { Trace } from "@/lib/types";
import { explainEvent, explainStart } from "@/lib/explain";

// The live region announces what just happened whenever the step changes.
export function ExplainPanel({ trace, step }: { trace: Trace; step: number }) {
  const e = trace.steps[step - 1];
  const x = e ? explainEvent(trace, e) : explainStart(trace);
  return (
    <section className="card p-3" aria-labelledby="explain-h" data-testid="explain-panel">
      <h2 id="explain-h" className="m-0 mb-2 text-base font-semibold">
        What just happened
      </h2>
      <div aria-live="polite" aria-atomic="true">
        <p className="m-0 font-semibold" data-testid="explain-headline">
          {x.headline}
        </p>
        <ul className="m-0 mt-1 list-disc space-y-1 pl-5 text-sm">
          {x.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
