import type { LevelTotal } from "@/lib/home";
import { LEVEL_NAMES } from "@/lib/levels";

// One native <progress> per isolation level: in how many of the catalogue's scenarios the invariant holds.
// Counts come from the habitat-map cells. The progress bar exposes its value to assistive technology
// (aria-label names it), and the same figures are printed beside it as text.
export function LevelMeter({ totals }: { totals: LevelTotal[] }) {
  return (
    <ul className="meter" data-testid="level-meter" aria-label="Scenarios where the invariant holds, per isolation level, in this engine">
      {totals.map((t) => (
        <li key={t.level} data-level={t.level}>
          <span className="font-semibold">
            {t.level}
            <span className="sr-only"> ({LEVEL_NAMES[t.level]})</span>
          </span>
          <progress max={t.total} value={t.safe} aria-label={`${LEVEL_NAMES[t.level]}: the invariant holds in ${t.safe} of ${t.total} scenarios`} />
          <span className="meter-count">
            holds in {t.safe} of {t.total}
          </span>
        </li>
      ))}
    </ul>
  );
}
