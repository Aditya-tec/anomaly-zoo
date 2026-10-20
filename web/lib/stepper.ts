// Step controller for the viewer (spec §7.4 step controls). "step" is the
// number of events applied: 0 = nothing has happened yet, max = the whole run.
export interface StepperState {
  step: number;
  playing: boolean;
}

export type StepperAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "reset" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "tick" }
  | { type: "goto"; step: number };

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

export function stepperReducer(s: StepperState, a: StepperAction, max: number): StepperState {
  const step = clamp(s.step, max);
  switch (a.type) {
    case "next":
      return { step: clamp(step + 1, max), playing: false };
    case "back":
      return { step: clamp(step - 1, max), playing: false };
    case "reset":
      return { step: 0, playing: false };
    case "goto":
      return { step: clamp(a.step, max), playing: false };
    case "play":
      if (max === 0) return { step: 0, playing: false };
      return { step: step >= max ? 0 : step, playing: true };
    case "pause":
      return { step, playing: false };
    case "toggle":
      return stepperReducer(s, { type: s.playing ? "pause" : "play" }, max);
    case "tick": {
      if (!s.playing) return { step, playing: false };
      const next = clamp(step + 1, max);
      return { step: next, playing: next < max };
    }
  }
}
