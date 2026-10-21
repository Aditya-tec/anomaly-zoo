import { SHOW_PG_BADGE } from "@/lib/site";
import type { PgBadgeData } from "@/lib/conformance";
import type { Level } from "@/lib/types";
import { outcomeFromInvariant, pgBadgeView } from "@/lib/outcomes";

// The PostgreSQL badge (spec §9.4, §13.3). It shows only what conformance.json
// measured for this scenario and level; with no data it renders nothing, and
// for Read Uncommitted it says only that PostgreSQL has none.
export interface PgBadgeProps {
  level: Level;
  data?: PgBadgeData;
}

export function PgBadge({ level, data }: PgBadgeProps) {
  if (!SHOW_PG_BADGE || !data) return null;
  const v = pgBadgeView(level, data);
  const outcome = data.kind === "measured" ? outcomeFromInvariant(data.invariant) : "none";
  return (
    <aside className={`banner p-4 tone-${v.tone}`} aria-label="PostgreSQL comparison" data-testid="pg-badge" data-level={level} data-kind={data.kind} data-pg-outcome={outcome}>
      <p className="m-0 text-base font-semibold">
        {v.label ? (
          <span className="tone-text mr-2">
            <span aria-hidden="true">{v.label.glyph} </span>
            {v.label.text}
          </span>
        ) : null}
        <span data-testid="pg-badge-headline">{v.headline}</span>
      </p>
      {v.lines.length > 0 ? (
        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm">
          {v.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
