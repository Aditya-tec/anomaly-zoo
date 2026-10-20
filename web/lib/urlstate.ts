// The URL is the source of truth: ?level=SI&step=5 (spec §7.7). Unknown or
// invalid values are ignored and the defaults apply.
import type { Level } from "./types";
import { isLevel } from "./levels";

export interface ViewState {
  level: Level;
  step: number;
}

export function parseViewParams(search: string, fallback: ViewState, maxStepFor: (level: Level) => number): ViewState {
  const params = new URLSearchParams(search);
  const rawLevel = params.get("level");
  const level = rawLevel !== null && isLevel(rawLevel) ? rawLevel : fallback.level;
  const rawStep = params.get("step");
  let step = level === fallback.level ? fallback.step : 0;
  if (rawStep !== null && /^\d{1,6}$/.test(rawStep)) {
    const n = Number.parseInt(rawStep, 10);
    if (n <= maxStepFor(level)) step = n;
  }
  return { level, step };
}

export function formatViewParams(state: ViewState): string {
  return `?level=${state.level}&step=${state.step}`;
}
