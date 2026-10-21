"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Trace } from "@/lib/types";
import { txnGlyph } from "@/lib/glyphs";
import { colClass, colsClass, laneClass } from "@/lib/grid";
import { EventCard, type EventState } from "./EventCard";

/** What a transaction is doing after `step` events. */
export function txnStateAt(trace: Trace, id: string, step: number): string {
  let state = "not started";
  for (const e of trace.steps.slice(0, step)) {
    if (e.txn !== id) continue;
    if (e.op === "BEGIN" && e.status === "ok") state = "active";
    if (e.status === "aborted") state = "aborted";
    if (e.op === "COMMIT" && e.status === "ok") state = "committed";
  }
  return state;
}

export function txnIds(trace: Trace): string[] {
  return [...new Set([...trace.txns.map((t) => t.id), ...trace.steps.map((e) => e.txn)])].sort();
}

// Swimlanes: one column per transaction, time flowing downwards, one card per
// engine event. On phones (< 640 px) CSS collapses it to a single list where
// every card carries a transaction chip.
export function Timeline({ trace, step }: { trace: Trace; step: number }) {
  const ids = useMemo(() => txnIds(trace), [trace]);
  const scroller = useRef<HTMLDivElement>(null);
  const cols = ids.length;
  const colsCls = colsClass(cols);
  const current = trace.steps[step - 1];

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const el = box.querySelector<HTMLElement>('[aria-current="step"]');
    if (!el) {
      box.scrollTop = 0;
      return;
    }
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < b.top + 56 || r.bottom > b.bottom) box.scrollTop += r.top - b.top - box.clientHeight / 3;
  }, [step, trace]);

  return (
    <div ref={scroller} className="timeline-scroll" tabIndex={0} role="region" aria-label="Timeline: one lane per transaction, time flows downwards" data-testid="timeline">
      <div className={`timeline-head ${colsCls}`}>
        {ids.map((id) => (
          <div key={id} className="col-head" data-txn={id}>
            <span className="txn-ink" aria-hidden="true">
              {txnGlyph(id)}
            </span>
            <span>{id}</span>
            <span className="text-xs font-normal text-muted">{txnStateAt(trace, id, step)}</span>
          </div>
        ))}
      </div>
      <ol className={`timeline ${colsCls}`}>
        {ids.map((id, i) => (
          <li key={`lane-${id}`} className={`lane ${colClass(i + 1)} ${laneClass(trace.steps.length)}`} aria-hidden="true" />
        ))}
        {trace.steps.map((e) => {
          const state: EventState = e.index + 1 === step ? "current" : e.index + 1 < step ? "past" : "future";
          const origin = e.resumed ? trace.steps.find((x) => x.scheduledIndex === e.scheduledIndex && x.status === "blocked" && x.index < e.index) : undefined;
          const linked = !!current && current.resumed && e.status === "blocked" && e.scheduledIndex === current.scheduledIndex && e.index < current.index;
          return <EventCard key={e.index} event={e} state={state} col={ids.indexOf(e.txn) + 1} linked={linked} originStep={origin ? origin.index + 1 : undefined} />;
        })}
      </ol>
    </div>
  );
}
