"use client";

import { useState, type CSSProperties } from "react";
import type { Level, Trace } from "@/lib/types";
import { LEVELS, LEVEL_NAMES } from "@/lib/levels";
import { txnColorVar, txnGlyph } from "@/lib/glyphs";
import { summaryFor } from "@/lib/outcomes";

interface Props {
  traces: Record<Level, Trace>;
  level: Level;
  step: number;
  onPick: (l: Level) => void;
}

function miniLabel(e: Trace["steps"][number]): string {
  const k = e.args.key ?? e.args.prefix ?? "";
  const status = e.status === "ok" ? "" : e.status === "blocked" ? " ⏸" : e.status === "aborted" ? " ✕" : e.status === "skipped" ? " –" : " …";
  return `${e.op}${k ? " " + k : ""}${status}`;
}

// Four small timelines at the same step, so the effect of the level is visible
// side by side. Collapsible; a row can be clicked to switch the main view.
export function CompareStrip({ traces, level, step, onPick }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-labelledby="compare-h" data-testid="compare-strip">
      <div className="flex items-center justify-between gap-2">
        <h2 id="compare-h" className="m-0 text-lg font-semibold">
          Compare the four levels
        </h2>
        <button type="button" className="btn" aria-expanded={open} aria-controls="compare-body" onClick={() => setOpen((o) => !o)}>
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      <div id="compare-body" hidden={!open} className="mt-2 grid gap-3 md:grid-cols-2">
        {LEVELS.map((lv) => {
          const t = traces[lv];
          const k = Math.min(step, t.steps.length);
          const sum = summaryFor(t);
          const label = sum.label;
          return (
            <div key={lv} className={`card p-3 tone-${sum.tone}`} data-testid={`compare-${lv}`} data-current={lv === level ? "true" : "false"}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 font-semibold">
                  <span className="mono">{lv}</span> <span className="text-sm font-normal text-muted">{LEVEL_NAMES[lv]}</span>
                </p>
                <span className="tone-text text-sm">
                  <span aria-hidden="true">{label.glyph} </span>
                  {label.text}
                </span>
              </div>
              <ol className="mini" aria-label={`${LEVEL_NAMES[lv]}, step ${k} of ${t.steps.length}`}>
                {t.steps.map((e) => (
                  <li key={e.index} data-state={e.index + 1 === k ? "current" : e.index + 1 < k ? "past" : "future"} style={{ "--txn": txnColorVar(e.txn) } as CSSProperties}>
                    <span aria-hidden="true" style={{ color: "var(--txn)" }}>
                      {txnGlyph(e.txn)}
                    </span>{" "}
                    <span className="sr-only">{e.txn} </span>
                    {miniLabel(e)}
                  </li>
                ))}
              </ol>
              <p className="mt-2 mb-0 text-xs text-muted">
                Step {k} of {t.steps.length}.
              </p>
              <button type="button" className="btn mt-2" onClick={() => onPick(lv)} aria-pressed={lv === level}>
                {lv === level ? `Showing ${lv}` : `Show ${lv}`}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
