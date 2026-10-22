import type { LevelTotal } from "@/lib/home";
import { LEVEL_NAMES } from "@/lib/levels";

const WIDTH = 16;

// A text progress bar per isolation level: how many of the catalogue's bugs the
// level stops. Counts come from the habitat-map cells; the bar is decoration
// for the figures printed beside it, so it is hidden from assistive technology.
export function LevelMeter({ totals }: { totals: LevelTotal[] }) {
  return (
    <ul className="meter" data-testid="level-meter" aria-label="Scenarios where the invariant holds, per isolation level, in this engine">
      {totals.map((t) => {
        const on = t.total === 0 ? 0 : Math.round((t.safe / t.total) * WIDTH);
        return (
          <li key={t.level} data-level={t.level}>
            <span className="font-bold">
              {t.level}
              <span className="sr-only"> ({LEVEL_NAMES[t.level]})</span>
            </span>
            <span>
              <span className="meter-bar" aria-hidden="true">
                [{"█".repeat(on)}
                <span className="off">{"░".repeat(WIDTH - on)}</span>]
              </span>{" "}
              <span className="meter-count">
                holds in {t.safe} of {t.total}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
