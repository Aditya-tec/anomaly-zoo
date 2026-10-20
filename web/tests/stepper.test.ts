import { describe, expect, it } from "vitest";
import { stepperReducer, type StepperAction, type StepperState } from "@/lib/stepper";

const run = (s: StepperState, max: number, ...actions: StepperAction[]) => actions.reduce((acc, a) => stepperReducer(acc, a, max), s);
const start: StepperState = { step: 0, playing: false };

describe("step controller", () => {
  it("next and back stay within 0..max", () => {
    expect(run(start, 3, { type: "back" })).toEqual({ step: 0, playing: false });
    expect(run(start, 3, { type: "next" }, { type: "next" }, { type: "next" }, { type: "next" })).toEqual({ step: 3, playing: false });
    expect(run(start, 3, { type: "next" }, { type: "next" }, { type: "back" })).toEqual({ step: 1, playing: false });
  });

  it("reset returns to step 0 and stops", () => {
    expect(run({ step: 2, playing: true }, 3, { type: "reset" })).toEqual({ step: 0, playing: false });
  });

  it("play advances on ticks and stops itself at the end", () => {
    let s = run(start, 2, { type: "play" });
    expect(s).toEqual({ step: 0, playing: true });
    s = stepperReducer(s, { type: "tick" }, 2);
    expect(s).toEqual({ step: 1, playing: true });
    s = stepperReducer(s, { type: "tick" }, 2);
    expect(s).toEqual({ step: 2, playing: false });
    s = stepperReducer(s, { type: "tick" }, 2);
    expect(s).toEqual({ step: 2, playing: false });
  });

  it("play at the end starts over; pause keeps the step", () => {
    expect(run({ step: 3, playing: false }, 3, { type: "play" })).toEqual({ step: 0, playing: true });
    expect(run({ step: 2, playing: true }, 3, { type: "pause" })).toEqual({ step: 2, playing: false });
  });

  it("toggle switches between play and pause", () => {
    expect(run(start, 3, { type: "toggle" }).playing).toBe(true);
    expect(run(start, 3, { type: "toggle" }, { type: "toggle" }).playing).toBe(false);
  });

  it("manual stepping while playing pauses playback", () => {
    expect(run({ step: 1, playing: true }, 3, { type: "next" })).toEqual({ step: 2, playing: false });
    expect(run({ step: 1, playing: true }, 3, { type: "back" })).toEqual({ step: 0, playing: false });
  });

  it("an empty trace cannot play", () => {
    expect(run(start, 0, { type: "play" })).toEqual({ step: 0, playing: false });
    expect(run(start, 0, { type: "next" })).toEqual({ step: 0, playing: false });
  });

  it("goto clamps, and a stale step beyond a shorter trace is pulled back", () => {
    expect(run(start, 5, { type: "goto", step: 99 }).step).toBe(5);
    expect(run(start, 5, { type: "goto", step: -3 }).step).toBe(0);
    expect(stepperReducer({ step: 9, playing: false }, { type: "back" }, 4).step).toBe(3);
  });
});
