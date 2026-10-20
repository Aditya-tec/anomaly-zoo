import type { StepperAction } from "@/lib/stepper";

interface Props {
  step: number;
  max: number;
  playing: boolean;
  send: (a: StepperAction) => void;
}

export function StepControls({ step, max, playing, send }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Step controls">
      <button type="button" className="btn" onClick={() => send({ type: "back" })} disabled={step <= 0} aria-keyshortcuts="ArrowLeft">
        Back
      </button>
      <button type="button" className="btn btn-primary" onClick={() => send({ type: "next" })} disabled={step >= max} aria-keyshortcuts="ArrowRight">
        Next
      </button>
      <button type="button" className="btn" onClick={() => send({ type: "toggle" })} disabled={max === 0} aria-keyshortcuts="Space">
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" className="btn" onClick={() => send({ type: "reset" })} disabled={step === 0 && !playing} aria-keyshortcuts="R">
        Reset
      </button>
      <p className="m-0 ml-1 font-mono text-sm" data-testid="step-label">
        Step {step} of {max}
      </p>
    </div>
  );
}
