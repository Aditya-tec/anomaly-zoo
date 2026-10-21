"use client";

import { useState } from "react";
import { classifyEngineError, runAll } from "@/lib/engine";
import { LEVELS, LEVEL_NAMES } from "@/lib/levels";
import { compareDigests, type DigestComparison } from "@/lib/rerun";
import type { Level } from "@/lib/types";

interface Props {
  source: string;
  /** Digests of the traces shipped with the site, per level. */
  published: Record<Level, string>;
  /** Link to the same scenario in the playground. */
  playgroundHref: string;
}

type State = { kind: "idle" } | { kind: "running" } | { kind: "done"; comparison: DigestComparison; engineVersion: string } | { kind: "problem"; message: string };

// Nothing is fetched until the button is pressed (spec §7.6, AC7.2): the click
// loads the engine, runs the same scenario in a worker and compares digests.
export function RerunPanel({ source, published, playgroundHref }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function rerun() {
    setState({ kind: "running" });
    try {
      const res = await runAll(source);
      if (!res.ok) {
        setState({ kind: "problem", message: `The engine rejected the scenario: ${res.errors[0]?.message ?? "unknown error"}.` });
        return;
      }
      const browser: Partial<Record<Level, string>> = {};
      for (const lv of LEVELS) browser[lv] = res.traces[lv].digest;
      setState({ kind: "done", comparison: compareDigests(published, browser), engineVersion: res.traces.RU.engineVersion });
    } catch (e) {
      setState({ kind: "problem", message: classifyEngineError(e).message });
    }
  }

  return (
    <section aria-labelledby="rerun-h" className="space-y-3" data-testid="rerun-panel">
      <h2 id="rerun-h" className="m-0 text-2xl font-semibold">
        Run it yourself
      </h2>
      <p className="m-0">
        <a href={playgroundHref} className="inline-flex min-h-11 items-center" data-testid="run-it-yourself">
          Open this scenario in the playground
        </a>{" "}
        to edit it and run your own.
      </p>
      <p className="m-0 text-sm text-muted">
        Or re-run this scenario here: the same engine, compiled to WebAssembly, runs in a worker in your browser and its result is compared with the published traces. This downloads the engine (about 1 MB compressed) only when you press the button.
      </p>
      <button type="button" className="btn" onClick={() => void rerun()} disabled={state.kind === "running"} data-testid="rerun-button">
        Re-run in your browser
      </button>
      <div aria-live="polite" aria-atomic="true" data-testid="rerun-status" className="min-h-6">
        {state.kind === "running" ? <p className="m-0">Running the engine in your browser…</p> : null}
        {state.kind === "problem" ? <p className="m-0 font-semibold text-bad">{state.message}</p> : null}
        {state.kind === "done" && state.comparison.identical ? (
          <p className="m-0 font-semibold text-good" data-testid="rerun-identical">
            ✓ identical to the published trace
            <span className="ml-2 text-sm font-normal text-muted">All four levels match (engine {state.engineVersion}, WebAssembly, in a worker).</span>
          </p>
        ) : null}
        {state.kind === "done" && !state.comparison.identical ? (
          <div data-testid="rerun-mismatch">
            <p className="m-0 font-semibold text-bad">✗ does not match the published trace</p>
            <p className="mt-1 mb-2 text-sm">The engine in your browser produced a different result than the one the site was built from. Digests per level:</p>
            <ul className="m-0 list-none space-y-2 p-0 text-sm">
              {state.comparison.rows.map((r) => (
                <li key={r.level}>
                  <strong>
                    {LEVEL_NAMES[r.level]} ({r.level}): {r.same ? "identical" : "different"}
                  </strong>
                  {r.same ? null : (
                    <>
                      <br />
                      <span className="mono break-all">published: {r.published}</span>
                      <br />
                      <span className="mono break-all">your browser: {r.browser ?? "(no result)"}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
