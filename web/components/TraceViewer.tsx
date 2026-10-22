"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { Level, Trace } from "@/lib/types";
import { bannerFromTrace } from "@/lib/outcomes";
import { stepperReducer, type StepperAction, type StepperState } from "@/lib/stepper";
import { formatViewParams, parseViewParams } from "@/lib/urlstate";
import { CompareStrip } from "./CompareStrip";
import { ExplainPanel } from "./ExplainPanel";
import { LevelSwitch } from "./LevelSwitch";
import { PgBadge } from "./PgBadge";
import type { PgBadgeData } from "@/lib/conformance";
import { ResultBanner } from "./ResultBanner";
import { StepControls } from "./StepControls";
import { StorePanel } from "./StorePanel";
import { Timeline } from "./Timeline";
import { VerdictPanel } from "./VerdictPanel";

interface Props {
  traces: Record<Level, Trace>;
  defaultLevel: Level;
  /** Measured PostgreSQL results for this scenario, per level (anomaly pages only). */
  pg?: Partial<Record<Level, PgBadgeData>>;
  /** Mirror level and step in ?level=&step= (anomaly pages). Off in the playground, whose URL is the #s= fragment. */
  syncUrl?: boolean;
}

type Msg = { a: StepperAction; max: number };
const reduce = (s: StepperState, m: Msg) => stepperReducer(s, m.a, m.max);

// Keys that must keep their normal meaning (typing, native controls).
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t instanceof HTMLAnchorElement;
}

export function TraceViewer({ traces, defaultLevel, pg, syncUrl = true }: Props) {
  const [level, setLevel] = useState<Level>(defaultLevel);
  const [stepper, dispatch] = useReducer(reduce, { step: 0, playing: false });
  const [urlReady, setUrlReady] = useState(!syncUrl);

  const trace = traces[level];
  const max = trace.steps.length;
  const send = useCallback((a: StepperAction) => dispatch({ a, max }), [max]);
  const banner = useMemo(() => bannerFromTrace(trace), [trace]);

  // URL -> state, once, after mount (keeps the static HTML identical for everyone).
  useEffect(() => {
    if (!syncUrl) return;
    const p = parseViewParams(window.location.search, { level: defaultLevel, step: 0 }, (l) => traces[l].steps.length);
    setLevel(p.level);
    dispatch({ a: { type: "goto", step: p.step }, max: traces[p.level].steps.length });
    setUrlReady(true);
  }, [defaultLevel, traces, syncUrl]);

  // state -> URL
  useEffect(() => {
    if (!syncUrl || !urlReady) return;
    const url = `${window.location.pathname}${formatViewParams({ level, step: stepper.step })}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [syncUrl, urlReady, level, stepper.step]);

  // Autoplay
  useEffect(() => {
    if (!stepper.playing) return;
    const id = window.setInterval(() => send({ type: "tick" }), 900);
    return () => window.clearInterval(id);
  }, [stepper.playing, send]);

  // Keyboard: ← → step, Space plays/pauses, R resets. Radios, links and text
  // fields keep their own keys; buttons keep Space/Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const onButton = e.target instanceof HTMLButtonElement;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          send({ type: "next" });
          break;
        case "ArrowLeft":
          e.preventDefault();
          send({ type: "back" });
          break;
        case " ":
          if (onButton) return; // let the focused button handle its own Space
          e.preventDefault();
          send({ type: "toggle" });
          break;
        case "r":
        case "R":
          e.preventDefault();
          send({ type: "reset" });
          break;
        default:
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [send]);

  const changeLevel = useCallback(
    (lv: Level) => {
      setLevel(lv);
      // Keep the same moment in the run, so flipping the level shows what changes.
      dispatch({ a: { type: "goto", step: Math.min(stepper.step, traces[lv].steps.length) }, max: traces[lv].steps.length });
    },
    [stepper.step, traces],
  );

  return (
    <div className="space-y-6" data-testid="viewer" data-level={level} data-step={stepper.step} data-ready={urlReady ? "true" : "false"}>
      <ResultBanner banner={banner} />

      <LevelSwitch level={level} traces={traces} onChange={changeLevel} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <h2 className="m-0">Timeline</h2>
          <StepControls step={stepper.step} max={max} playing={stepper.playing} send={send} />
          <p className="m-0 text-sm text-muted">Keyboard: ← and → to step, Space to play or pause, R to reset.</p>
          <Timeline trace={trace} step={stepper.step} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <ExplainPanel trace={trace} step={stepper.step} />
          <StorePanel trace={trace} step={stepper.step} />
        </div>
      </div>

      <CompareStrip traces={traces} level={level} step={stepper.step} onPick={changeLevel} />
      <VerdictPanel trace={trace} />
      <PgBadge level={level} data={pg?.[level]} />
    </div>
  );
}
