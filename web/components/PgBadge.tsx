import { SHOW_PG_BADGE } from "@/lib/site";
import type { Level } from "@/lib/types";

// Placeholder for the PostgreSQL badge (phase P8). It is built so the slot
// exists, but it renders nothing: no claim about PostgreSQL may appear until
// conformance results exist (spec §13.3). `result` will carry measured data
// from conformance.json; until then the flag keeps this hidden.
export interface PgBadgeProps {
  level: Level;
  result?: { comparedWith: string; sameOutcomeClass: boolean };
}

export function PgBadge({ result }: PgBadgeProps) {
  if (!SHOW_PG_BADGE || !result) return null;
  return null; // P8 will render the measured result here
}
