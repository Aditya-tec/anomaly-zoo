// Class names for the timeline's grid placement (generated in
// app/grid-classes.css by scripts/gen-grid-css.mjs). Classes instead of inline
// style attributes keep the Content-Security-Policy free of style-src 'unsafe-inline'.
export const MAX_COLS = 6;
export const MAX_ROWS = 512;

const inRange = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;

/** grid-template-columns for n lanes. */
export const colsClass = (n: number) => (inRange(n, MAX_COLS) ? `gcols-${n}` : "");
/** grid-column for a 1-based lane. */
export const colClass = (n: number) => (inRange(n, MAX_COLS) ? `gc-${n}` : "");
/** grid-row for a 1-based row. Out of range falls back to automatic placement. */
export const rowClass = (n: number) => (inRange(n, MAX_ROWS) ? `gr-${n}` : "");
/** A lane from row 1 to one row past the last of `steps` events (the original `1 / steps + 2`). */
export const laneClass = (steps: number) => (inRange(steps, MAX_ROWS) ? `glane-${steps + 2}` : "");
