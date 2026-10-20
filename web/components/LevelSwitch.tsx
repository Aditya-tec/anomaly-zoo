import type { Level, Trace } from "@/lib/types";
import { LEVELS, LEVEL_DEFINITIONS, LEVEL_NAMES } from "@/lib/levels";
import { invariantOutcome, outcomeLabel, outcomeTone } from "@/lib/outcomes";

interface Props {
  level: Level;
  traces: Record<Level, Trace>;
  onChange: (l: Level) => void;
}

// A native radio group: arrow keys move between levels, Tab enters/leaves it.
export function LevelSwitch({ level, traces, onChange }: Props) {
  return (
    <div>
      <div role="radiogroup" aria-labelledby="level-label" aria-describedby="level-def" className="segmented" data-testid="level-switch">
        <span id="level-label" className="sr-only">
          Isolation level
        </span>
        {LEVELS.map((lv) => {
          const o = invariantOutcome(traces[lv]);
          const label = outcomeLabel(o);
          return (
            <label key={lv}>
              <input type="radio" name="level" value={lv} checked={level === lv} onChange={() => onChange(lv)} className="sr-only" data-testid={`level-${lv}`} />
              <span className={`seg tone-${outcomeTone(o)}`}>
                <span className="mono font-bold">{lv}</span>
                <span className="seg-name">{LEVEL_NAMES[lv]}</span>
                <span className="tone-text text-sm">
                  <span aria-hidden="true">{label.glyph} </span>
                  {label.text}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p id="level-def" className="mt-2 mb-0 text-sm" data-testid="level-definition">
        <strong>{LEVEL_NAMES[level]}:</strong> {LEVEL_DEFINITIONS[level]}
      </p>
    </div>
  );
}
