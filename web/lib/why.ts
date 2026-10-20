// Explanatory copy taken verbatim from spec §8.3 ("Why the levels differ")
// and §8.4 ("In practice"). It describes mechanisms, not measured outcomes;
// the outcomes themselves always come from traces.
export const WHY_LEVELS_DIFFER: Record<string, string> = {
  "dirty-read": "RU reads the newest version even if uncommitted; every other level only reads committed versions.",
  "non-repeatable-read": "RC takes a fresh view for every statement, so a later read can differ. SI and SER keep one snapshot for the whole transaction.",
  "phantom": "Same mechanism as above, applied to a set of rows: under RC the new row shows up; under a snapshot it stays hidden.",
  "lost-update": "At RC both transactions write values computed from a stale read, so the second overwrites the first. SI and SER notice that the row changed after the snapshot and abort the second writer, which then retries.",
  "read-skew": "At RC the two reads happen at different moments and see different states. A snapshot gives both reads one consistent state.",
  "write-skew": "The two transactions write different rows, so SI sees no conflict, yet each decision depended on a read the other one invalidated. SER tracks those read→write dependencies and aborts one transaction.",
  "read-only-anomaly": "Even a transaction that only reads can observe a state no serial order explains. SER detects the dangerous pattern across three transactions and aborts the one that completes the cycle.",
  "deadlock": "Not an isolation problem. Two transactions wait for each other's locks; the database aborts one.",
};

export const IN_PRACTICE_INTRO = "General guidance, not vendor claims:";

export const IN_PRACTICE_ITEMS: readonly string[] = [
  "Retry on serialization failures.",
  "Prefer atomic updates (SET v = v + 50) to read-modify-write.",
  "Add constraints or unique indexes.",
  "Take explicit locks when needed.",
  "Choose the weakest level that is correct and test it.",
];

export const IN_PRACTICE_CLOSING = "Check your own database's documentation: behavior differs between vendors and versions.";
