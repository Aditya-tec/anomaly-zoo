"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Example } from "@/lib/data";
import { classifyEngineError, prewarmEngine, runAll, type EngineError } from "@/lib/engine";
import { checkSourceLimits } from "@/lib/limits";
import { defaultLevelFromTraces } from "@/lib/outcomes";
import { encodeShare, readShareHash } from "@/lib/share";
import type { Level, Trace } from "@/lib/types";
import { SourceEditor } from "./SourceEditor";
import { TraceViewer } from "./TraceViewer";

interface Results {
  traces: Record<Level, Trace>;
  source: string;
  runId: number;
}

type Status = { kind: "idle" } | { kind: "running" } | { kind: "done" } | { kind: "problem"; message: string };

const DEFAULT_ID = "write-skew";

export function Playground({ examples }: { examples: Example[] }) {
  const first = examples.find((e) => e.id === DEFAULT_ID) ?? examples[0];
  const [source, setSource] = useState(first?.source ?? "");
  const [errors, setErrors] = useState<EngineError[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [results, setResults] = useState<Results | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runCounter = useRef(0);

  const run = useCallback(async (src: string) => {
    const limit = checkSourceLimits(src);
    if (limit) {
      setErrors([{ line: 1, col: 1, message: limit }]);
      setStatus({ kind: "idle" });
      return;
    }
    const id = ++runCounter.current;
    setStatus({ kind: "running" });
    try {
      const res = await runAll(src);
      if (id !== runCounter.current) return; // a newer run superseded this one
      if (!res.ok) {
        setErrors(res.errors);
        setStatus({ kind: "idle" });
        return;
      }
      setErrors([]);
      setResults({ traces: res.traces, source: src, runId: id });
      setStatus({ kind: "done" });
      const enc = encodeShare(src);
      const base = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(window.history.state, "", enc.ok ? `${base}#s=${enc.payload}` : base);
    } catch (e) {
      if (id !== runCounter.current) return;
      setStatus({ kind: "problem", message: classifyEngineError(e).message });
    }
  }, []);

  // A share link: decode, validate, and only then run. Any failure is an inline
  // message; the editor keeps the default example and nothing is run.
  useEffect(() => {
    function apply() {
      const r = readShareHash(window.location.hash);
      if (r.kind === "none") return;
      if (r.kind === "error") {
        setLinkError(r.message);
        return;
      }
      setLinkError(null);
      setSource(r.source);
      setShareLink(null);
      void run(r.source);
    }
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [run]);

  function loadExample(id: string) {
    const ex = examples.find((e) => e.id === id);
    if (!ex) return;
    setSource(ex.source);
    setLinkError(null);
    setShareLink(null);
    setShareNote(null);
    void run(ex.source);
  }

  function focusLine(line: number, col: number) {
    const ta = textareaRef.current;
    if (!ta) return;
    const lines = ta.value.split("\n");
    let start = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) start += (lines[i]?.length ?? 0) + 1;
    const len = lines[line - 1]?.length ?? 0;
    ta.focus();
    ta.setSelectionRange(Math.min(start + Math.max(col - 1, 0), start + len), start + len);
    ta.scrollTop = Math.max(0, (line - 3) * 24);
  }

  async function share() {
    const enc = encodeShare(source);
    if (!enc.ok) {
      setShareLink(null);
      setShareNote(enc.reason);
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}#s=${enc.payload}`;
    setShareLink(link);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#s=${enc.payload}`);
    try {
      await navigator.clipboard.writeText(link);
      setShareNote("Link copied.");
    } catch {
      setShareNote("Copy the link from the box below.");
    }
  }

  const running = status.kind === "running";
  const stale = results !== null && results.source !== source;
  const describedBy = errors.length > 0 ? "source-errors-h" : undefined;

  return (
    <div className="space-y-8">
      {linkError ? (
        <div className="card tone-bad p-4" role="alert" data-testid="link-error" style={{ borderLeft: "6px solid var(--tone)" }}>
          <p className="m-0 font-semibold">{linkError}</p>
        </div>
      ) : null}

      <section aria-labelledby="scenario-h" className="space-y-3">
        <h2 id="scenario-h" className="m-0">
          Scenario
        </h2>
        <label htmlFor="source" className="block text-sm text-muted">
          Scenario source
        </label>
        <SourceEditor value={source} onChange={setSource} onRun={() => void run(source)} onIntent={prewarmEngine} invalid={errors.length > 0} describedBy={describedBy} textareaRef={textareaRef} />

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Scenario actions">
          <button type="button" className="btn btn-primary" onClick={() => void run(source)} onPointerEnter={prewarmEngine} disabled={running} aria-keyshortcuts="Control+Enter Meta+Enter" data-testid="run">
            Run
          </button>
          <button type="button" className="btn" onClick={() => void share()} data-testid="share">
            Share
          </button>
          <label className="inline-flex items-center gap-2 text-sm">
            <span>Load example</span>
            <select className="btn" value="" onChange={(e) => loadExample(e.target.value)} data-testid="example-menu">
              <option value="" disabled>
                Choose…
              </option>
              {examples.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title.split(":")[0]}
                </option>
              ))}
            </select>
          </label>
          <p className="m-0 text-sm text-muted">Ctrl or Cmd + Enter runs the scenario.</p>
        </div>

        <div aria-live="polite" aria-atomic="true" data-testid="playground-status" className="min-h-6 text-sm">
          {status.kind === "running" ? "Running… the first run loads the engine." : null}
          {status.kind === "done" ? "Ran the scenario at all four levels." : null}
          {status.kind === "problem" ? <span className="font-semibold text-bad" data-testid="engine-problem">{status.message}</span> : null}
        </div>

        {errors.length > 0 ? (
          <div className="card p-3" data-testid="source-errors" role="alert">
            <h3 id="source-errors-h" className="m-0 mb-2">
              {errors.length === 1 ? "1 problem in the scenario" : `${errors.length} problems in the scenario`}
            </h3>
            <ul className="m-0 list-none space-y-1 p-0">
              {errors.map((e, i) => (
                <li key={i}>
                  <button type="button" className="btn" onClick={() => focusLine(e.line, e.col)} data-testid="error-line">
                    {e.line}:{e.col}
                  </button>{" "}
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {shareLink || shareNote ? (
          <div className="card space-y-2 p-3" data-testid="share-box">
            {shareLink ? (
              <>
                <label htmlFor="share-link" className="block text-sm font-semibold">
                  Share link
                </label>
                <input id="share-link" readOnly value={shareLink} className="mono min-h-11 w-full rounded-md border border-border bg-surface p-2 text-sm" data-testid="share-link" onFocus={(e) => e.currentTarget.select()} />
              </>
            ) : null}
            {shareNote ? (
              <p className="m-0 text-sm" role="status" data-testid="share-note">
                {shareNote}
              </p>
            ) : null}
          </div>
        ) : null}

        <details className="card p-3">
          <summary className="min-h-11 cursor-pointer font-semibold">Scenario language</summary>
          <ul className="mt-2 mb-0 list-disc space-y-1 pl-5 text-sm">
            <li>
              <span className="mono">scenario name</span>, then optional <span className="mono">title</span>, <span className="mono">story</span> and <span className="mono">invariant</span> lines.
            </li>
            <li>
              <span className="mono">setup:</span> lines <span className="mono">PUT key = number</span>; then <span className="mono">schedule:</span> lines <span className="mono">T1 operation</span>.
            </li>
            <li>
              Operations: <span className="mono">BEGIN</span>, <span className="mono">COMMIT</span>, <span className="mono">ABORT</span>, <span className="mono">READ key AS v</span>, <span className="mono">SCAN prefix [WHERE op n] AS s</span>, <span className="mono">PUT key = expression</span>, <span className="mono">DELETE key</span>, <span className="mono">NOTE &quot;text&quot;</span>.
            </li>
            <li>
              <span className="mono">#</span> starts a comment. At most 6 transactions, 200 steps, 64 keys and 8 KB of source.
            </li>
          </ul>
        </details>
      </section>

      <section aria-labelledby="results-h" aria-busy={running} data-testid="playground-results" className="space-y-4">
        <h2 id="results-h" className="m-0">
          Results
        </h2>
        {results ? (
          <>
            {stale ? (
              <p className="m-0 text-sm text-muted" data-testid="stale-note">
                These results are for an earlier version of the scenario. Run again to update them.
              </p>
            ) : null}
            <TraceViewer key={results.runId} traces={results.traces} defaultLevel={defaultLevelFromTraces(results.traces)} syncUrl={false} />
          </>
        ) : (
          <p className="m-0 text-muted">Run a scenario to see it at all four isolation levels.</p>
        )}
      </section>
    </div>
  );
}
